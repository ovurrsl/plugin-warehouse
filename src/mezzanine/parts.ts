/**
 * Mezzanine'in kutu-listesi parçaları — rack/telescopic'in `role+center+size`
 * deseni. Profil kesitleri `THREE.ExtrudeGeometry` ile ÇİZİLMİYOR (repo'da
 * hiçbir yapısal çelik parçası extrude edilmiyor — rack'ın C-kesit dikmesi
 * bile 3 kutudan kurulu); I-profil (IPE/HEA/Sigma-yaklaşık) burada gövde +
 * iki flanştan (3 kutu) kuruluyor, aynı ilke.
 *
 * Dikey model (`metrics.resolveTierElevations`): bir tier'in YÜRÜME yüzeyi
 * `deckTopM`; döşeme paneli onun hemen altında, ikincil kirişler panelin
 * altında, ana kirişler onların da altında, kolonlar tepeye kadar tek parça.
 */

import { FLOOR_TYPES, type IBeamProfile } from './catalog'
import {
  footprintDepthM,
  footprintWidthM,
  gridColumnPositions,
  resolveColumnProfile,
  resolveMainBeamProfile,
  resolveSecondaryBeamProfile,
  resolveTierElevations,
  SECONDARY_BEAM_SPACING_M,
} from './metrics'
import {
  EDGES,
  edgeGeometry,
  postSpacingM,
  railingSpans,
  stairOrigin,
  tierVoidRects,
} from './railing'
import type { MezzanineNode } from './schema'
import {
  HANDRAIL_HEIGHT_M,
  KICKBOARD_HEIGHT_M,
  type Rect,
  rectsOverlap,
  resolveSteps,
} from './stairs'

export type MezzaninePartRole =
  | 'column'
  | 'main-beam'
  | 'secondary-beam'
  | 'floor'
  | 'railing'
  | 'kickboard'
  | 'stair-tread'
  | 'stair-stringer'
  | 'gate'

export type MezzaninePart = {
  role: MezzaninePartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

/**
 * Kolon: dikey ekstrüzyon, kesit X-Z düzleminde (h→Z, b→X). Yapının TAM
 * yüksekliği boyunca tek parça — gerçek mezzanine'de kolon tüm katları
 * kesintisiz geçer, kirişler ona braketle bağlanır.
 */
function pushColumn(
  parts: MezzaninePart[],
  gx: number,
  gz: number,
  heightM: number,
  profile: IBeamProfile,
): void {
  const { h, b, tw, tf } = profile
  parts.push({ role: 'column', center: [gx, heightM / 2, gz], size: [tw, heightM, h - 2 * tf] })
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'column',
      center: [gx, heightM / 2, gz + (side * (h - tf)) / 2],
      size: [b, heightM, tf],
    })
  }
}

/** X boyunca ekstrüde kiriş; `topY` üst flanşın ÜST yüzü. */
function pushBeamAlongX(
  parts: MezzaninePart[],
  role: 'main-beam' | 'secondary-beam',
  x0: number,
  x1: number,
  z: number,
  topY: number,
  profile: IBeamProfile,
): void {
  const { h, b, tw, tf } = profile
  const length = x1 - x0
  const midX = (x0 + x1) / 2
  const midY = topY - h / 2
  parts.push({ role, center: [midX, midY, z], size: [length, h - 2 * tf, tw] })
  for (const side of [-1, 1] as const) {
    parts.push({
      role,
      center: [midX, midY + (side * (h - tf)) / 2, z],
      size: [length, tf, b],
    })
  }
}

/** Z boyunca ekstrüde ikincil kiriş; `topY` üst flanşın ÜST yüzü. */
function pushBeamAlongZ(
  parts: MezzaninePart[],
  z0: number,
  z1: number,
  x: number,
  topY: number,
  profile: IBeamProfile,
): void {
  const { h, b, tw, tf } = profile
  const length = z1 - z0
  const midZ = (z0 + z1) / 2
  const midY = topY - h / 2
  parts.push({
    role: 'secondary-beam',
    center: [x, midY, midZ],
    size: [tw, h - 2 * tf, length],
  })
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'secondary-beam',
      center: [x, midY + (side * (h - tf)) / 2, midZ],
      size: [b, tf, length],
    })
  }
}

/**
 * Bir tier'in kiriş seti. `deckUndersideY` döşeme panelinin ALT yüzü —
 * ikincil kirişler oraya dayanır, ana kirişler onların altına.
 */
function pushTierBeams(parts: MezzaninePart[], node: MezzanineNode, deckUndersideY: number): void {
  const { baysY, bayDepthM } = node.grid
  const halfWidth = footprintWidthM(node) / 2
  const halfDepth = footprintDepthM(node) / 2
  const mainProfile = resolveMainBeamProfile(node)
  const secondaryProfile = resolveSecondaryBeamProfile(node)

  const secondaryTopY = deckUndersideY
  const mainTopY = secondaryTopY - secondaryProfile.h

  for (let iz = 0; iz <= baysY; iz++) {
    const z = -halfDepth + iz * bayDepthM
    pushBeamAlongX(parts, 'main-beam', -halfWidth, halfWidth, z, mainTopY, mainProfile)
  }

  const secondaryCount = Math.max(1, Math.round(footprintWidthM(node) / SECONDARY_BEAM_SPACING_M))
  for (let i = 0; i <= secondaryCount; i++) {
    const x = -halfWidth + (i / secondaryCount) * footprintWidthM(node)
    pushBeamAlongZ(parts, -halfDepth, halfDepth, x, secondaryTopY, secondaryProfile)
  }
}

/**
 * Döşeme — TEK kutu değil, göz başına panel.
 *
 * Merdiven boşluğu bir CSG kesimi DEĞİL: boşlukla çakışan paneller hiç
 * üretilmez (v1.0 raporunun kendi kuralı — 15.000 m² ölçekte boolean kesim
 * kabul edilemez, panel dışlama O(1) süzgeç). Panel ızgarası göz
 * ızgarasının aynısı, yani bir boşluk en fazla kendi gözünü siler.
 */
function pushFloorPanels(
  parts: MezzaninePart[],
  node: MezzanineNode,
  deckTopY: number,
  thicknessM: number,
  voids: readonly Rect[],
): void {
  const { baysX, baysY, bayWidthM, bayDepthM } = node.grid
  const halfWidth = footprintWidthM(node) / 2
  const halfDepth = footprintDepthM(node) / 2
  const centerY = deckTopY - thicknessM / 2

  for (let ix = 0; ix < baysX; ix++) {
    for (let iz = 0; iz < baysY; iz++) {
      const x0 = -halfWidth + ix * bayWidthM
      const z0 = -halfDepth + iz * bayDepthM
      const cell: Rect = { x0, z0, x1: x0 + bayWidthM, z1: z0 + bayDepthM }
      if (voids.some((rect) => rectsOverlap(cell, rect))) continue
      parts.push({
        role: 'floor',
        center: [x0 + bayWidthM / 2, centerY, z0 + bayDepthM / 2],
        size: [bayWidthM, thicknessM, bayDepthM],
      })
    }
  }
}

/** Korkuluk profil kesitleri — görsel sabitler, katalog yayınlamıyor. */
const RAIL_SECTION_M = 0.04
const POST_SECTION_M = 0.05
const KICKBOARD_THICKNESS_M = 0.015

/**
 * Bir tier'in korkuluğu: dolu parçalar boyunca üst küpeşte, ara kayıt ve
 * süpürgelik + direk aralığına göre dikmeler.
 *
 * Açıklıklar (kapı, güvenlik bölgesi, merdiven ağzı) burada değil
 * `railing.ts`'te belirleniyor — korkuluk onların bir FONKSİYONU, listesi
 * değil.
 */
function pushRailing(
  parts: MezzaninePart[],
  node: MezzanineNode,
  tier: MezzanineNode['tiers'][number],
  deckTopY: number,
): void {
  const spacing = postSpacingM(node)

  for (const edge of EDGES) {
    const geo = edgeGeometry(node, edge)
    // Korkuluk kenarın hemen içinde durur — dışa taşan bir küpeşte, taban
    // izinin dışına çıkar ve komşu bir mezzanine'le çakışırdı.
    const inset = geo.outward * -(POST_SECTION_M / 2)
    const fixed = geo.fixed + inset

    for (const span of railingSpans(node, tier, edge)) {
      const length = span.toM - span.fromM
      const mid = (span.fromM + span.toM) / 2

      const along = (value: number, y: number, size: readonly [number, number, number]) =>
        geo.axis === 'x'
          ? { center: [value, y, fixed] as const, size }
          : { center: [fixed, y, value] as const, size }

      const barSize: readonly [number, number, number] =
        geo.axis === 'x'
          ? [length, RAIL_SECTION_M, RAIL_SECTION_M]
          : [RAIL_SECTION_M, RAIL_SECTION_M, length]

      // Üst küpeşte ve ara kayıt.
      for (const y of [deckTopY + HANDRAIL_HEIGHT_M, deckTopY + HANDRAIL_HEIGHT_M / 2]) {
        const bar = along(mid, y, barSize)
        parts.push({ role: 'railing', center: bar.center, size: bar.size })
      }

      // Süpürgelik: döşemeden yukarı, düşen bir aletin durduğu yer.
      const kickSize: readonly [number, number, number] =
        geo.axis === 'x'
          ? [length, KICKBOARD_HEIGHT_M, KICKBOARD_THICKNESS_M]
          : [KICKBOARD_THICKNESS_M, KICKBOARD_HEIGHT_M, length]
      const kick = along(mid, deckTopY + KICKBOARD_HEIGHT_M / 2, kickSize)
      parts.push({ role: 'kickboard', center: kick.center, size: kick.size })

      // Dikmeler: aralık kurucu sistemin yayınlanmış üst sınırından, iki uç
      // her zaman dahil.
      const posts = Math.max(1, Math.ceil(length / spacing))
      for (let i = 0; i <= posts; i++) {
        const value = span.fromM + (i / posts) * length
        const post = along(value, deckTopY + HANDRAIL_HEIGHT_M / 2, [
          POST_SECTION_M,
          HANDRAIL_HEIGHT_M,
          POST_SECTION_M,
        ])
        parts.push({ role: 'railing', center: post.center, size: post.size })
      }
    }
  }
}

/**
 * Merdiven: basamaklar + iki limon kirişi.
 *
 * Basamak sayısı ve basış GERÇEK kot farkından (`resolveSteps`); yerleşimi
 * `stairOrigin`'den. Sahanlıklı merdivende ikinci kol geri katlanır —
 * basamaklar tek kolda çizilir ve sahanlık düz bir platform olarak eklenir.
 */
function pushStaircase(
  parts: MezzaninePart[],
  node: MezzanineNode,
  stair: MezzanineNode['tiers'][number]['accessories']['staircases'][number],
  fromY: number,
  toY: number,
): void {
  const { geometry } = resolveSteps(stair, toY - fromY)
  const origin = stairOrigin(node, stair)
  const cos = Math.cos(origin.rotationRad)
  const sin = Math.sin(origin.rotationRad)

  // Yerel çerçeve: genişlik X'te, iniş +Z'de. Dünyaya döndürülür.
  const place = (localX: number, localZ: number): [number, number] => [
    origin.x + localX * cos - localZ * sin,
    origin.z + localX * sin + localZ * cos,
  ]

  const treadThickness = 0.03
  for (let step = 1; step <= geometry.steps; step++) {
    const y = fromY + geometry.riseM * step
    const localZ = geometry.goingM * (step - 0.5)
    const [x, z] = place(0, localZ)
    parts.push({
      role: 'stair-tread',
      center: [x, y - treadThickness / 2, z],
      // Döndürülmüş bir basamağı eksen hizalı kutuyla çizmek 90°'nin
      // katları dışında yaklaşıklıktır; merdivenler kenara oturduğunda
      // (baskın durum) dönüş tam olarak 0/±90/180°.
      size: [
        Math.abs(stair.widthM * cos) + Math.abs(geometry.treadDepthM * sin),
        treadThickness,
        Math.abs(stair.widthM * sin) + Math.abs(geometry.treadDepthM * cos),
      ],
    })
  }

  // Limon kirişleri: iki yanda, tırmanışı boyunca eğik — eksen hizalı
  // kutuyla eğim çizilemediği için basamak altını dolduran düz bir kiriş
  // olarak çizilir (rack'ın çaprazları için `tiltX` var, mezzanine'in
  // parça tipinde dönüş alanı yok ve bunun için açmaya değmez).
  const runZ = geometry.goingM * geometry.steps
  for (const side of [-1, 1] as const) {
    const [x, z] = place((side * stair.widthM) / 2, runZ / 2)
    parts.push({
      role: 'stair-stringer',
      center: [x, (fromY + toY) / 2, z],
      size: [
        Math.abs(0.05 * cos) + Math.abs(runZ * sin),
        toY - fromY,
        Math.abs(0.05 * sin) + Math.abs(runZ * cos),
      ],
    })
  }
}

/** Kapı kanadı — korkuluğun açıklığında duran tek panel. */
function pushGates(
  parts: MezzaninePart[],
  node: MezzanineNode,
  tier: MezzanineNode['tiers'][number],
  deckTopY: number,
): void {
  const gates = [
    ...tier.accessories.swingGates.map((gate) => ({ ...gate, kind: 'swing' as const })),
    ...tier.accessories.upAndOverGates.map((gate) => ({ ...gate, kind: 'up-and-over' as const })),
  ]
  for (const gate of gates) {
    const geo = edgeGeometry(node, gate.edge)
    const along = geo.startM + gate.offsetM
    const size: readonly [number, number, number] =
      geo.axis === 'x'
        ? [gate.widthM, HANDRAIL_HEIGHT_M, RAIL_SECTION_M]
        : [RAIL_SECTION_M, HANDRAIL_HEIGHT_M, gate.widthM]
    const center: readonly [number, number, number] =
      geo.axis === 'x'
        ? [along, deckTopY + HANDRAIL_HEIGHT_M / 2, geo.fixed]
        : [geo.fixed, deckTopY + HANDRAIL_HEIGHT_M / 2, along]
    parts.push({ role: 'gate', center, size })
  }
}

/**
 * Bütün mezzanine'in parça listesi — geometri havuzunun tükettiği tek yer.
 */
export function mezzanineParts(node: MezzanineNode): MezzaninePart[] {
  const parts: MezzaninePart[] = []
  const resolved = resolveTierElevations(node.tiers)
  const last = resolved[resolved.length - 1]
  const columnTop = last ? last.deckTopM : 0

  const columnProfile = resolveColumnProfile(node)
  for (const point of gridColumnPositions(node)) {
    pushColumn(parts, point.x, point.z, columnTop, columnProfile)
    if (node.columnType === 'double') {
      pushColumn(parts, point.x, point.z + columnProfile.b, columnTop, columnProfile)
    }
  }

  for (const tier of resolved) {
    const thickness = FLOOR_TYPES[tier.floorType].structuralDepthM
    const deckTop = tier.deckTopM
    // Merdiven bu tier'e ALTINDAKİNDEN çıkar; en alttaki zeminden.
    const fromY = tier.resolvedElevationM
    const elevationDelta = deckTop - fromY

    const voids = tierVoidRects(node, tier, elevationDelta)

    pushTierBeams(parts, node, deckTop - thickness)
    pushFloorPanels(parts, node, deckTop, thickness, voids)
    pushRailing(parts, node, tier, deckTop)
    pushGates(parts, node, tier, deckTop)

    for (const stair of tier.accessories.staircases) {
      pushStaircase(parts, node, stair, fromY, deckTop)
    }
  }

  return parts
}
