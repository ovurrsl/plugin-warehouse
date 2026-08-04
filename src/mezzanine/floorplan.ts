import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { useWarehouseStore } from '../store'
import { lengthLabel, lengthValue, millimetreLabel, unitOf } from '../units'
import { FLOOR_TYPES } from './catalog'
import {
  footprintDepthM,
  footprintWidthM,
  gridColumnPositions,
  hasCustomOutline,
  outlinePolygon,
  pointInPolygon,
  resolveColumnProfile,
  resolveTierElevations,
} from './metrics'
import { edgeGeometry, outlineEdgeSpans, outlineEdges, stairOrigin, tierVoidRects } from './railing'
import type { MezzanineNode } from './schema'
import { resolveSteps } from './stairs'

/**
 * Plan sembolü — 3B ile AYNI hesaplayıcılardan.
 *
 * `gridColumnPositions`, `outlineEdges`, `stairOrigin`, `resolveSteps`,
 * `tierVoidRects`: hepsi `parts.ts`'in okuduğu fonksiyonların ta kendisi.
 * v1.0 raporunun kendi kuralı ("iki görünüm tek kaynaktan türer") ve
 * backlog'daki 2D/3D uyuşmazlığını mezzanine'de tekrarlamamanın tek yolu —
 * ikinci bir konum hesabı, sessizce ayrışacak bir kopya demek.
 *
 * SVG `rotate()` saat yönünde ve y aşağı bakarken, three +Y çevresinde saat
 * yönünün tersine döner: plan dönüşü düğümünkini negatifler (rack'ın notu).
 *
 * **Hangi tier çizilir:** en üstteki. Bir plan tek bir kotu gösterir ve üst
 * kat, kullanıcının üstünde yürüdüğü kattır; alt tier'ların korkuluğu ve
 * merdiveni üst üste binseydi sembol okunamazdı.
 */
/**
 * Desen işareti sayısının üst sınırı.
 *
 * 20×15 m güvertede sabit aralıklı bir desen binlerce primitif üretir ve
 * plan çizimi ölür. Aralık alanla birlikte büyüyor: desen büyük bir
 * güvertede seyrelir ama YOK OLMAZ — tipi ayırt ettirmek yeter, gerçek bir
 * tarama yoğunluğu vaat etmiyoruz.
 */
const HATCH_MARK_BUDGET = 220

/**
 * Döşeme tipinin plan deseni.
 *
 * Beş desen beş farklı fiziksel yüzey: sunta (dots), oluklu sac (wave),
 * yarıklı (slots), delikli (perforation), ızgara (grid). Izgara ve delikli
 * olanlar sprinkler suyunu geçirir — planda ayırt edilememeleri bir yangın
 * senaryosunu görünmez kılıyordu.
 */
function floorHatch(
  pattern: 'dots' | 'wave' | 'slots' | 'perforation' | 'grid',
  width: number,
  depth: number,
  color: string,
  /** Güverte sınırı — desen dışarı taşmasın. */
  outline: readonly (readonly [number, number])[],
): FloorplanGeometry[] {
  const marks: FloorplanGeometry[] = []
  const inset = 0.25
  const usableW = Math.max(0, width - inset * 2)
  const usableD = Math.max(0, depth - inset * 2)
  if (usableW <= 0 || usableD <= 0) return marks

  // Izgara tam boy çizgilerle okunur — hücre başına işaret koymak hem
  // pahalı hem de ızgaranın SÜREKLİ olduğunu söylemiyor.
  if (pattern === 'grid') {
    const step = Math.max(0.5, Math.sqrt((usableW * usableD) / 60))
    for (let x = -usableW / 2; x <= usableW / 2 + 1e-9; x += step) {
      marks.push({
        kind: 'rect',
        x: x - 0.008,
        y: -usableD / 2,
        width: 0.016,
        height: usableD,
        fill: color,
        opacity: 0.35,
      })
    }
    for (let z = -usableD / 2; z <= usableD / 2 + 1e-9; z += step) {
      marks.push({
        kind: 'rect',
        x: -usableW / 2,
        y: z - 0.008,
        width: usableW,
        height: 0.016,
        fill: color,
        opacity: 0.35,
      })
    }
    return marks
  }

  const dense = pattern === 'perforation'
  const budget = dense ? HATCH_MARK_BUDGET : HATCH_MARK_BUDGET / 2
  const step = Math.max(0.35, Math.sqrt((usableW * usableD) / budget))

  let row = 0
  for (let z = -usableD / 2; z <= usableD / 2 + 1e-9; z += step) {
    // Oluklu sac sıraları kaydırır — düz bir ızgara oluk izlenimi vermez.
    const shift = pattern === 'wave' && row % 2 === 1 ? step / 2 : 0
    for (let x = -usableW / 2 + shift; x <= usableW / 2 + 1e-9; x += step) {
      // Poligon dışına düşen işaret çizilmiyor — desen döşemenin olduğu
      // yeri anlatıyor, sınır kutusunu değil.
      if (!pointInPolygon(x, z, outline)) continue
      if (pattern === 'dots' || pattern === 'perforation') {
        marks.push({
          kind: 'circle',
          cx: x,
          cy: z,
          r: dense ? 0.02 : 0.035,
          fill: color,
          opacity: 0.45,
        })
      } else {
        // wave ve slots: yatay kısa çubuklar; yarık daha ince ve uzun.
        const length = pattern === 'slots' ? step * 0.45 : step * 0.3
        marks.push({
          kind: 'rect',
          x: x - length / 2,
          y: z - (pattern === 'slots' ? 0.012 : 0.018),
          width: length,
          height: pattern === 'slots' ? 0.024 : 0.036,
          fill: color,
          opacity: 0.4,
        })
      }
    }
    row++
  }
  return marks
}

export function buildMezzanineFloorplan(
  node: MezzanineNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = footprintWidthM(node)
  const depth = footprintDepthM(node)
  const view = ctx.viewState
  const unit = unitOf(view)
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#004f7c'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const columnFill = selected ? stroke : '#003a5c'
  const railStroke = selected ? stroke : '#5a6570'
  const gateFill = selected ? stroke : '#f2c200'
  const voidFill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#ffffff'
  const hatchTint = selected ? stroke : '#93a3b8'

  const resolved = resolveTierElevations(node.tiers)

  /**
   * Hangi tier çizilir: HEDEF SEÇİLİ olan, yoksa en üstteki.
   *
   * Plan tek bir kotu gösterir ve varsayılan üst kat — kullanıcının üstünde
   * yürüdüğü kat. Ama iki katlı bir mezzanine'de alt katın korkuluğuna,
   * kapısına, merdivenine planda hiç erişilemiyordu. Yerleştirme hedefi
   * (`activeDeck`) zaten kat seçimi: aynı seçim planı da sürüyor —
   * hedeflediğin katın planına bakarsın. `setActiveDeck` düğümü kirletiyor,
   * plan o yüzden tazeleniyor.
   */
  const targeted = useWarehouseStore.getState().activeDeck
  const top =
    (targeted?.mezzanineId === node.id
      ? resolved.find((tier) => tier.index === targeted.tierIndex)
      : undefined) ?? resolved[resolved.length - 1]

  const outline = outlinePolygon(node)
  const children: FloorplanGeometry[] = [
    // Özel şekil çizilmişse anahat POLİGON. Dikdörtgen çizmek, planı okuyan
    // kişiye olmayan bir döşeme göstermek olurdu — L şeklinin çentiği dolu
    // görünürdü.
    hasCustomOutline(node)
      ? {
          kind: 'polygon',
          // `FloorplanPoint` bir tuple: [x, y]. Plan düzleminde y = dünya z.
          points: outline.map(([x, z]) => [x, z] as const),
          // 'transparent' değil 'none': `none` boya değil, pointer-events
          // onu hiç görmez — rack'ın kaydettiği ders.
          fill,
          stroke,
          strokeWidth: 0.03,
        }
      : {
          kind: 'rect',
          x: -width / 2,
          y: -depth / 2,
          width,
          height: depth,
          fill,
          stroke,
          strokeWidth: 0.03,
        },
  ]

  // ── Döşeme deseni: hangi döşeme tipi olduğunu plan söylesin ───────────
  //
  // `hatch2D` yedi döşeme tipinde de doluydu ve hiçbir satır okumuyordu:
  // sunta döşeme ile sprinkler suyunu geçiren çelik ızgara planda birebir
  // aynı görünüyordu. İkisi arasındaki fark yangın senaryosunu değiştirir.
  if (top) {
    children.push(
      ...floorHatch(FLOOR_TYPES[top.floorType].hatch2D, width, depth, hatchTint, outline),
    )
  }

  // ── Döşeme boşlukları: merdivenin döşemede açtığı delik ────────────────
  // Beyaz dolgu, kesik çerçeve: plan okurken "burada döşeme YOK" en kritik
  // bilgi — biri oraya raf koyamaz.
  if (top) {
    const delta = top.deckTopM - top.resolvedElevationM
    for (const rect of tierVoidRects(node, top, delta)) {
      children.push({
        kind: 'rect',
        x: rect.x0,
        y: rect.z0,
        width: rect.x1 - rect.x0,
        height: rect.z1 - rect.z0,
        fill: voidFill,
        stroke: railStroke,
        strokeWidth: 0.02,
        strokeDasharray: '0.2 0.12',
      })
    }
  }

  // ── Kolonlar ───────────────────────────────────────────────────────────
  const profile = resolveColumnProfile(node)
  const columnSide = Math.max(profile.h, profile.b)
  for (const point of gridColumnPositions(node)) {
    children.push(columnRect(point.x, point.z, columnSide, columnFill))
    if (node.columnType === 'double') {
      children.push(columnRect(point.x, point.z + profile.b, columnSide, columnFill))
    }
  }

  // ── Korkuluk: dolu parçalar, açıklıklarda kesik ────────────────────────
  //
  // 3B ile AYNI kaynaktan (`outlineEdges` + `outlineEdgeSpans`): plan
  // dikdörtgen kenarlardan çizilseydi, L şeklinde bir güvertede 2B ile 3B
  // ayrışırdı ve backlog'daki 2D/3D uyuşmazlığı mezzanine'de tekrarlanırdı.
  if (top) {
    const thickness = 0.06
    for (const edge of outlineEdges(node)) {
      const ux = (edge.b[0] - edge.a[0]) / edge.lengthM
      const uz = (edge.b[1] - edge.a[1]) / edge.lengthM
      for (const span of outlineEdgeSpans(top, edge)) {
        const length = span.toM - span.fromM
        const mid = (span.fromM + span.toM) / 2
        const cx = edge.a[0] + ux * mid
        const cz = edge.a[1] + uz * mid
        const hx = (ux * length) / 2
        const hz = (uz * length) / 2
        // Eğik bir kenar dikdörtgenle çizilemez; kalınlık kenarın dik
        // yönünde açılan dörtgenle veriliyor.
        const nx = (-uz * thickness) / 2
        const nz = (ux * thickness) / 2
        children.push({
          kind: 'polygon',
          points: [
            [cx - hx + nx, cz - hz + nz],
            [cx + hx + nx, cz + hz + nz],
            [cx + hx - nx, cz + hz - nz],
            [cx - hx - nx, cz - hz - nz],
          ],
          fill: railStroke,
          stroke: railStroke,
          strokeWidth: 0.008,
        })
      }
    }

    // ── Kiriş ızgarası — yükün NEYİN üstünde durduğu plansız okunmaz ─────
    //
    // 3B ile aynı yerleşim (`pushTierBeams`): ana kirişler her göz hattında,
    // ikinciller sabit aralıkta. İkisi kalınlıkla ayrılıyor — plan dili.
    {
      const { baysY, bayDepthM } = node.grid
      const secondarySpacing = 1.25
      for (let iz = 0; iz <= baysY; iz++) {
        const z = -depth / 2 + iz * bayDepthM
        if (z > depth / 2 + 1e-9) break
        children.push({
          kind: 'rect',
          x: -width / 2,
          y: z - 0.03,
          width,
          height: 0.06,
          fill: railStroke,
          opacity: 0.3,
        })
      }
      const secondaryCount = Math.max(1, Math.round(width / secondarySpacing))
      for (let i = 0; i <= secondaryCount; i++) {
        const x = -width / 2 + (i / secondaryCount) * width
        children.push({
          kind: 'rect',
          x: x - 0.012,
          y: -depth / 2,
          width: 0.024,
          height: depth,
          fill: railStroke,
          opacity: 0.18,
        })
      }
    }

    // ── Kanat kapı: kanat + menteşe noktası + süpürme yayı ───────────────
    //
    // Düz sarı bir bant, kapının hangi yöne açıldığını ve ne kadar zemin
    // süpürdüğünü söylemiyordu — planı okuyan kişi tam bunu soruyor.
    for (const gate of top.accessories.swingGates) {
      const geo = edgeGeometry(node, gate.edge)
      const along = geo.startM + gate.offsetM
      // Menteşe: kapının bir ucu. Kanat kapalı konumda kenar boyunca.
      const hinge: [number, number] =
        geo.axis === 'x'
          ? [along - gate.widthM / 2, geo.fixed]
          : [geo.fixed, along - gate.widthM / 2]
      const latch: [number, number] =
        geo.axis === 'x'
          ? [along + gate.widthM / 2, geo.fixed]
          : [geo.fixed, along + gate.widthM / 2]
      // İçe açılır: süpürme yayı içeri doğru çeyrek daire.
      const inward = -geo.outward
      const sweepEnd: [number, number] =
        geo.axis === 'x'
          ? [hinge[0], hinge[1] + inward * gate.widthM]
          : [hinge[0] + inward * gate.widthM, hinge[1]]

      children.push({
        kind: 'path',
        d: `M ${latch[0]} ${latch[1]} A ${gate.widthM} ${gate.widthM} 0 0 ${
          // Yay yönü: menteşe etrafında kapalıdan açığa.
          geo.axis === 'x' ? (inward > 0 ? 1 : 0) : inward > 0 ? 0 : 1
        } ${sweepEnd[0]} ${sweepEnd[1]}`,
        fill: 'none',
        stroke: gateFill,
        strokeWidth: 0.02,
        strokeDasharray: '0.15 0.1',
      })
      // Kanat (kapalı konum) ve menteşe işareti.
      children.push({
        kind: 'path',
        d: `M ${hinge[0]} ${hinge[1]} L ${latch[0]} ${latch[1]}`,
        fill: 'none',
        stroke: gateFill,
        strokeWidth: 0.06,
      })
      children.push({ kind: 'circle', cx: hinge[0], cy: hinge[1], r: 0.09, fill: gateFill })
    }

    // ── Yukarı-devrilir kapı: kanat + palet üstü yatay flap ──────────────
    //
    // Kanat kapıdan AYRI sembol: yay yok (dikey döner), onun yerine içeri
    // uzanan kesikli dikdörtgen — 3B'deki yatay kanadın gerçek izdüşümü.
    for (const gate of top.accessories.upAndOverGates) {
      const geo = edgeGeometry(node, gate.edge)
      const along = geo.startM + gate.offsetM
      const thickness = 0.08
      const inward = -geo.outward
      children.push({
        kind: 'rect',
        x: geo.axis === 'x' ? along - gate.widthM / 2 : geo.fixed - thickness / 2,
        y: geo.axis === 'x' ? geo.fixed - thickness / 2 : along - gate.widthM / 2,
        width: geo.axis === 'x' ? gate.widthM : thickness,
        height: geo.axis === 'x' ? thickness : gate.widthM,
        fill: gateFill,
        stroke: gateFill,
        strokeWidth: 0.008,
      })
      const flapDepth = gate.widthM / 2
      children.push({
        kind: 'rect',
        x:
          geo.axis === 'x'
            ? along - gate.widthM / 2
            : inward > 0
              ? geo.fixed
              : geo.fixed - flapDepth,
        y:
          geo.axis === 'x'
            ? inward > 0
              ? geo.fixed
              : geo.fixed - flapDepth
            : along - gate.widthM / 2,
        width: geo.axis === 'x' ? gate.widthM : flapDepth,
        height: geo.axis === 'x' ? flapDepth : gate.widthM,
        fill: 'none',
        stroke: gateFill,
        strokeWidth: 0.02,
        strokeDasharray: '0.12 0.08',
      })
    }

    // ── Güvenlik bölgesi: zincir — kesikli çizgi + baklalar ──────────────
    for (const zone of top.accessories.safetyZones) {
      const geo = edgeGeometry(node, zone.edge)
      const along = geo.startM + zone.offsetM
      const a: [number, number] =
        geo.axis === 'x'
          ? [along - zone.widthM / 2, geo.fixed]
          : [geo.fixed, along - zone.widthM / 2]
      const b: [number, number] =
        geo.axis === 'x'
          ? [along + zone.widthM / 2, geo.fixed]
          : [geo.fixed, along + zone.widthM / 2]
      children.push({
        kind: 'path',
        d: `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`,
        fill: 'none',
        stroke: gateFill,
        strokeWidth: 0.03,
        strokeDasharray: '0.1 0.08',
      })
      // Zincir baklaları: uçlarda ve ortada birer halka.
      for (const t of [0, 0.5, 1] as const) {
        children.push({
          kind: 'circle',
          cx: a[0] + (b[0] - a[0]) * t,
          cy: a[1] + (b[1] - a[1]) * t,
          r: 0.07,
          fill: 'none',
          stroke: gateFill,
          strokeWidth: 0.025,
        })
      }
    }

    // ── Merdiven: basamak çizgileri + çıkış oku + etiket ─────────────────
    const delta = top.deckTopM - top.resolvedElevationM
    for (const stair of top.accessories.staircases) {
      const { geometry } = resolveSteps(stair, delta)
      const origin = stairOrigin(node, stair)
      const cos = Math.cos(origin.rotationRad)
      const sin = Math.sin(origin.rotationRad)
      const place = (lx: number, lz: number): [number, number] => [
        origin.x + lx * cos - lz * sin,
        origin.z + lx * sin + lz * cos,
      ]

      // Basamaklar: her rıht bir çizgi. Plan bir merdiveni böyle gösterir.
      for (let step = 1; step <= geometry.steps; step++) {
        const [cx, cz] = place(0, geometry.goingM * step)
        const isAlongX = Math.abs(cos) > 0.5
        children.push({
          kind: 'rect',
          x: isAlongX ? cx - stair.widthM / 2 : cx - 0.02,
          y: isAlongX ? cz - 0.02 : cz - stair.widthM / 2,
          width: isAlongX ? stair.widthM : 0.04,
          height: isAlongX ? 0.04 : stair.widthM,
          fill: railStroke,
          stroke: railStroke,
          strokeWidth: 0.006,
        })
      }

      // Çıkış oku: merdivenin tırmandığı yön. Plan sembolünün "UP" işareti.
      const tipL = geometry.goingM * geometry.steps
      const [tipX, tipZ] = place(0, tipL)
      const [tailX, tailZ] = place(0, tipL * 0.35)
      const headHalf = stair.widthM * 0.22
      children.push({
        kind: 'polygon',
        points: [place(-headHalf, tipL - 0.35), [tipX, tipZ], place(headHalf, tipL - 0.35)],
        fill: railStroke,
        stroke: railStroke,
        strokeWidth: 0.01,
      })
      children.push({
        kind: 'rect',
        x: Math.min(tailX, tipX) - 0.02,
        y: Math.min(tailZ, tipZ) - 0.02,
        width: Math.abs(tipX - tailX) + 0.04,
        height: Math.abs(tipZ - tailZ) + 0.04,
        fill: railStroke,
        stroke: railStroke,
        strokeWidth: 0.006,
      })

      if (selected) {
        children.push({
          kind: 'dimension-label',
          cx: origin.x,
          cy: origin.z,
          text: `${stair.id} · ${geometry.steps} basamak · ${millimetreLabel(geometry.riseM, unit)}`,
          angle: 0,
          screenUpright: true,
        })
      }
    }

    if (selected) {
      children.push({
        kind: 'dimension-label',
        cx: 0,
        cy: -depth / 2 - 0.6,
        // Hangi katın planına bakıldığı etikette — iki katlıda "hangisi bu?"
        // sorusu sorulmamalı.
        text: `tier ${top.index + 1}/${node.tiers.length} · ${lengthLabel(top.deckTopM, unit)} · ${FLOOR_TYPES[top.floorType].label}`,
        angle: 0,
        screenUpright: true,
      })
      // Ölçüler: toplam ayak izi + göz adımı. Yerleşim kararı veren kişinin
      // plandan okuyamadığı iki sayı buydu.
      children.push({
        kind: 'dimension-label',
        cx: 0,
        cy: depth / 2 + 0.5,
        text: `${lengthValue(width, unit, 1)} × ${lengthLabel(depth, unit, 1)} · göz ${lengthValue(node.grid.bayWidthM, unit, 1)} × ${lengthLabel(node.grid.bayDepthM, unit, 1)}`,
        angle: 0,
        screenUpright: true,
      })
    }
  }

  const rotation = Array.isArray(node.rotation) ? (node.rotation[1] ?? 0) : 0

  return {
    kind: 'group',
    children,
    transform: {
      translate: [node.position?.[0] ?? 0, node.position?.[2] ?? 0],
      rotate: -rotation,
    },
  }
}

function columnRect(x: number, z: number, side: number, fill: string): FloorplanGeometry {
  return {
    kind: 'rect',
    x: x - side / 2,
    y: z - side / 2,
    width: side,
    height: side,
    fill,
    stroke: fill,
    strokeWidth: 0.004,
  }
}
