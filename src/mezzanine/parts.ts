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

import {
  CONSTRUCTIVE_SYSTEMS,
  FLOOR_TYPES,
  GATE_SPECS,
  type IBeamProfile,
  STAIRCASE_GEOMETRY,
} from './catalog'
import {
  footprintDepthM,
  footprintWidthM,
  gridColumnPositions,
  hasCustomOutline,
  outlinePolygon,
  pointInPolygon,
  resolveColumnProfile,
  resolveMainBeamProfile,
  resolveSecondaryBeamProfile,
  resolveTierElevations,
  SECONDARY_BEAM_SPACING_M,
} from './metrics'
import {
  edgeGeometry,
  outlineEdgeSpans,
  outlineEdges,
  postSpacingM,
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
  /** Kollar arasındaki sahanlık. `floor` DEĞİL: döşeme paneliyle aynı role
   *  konsaydı panel sayısına karışır ve "boşluk kaç panel siliyor" sorusu
   *  cevaplanamaz hâle gelirdi. */
  | 'stair-landing'
  | 'gate'
  | 'gate-post'
  | 'gate-pivot'
  /** Kolon taban plakası ve ankrajları. */
  | 'footplate'

export type MezzaninePart = {
  role: MezzaninePartRole
  /**
   * Hangi kata ait — 0 tabandan.
   *
   * Yalnız patlatma için var: host'un patlatılmış görünümünde bir kat
   * içindekiyle birlikte kalkıyor ve bir asma katın da kendi katlarını aynı
   * şekilde ayırması isteniyor. Etiket olmadan hangi kutunun hangi katla
   * kalkacağı bilinemez.
   *
   * Katı olmayan bir parça YOK ve bu bilinçli: kolonlar bile kat başına
   * BÖLÜNDÜ (bkz. `pushColumn`), çünkü güvertesi kalkarken kolonu yerinde
   * kalan bir kat havada asılı dururdu.
   */
  tier: number
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  /**
   * Plan düzleminde dönüş. Merdiven kolları için: bir kol yalnız kendi
   * yönünde uzanır ve kolun yönü sahanlık tipine göre değişir, o yüzden
   * eksen hizalı bir kutuyla ifade edilemez.
   */
  rotationY?: number
  /** ZY düzleminde eğim — merdiven küpeştesi ve limon kirişi kullanır. */
  tiltX?: number
}

/**
 * Kat etiketi HENÜZ basılmamış bir parça.
 *
 * Üreticiyle tüketiciyi ayırıyor: dokuz yardımcı fonksiyon (kiriş, döşeme,
 * korkuluk, kapı, merdiven…) kendi katını bilmiyor ve bilmesi de gerekmiyor —
 * `mezzanineParts` her katın çağrılarını bir aralık olarak sarıp damgayı
 * sonradan vuruyor. Etiketi dokuz imzaya parametre olarak geçirmek, birinde
 * unutulduğunda SESSİZCE yanlış katta duran bir kutu üretirdi; aralık damgası
 * unutulamaz.
 */
export type MezzaninePartDraft = Omit<MezzaninePart, 'tier'> & { tier?: number }

/**
 * Kolon: dikey ekstrüzyon, kesit X-Z düzleminde (h→Z, b→X). Yapının TAM
 * yüksekliği boyunca tek parça — gerçek mezzanine'de kolon tüm katları
 * kesintisiz geçer, kirişler ona braketle bağlanır.
 */
/** Kolon taban plakası ve ankraj ölçüleri (ASSUMPTION — katalog bileşen
 *  listesinde var, kesit yayınlamıyor). */
const BASE_PLATE_THICKNESS_M = 0.02
const BASE_PLATE_OVERHANG = 1.7
const COLUMN_ANCHOR_M = 0.024
const COLUMN_ANCHOR_HEIGHT_M = 0.05

/**
 * Bir kolon PARÇASI — `y0`'dan `y1`'e.
 *
 * Kolon gerçek yapıda tüm katları kesintisiz geçer ve bu fonksiyon onu
 * bölmüyor: `y0`–`y1` aralıkları uç uca eklendiğinde geometri eskisinin
 * aynısı. Bölünen şey kolonun kendisi değil, hangi KATA ait sayıldığı — ve
 * bunun tek sebebi patlatma: host'un patlatılmış görünümünde bir kat
 * içindekiyle birlikte kalkar, yani bir asma katın da her katı kendi kolon
 * boyunu taşımalı. Aksi hâlde güverteler kolonlardan sıyrılıp havada asılı
 * kalırdı.
 *
 * Taban plakası yalnız zemine basan parçada: ikinci bir plaka, birinci katın
 * ortasında havada duran bir çelik levha demekti.
 */
function pushColumn(
  parts: MezzaninePartDraft[],
  gx: number,
  gz: number,
  y0: number,
  y1: number,
  profile: IBeamProfile,
  tier: number,
): void {
  const { h, b, tw, tf } = profile
  const heightM = y1 - y0
  if (heightM <= 0) return
  const midY = y0 + heightM / 2
  parts.push({ role: 'column', tier, center: [gx, midY, gz], size: [tw, heightM, h - 2 * tf] })
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'column',
      tier,
      center: [gx, midY, gz + (side * (h - tf)) / 2],
      size: [b, heightM, tf],
    })
  }

  // Taban plakası + dört ankraj — YALNIZ zemine basan parçada. Kolon zemine
  // çıplak profil kesiti olarak dayanıyordu; katalogun kendi bileşen listesi
  // (taban plakası, ankraj) hiç çizilmiyordu ve yapı yere "saplanmış"
  // görünüyordu.
  if (y0 > 1e-9) return
  const plateW = b * BASE_PLATE_OVERHANG
  const plateD = h * BASE_PLATE_OVERHANG
  parts.push({
    role: 'footplate',
    tier,
    center: [gx, BASE_PLATE_THICKNESS_M / 2, gz],
    size: [plateW, BASE_PLATE_THICKNESS_M, plateD],
  })
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      parts.push({
        role: 'footplate',
        tier,
        center: [
          gx + (sx * plateW) / 2.6,
          BASE_PLATE_THICKNESS_M + COLUMN_ANCHOR_HEIGHT_M / 2,
          gz + (sz * plateD) / 2.6,
        ],
        size: [COLUMN_ANCHOR_M, COLUMN_ANCHOR_HEIGHT_M, COLUMN_ANCHOR_M],
      })
    }
  }
}

/** X boyunca ekstrüde kiriş; `topY` üst flanşın ÜST yüzü. */
function pushBeamAlongX(
  parts: MezzaninePartDraft[],
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
  parts: MezzaninePartDraft[],
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
function pushTierBeams(
  parts: MezzaninePartDraft[],
  node: MezzanineNode,
  deckUndersideY: number,
): void {
  const { baysY, bayDepthM } = node.grid
  const halfWidth = footprintWidthM(node) / 2
  const halfDepth = footprintDepthM(node) / 2
  const mainProfile = resolveMainBeamProfile(node)
  const secondaryProfile = resolveSecondaryBeamProfile(node)

  const secondaryTopY = deckUndersideY
  // GL2000 ikincil kirişi ana kirişe GÖMER: ikisi aynı üst kotu paylaşır ve
  // yapı bir ikincil-kiriş derinliği kadar YUKARI çıkar. Yan yana istifleyen
  // sistemlerde ana kiriş ikincilin altına oturur. Katalogun
  // `secondaryBeamEmbedded` verisi buraya kadar hiç okunmuyordu — yapı her
  // sistemde gerçek üründen bir IPE derinliği aşağıda duruyordu.
  const mainTopY = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem].secondaryBeamEmbedded
    ? secondaryTopY
    : secondaryTopY - secondaryProfile.h

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
  parts: MezzaninePartDraft[],
  node: MezzanineNode,
  deckTopY: number,
  thicknessM: number,
  voids: readonly Rect[],
): void {
  const { bayWidthM, bayDepthM } = node.grid
  const centerY = deckTopY - thicknessM / 2
  const outline = outlinePolygon(node)
  const custom = hasCustomOutline(node)

  // Panel ızgarası kolon aksıyla AYNI hizada olmak zorunda — paneller
  // kirişlerin arasına oturuyor. Özel şekilde aks orijine sabitli.
  const xs = outline.map(([x]) => x)
  const zs = outline.map(([, z]) => z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const startIx = custom ? Math.floor(minX / bayWidthM) : -node.grid.baysX / 2
  const endIx = custom ? Math.ceil(maxX / bayWidthM) : node.grid.baysX / 2
  const startIz = custom ? Math.floor(minZ / bayDepthM) : -node.grid.baysY / 2
  const endIz = custom ? Math.ceil(maxZ / bayDepthM) : node.grid.baysY / 2

  for (let ix = startIx; ix < endIx; ix++) {
    for (let iz = startIz; iz < endIz; iz++) {
      const x0 = ix * bayWidthM
      const z0 = iz * bayDepthM
      const cell: Rect = { x0, z0, x1: x0 + bayWidthM, z1: z0 + bayDepthM }
      if (voids.some((rect) => rectsOverlap(cell, rect))) continue
      // Poligon dışı hücre hiç üretilmiyor — merdiven boşluğuyla aynı
      // dışlama deseni, CSG yok. Ölçüt hücre MERKEZİ: kenardan taşan yarım
      // panel çizmek, döşemenin poligonun dışına sarkması demekti.
      if (custom && !pointInPolygon(x0 + bayWidthM / 2, z0 + bayDepthM / 2, outline)) continue
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

/** Kanat kapının içeri açılırken dayandığı tamponun kenardan ofseti. */
const GATE_BUMPER_OFFSET_M = 0.12
/**
 * Yukarı-devrilir kapının yatay kanadının üstünde durduğu varsayılan palet
 * yığını yüksekliği — katalogun "palet üstü 300 mm serbest" ölçüsü bir
 * palete GÖRE veriliyor, o yüzden bir referans yüksekliği gerekiyor
 * (ASSUMPTION: EPAL + tipik yük).
 */
const PALLET_STACK_REFERENCE_M = 1.2
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
  parts: MezzaninePartDraft[],
  node: MezzanineNode,
  tier: MezzanineNode['tiers'][number],
  deckTopY: number,
): void {
  const spacing = postSpacingM(node)

  /**
   * Korkuluk ANAHAT kenarlarını takip ediyor, sınır dikdörtgenini değil.
   *
   * Dikdörtgen mezzanine'de dört kenar dört kardinale birebir düşüyor ve
   * sonuç eski dört-kenar döngüsünün aynısı; L şeklinde ise korkuluk
   * çentiği de dönüyor. Eskiden döşeme şekli takip ediyor ama korkuluk
   * dikdörtgen kalıyordu — açık kenar korkuluksuz, olmayan kenar
   * korkulukluydu.
   */
  for (const edge of outlineEdges(node)) {
    const dx = edge.b[0] - edge.a[0]
    const dz = edge.b[1] - edge.a[1]
    const ux = dx / edge.lengthM
    const uz = dz / edge.lengthM
    // Kenarın hemen İÇİNDE durur — dışa taşan bir küpeşte taban izinin
    // dışına çıkar ve komşu bir mezzanine'le çakışırdı.
    const insetX = -edge.outward[0] * (POST_SECTION_M / 2)
    const insetZ = -edge.outward[1] * (POST_SECTION_M / 2)
    // Kenar yönü: eksen hizalı olmayan bir kenar ancak dönüşle çizilebilir.
    const yaw = Math.atan2(dz, dx)

    /** Kenar parametresinden dünya konumuna. */
    const at = (value: number, y: number): readonly [number, number, number] => [
      edge.a[0] + ux * value + insetX,
      y,
      edge.a[1] + uz * value + insetZ,
    ]

    for (const span of outlineEdgeSpans(tier, edge)) {
      const length = span.toM - span.fromM
      const mid = (span.fromM + span.toM) / 2

      // Üst küpeşte ve ara kayıt.
      for (const y of [deckTopY + HANDRAIL_HEIGHT_M, deckTopY + HANDRAIL_HEIGHT_M / 2]) {
        parts.push({
          role: 'railing',
          center: at(mid, y),
          size: [length, RAIL_SECTION_M, RAIL_SECTION_M],
          rotationY: -yaw,
        })
      }

      // Süpürgelik: döşemeden yukarı, düşen bir aletin durduğu yer.
      parts.push({
        role: 'kickboard',
        center: at(mid, deckTopY + KICKBOARD_HEIGHT_M / 2),
        size: [length, KICKBOARD_HEIGHT_M, KICKBOARD_THICKNESS_M],
        rotationY: -yaw,
      })

      // Dikmeler: aralık kurucu sistemin yayınlanmış üst sınırından, iki uç
      // her zaman dahil.
      const posts = Math.max(1, Math.ceil(length / spacing))
      for (let i = 0; i <= posts; i++) {
        parts.push({
          role: 'railing',
          center: at(span.fromM + (i / posts) * length, deckTopY + HANDRAIL_HEIGHT_M / 2),
          size: [POST_SECTION_M, HANDRAIL_HEIGHT_M, POST_SECTION_M],
        })
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
const STAIR_TREAD_THICKNESS_M = 0.03
const STRINGER_THICKNESS_M = 0.05
/** Kol boyunca korkuluk dikmesi aralığı — küpeşte sarkmasın. */
const STAIR_POST_SPACING_M = 1.2

/**
 * Bir merdiven kolunun yerel çerçevesi.
 *
 * Kol kendi yönünde uzanır ve yön sahanlık tipine göre değişir; bu yüzden
 * her kol kendi YAW'ıyla taşınıyor ve parçalar `rotationY` ile emit
 * ediliyor. Eksen hizalı kutu yaklaşıklığı ile çizilseydi, geri katlanan
 * ya da yana dönen bir kol yanlış yerde durur.
 */
type FlightFrame = {
  /** Kolun başlangıcı, merdiven-yerel (x, z). */
  ox: number
  oz: number
  /** Kolun yönü, birim vektör (merdiven-yerel). */
  dx: number
  dz: number
  /** Kolun kendi yaw'ı — yerel +Z'yi kol yönüne çeviren dönüş. */
  yaw: number
  steps: number
  /** Kolun ilk basamağının altındaki kot. */
  baseY: number
}

/**
 * Kolların yerleşimi — sahanlık tipinin geometriye döküldüğü yer.
 *
 *   - `continuous` (ve 15 basamak kuralıyla otomatik bölünen): kollar aynı
 *     doğrultuda devam eder, aralarına sahanlık girer.
 *   - `turn180` (dog-leg): ikinci kol GERİ katlanır ve birincinin yanına
 *     gelir — bu yüzden `lateralM` iki kol genişliği.
 *   - `turn90`: ikinci kol yana döner.
 */
function flightFrames(
  stair: MezzanineNode['tiers'][number]['accessories']['staircases'][number],
  geometry: ReturnType<typeof resolveSteps>['geometry'],
  fromY: number,
): FlightFrame[] {
  const { flights, stepsPerFlight, steps, riseM, flightRunM } = geometry
  const landing = STAIRCASE_GEOMETRY.landingLengthMinM
  const frames: FlightFrame[] = []

  for (let f = 0; f < flights; f++) {
    const stepsHere = Math.min(stepsPerFlight, steps - f * stepsPerFlight)
    if (stepsHere <= 0) break
    const baseY = fromY + riseM * stepsPerFlight * f

    if (stair.landing === 'turn180' && f % 2 === 1) {
      // Geri katlanır: yanına kayar ve ters yöne iner.
      frames.push({
        ox: stair.widthM,
        oz: flightRunM,
        dx: 0,
        dz: -1,
        yaw: Math.PI,
        steps: stepsHere,
        baseY,
      })
      continue
    }
    if (stair.landing === 'turn90' && f % 2 === 1) {
      // Yana döner: sahanlıktan +X yönünde devam eder.
      frames.push({
        ox: stair.widthM / 2 + landing / 2,
        oz: flightRunM + landing / 2,
        dx: 1,
        dz: 0,
        yaw: -Math.PI / 2,
        steps: stepsHere,
        baseY,
      })
      continue
    }
    // Düz devam: her kol bir önceki kolun ve sahanlığın ötesinde başlar.
    frames.push({
      ox: 0,
      oz: f * (flightRunM + landing),
      dx: 0,
      dz: 1,
      yaw: 0,
      steps: stepsHere,
      baseY,
    })
  }
  return frames
}

function pushStaircase(
  parts: MezzaninePartDraft[],
  node: MezzanineNode,
  stair: MezzanineNode['tiers'][number]['accessories']['staircases'][number],
  fromY: number,
  toY: number,
): void {
  const { geometry } = resolveSteps(stair, toY - fromY)
  const origin = stairOrigin(node, stair)
  const cos = Math.cos(origin.rotationRad)
  const sin = Math.sin(origin.rotationRad)

  // Merdiven-yerel → dünya. Yerel çerçeve: genişlik X'te, tırmanış +Z'de.
  const place = (localX: number, localZ: number): [number, number] => [
    origin.x + localX * cos - localZ * sin,
    origin.z + localX * sin + localZ * cos,
  ]

  const slope = Math.atan2(geometry.riseM, geometry.goingM)
  const landing = STAIRCASE_GEOMETRY.landingLengthMinM
  const frames = flightFrames(stair, geometry, fromY)

  for (const [index, frame] of frames.entries()) {
    const yaw = origin.rotationRad + frame.yaw
    /** Kol-yerel (yanal, boyuna) → dünya (x, z). */
    const atFlight = (lateral: number, along: number): [number, number] =>
      place(
        frame.ox + frame.dx * along - frame.dz * lateral,
        frame.oz + frame.dz * along + frame.dx * lateral,
      )

    // ── Basamaklar ────────────────────────────────────────────────────
    for (let step = 1; step <= frame.steps; step++) {
      const y = frame.baseY + geometry.riseM * step
      const [x, z] = atFlight(0, geometry.goingM * (step - 0.5))
      parts.push({
        role: 'stair-tread',
        center: [x, y - STAIR_TREAD_THICKNESS_M / 2, z],
        size: [stair.widthM, STAIR_TREAD_THICKNESS_M, geometry.treadDepthM],
        rotationY: yaw,
      })
    }

    const flightRun = geometry.goingM * frame.steps
    const flightRise = geometry.riseM * frame.steps
    // Eğik elemanın gerçek boyu — düz boy verilse uçlarda kısa kalırdı.
    const slopedLength = Math.hypot(flightRun, flightRise)
    const midY = frame.baseY + flightRise / 2

    // ── Limon kirişleri: artık gerçekten EĞİK ─────────────────────────
    for (const side of [-1, 1] as const) {
      const [x, z] = atFlight((side * stair.widthM) / 2, flightRun / 2)
      parts.push({
        role: 'stair-stringer',
        center: [x, midY, z],
        size: [STRINGER_THICKNESS_M, STRINGER_THICKNESS_M * 4, slopedLength],
        rotationY: yaw,
        // +Z ucu YÜKSEK: tırmanış yönü.
        tiltX: -slope,
      })
    }

    // ── Korkuluk: kolun açık kenarları ────────────────────────────────
    //
    // Korkuluksuz bir merdiven kolu yayınlanabilir bir çıktı değil — bu
    // kind'ın korkuluk kuralı döşeme çevresinde zaten zorunlu, merdiven
    // kolunda da öyle olmak zorunda. `railings` katalog seçeneği: bir
    // yanda (duvara dayalı) ya da iki yanda.
    const railSides: readonly (-1 | 1)[] = stair.railings === 1 ? [1] : [-1, 1]
    for (const side of railSides) {
      const lateral = (side * stair.widthM) / 2
      for (const height of [HANDRAIL_HEIGHT_M, HANDRAIL_HEIGHT_M / 2] as const) {
        const [x, z] = atFlight(lateral, flightRun / 2)
        parts.push({
          role: 'railing',
          center: [x, midY + height, z],
          size: [RAIL_SECTION_M, RAIL_SECTION_M, slopedLength],
          rotationY: yaw,
          tiltX: -slope,
        })
      }
      // Dikmeler: küpeşteyi taşıyan düşey elemanlar.
      const postCount = Math.max(2, Math.round(flightRun / STAIR_POST_SPACING_M))
      for (let i = 0; i <= postCount; i++) {
        const along = (i / postCount) * flightRun
        const [x, z] = atFlight(lateral, along)
        const railY = frame.baseY + (along / Math.max(flightRun, 1e-6)) * flightRise
        parts.push({
          role: 'railing',
          center: [x, railY + HANDRAIL_HEIGHT_M / 2, z],
          size: [POST_SECTION_M, HANDRAIL_HEIGHT_M, POST_SECTION_M],
          rotationY: yaw,
        })
      }
    }

    // ── Sahanlık platformu ────────────────────────────────────────────
    //
    // Kollar arasında gerçek bir düzlem: `turn90`/`turn180` yalnız
    // `flights = 2` deyip hiçbir platform çizmiyordu, yani kullanıcı iki
    // kol arasında boşluğa basıyordu.
    if (index < frames.length - 1) {
      const topY = frame.baseY + flightRise
      const [x, z] = atFlight(0, flightRun + landing / 2)
      const spansTwoFlights = stair.landing === 'turn180'
      parts.push({
        role: 'stair-landing',
        center: [
          spansTwoFlights ? x + (stair.widthM / 2) * cos : x,
          topY - STAIR_TREAD_THICKNESS_M / 2,
          spansTwoFlights ? z + (stair.widthM / 2) * sin : z,
        ],
        size: [spansTwoFlights ? stair.widthM * 2 : stair.widthM, STAIR_TREAD_THICKNESS_M, landing],
        rotationY: yaw,
      })
    }
  }
}

/** Kapı kanadı — korkuluğun açıklığında duran tek panel. */
function pushGates(
  parts: MezzaninePartDraft[],
  node: MezzanineNode,
  tier: MezzanineNode['tiers'][number],
  deckTopY: number,
): void {
  const gates = [
    ...tier.accessories.swingGates.map((gate) => ({ ...gate, kind: 'swing' as const })),
    ...tier.accessories.upAndOverGates.map((gate) => ({ ...gate, kind: 'up-and-over' as const })),
  ]

  /** Kenar eksenine göre (boyuna, dikey, enine) → (x, y, z). */
  const place = (
    geo: ReturnType<typeof edgeGeometry>,
    along: number,
    y: number,
    across: number,
  ): readonly [number, number, number] =>
    geo.axis === 'x' ? [along, y, geo.fixed + across] : [geo.fixed + across, y, along]
  const span = (
    geo: ReturnType<typeof edgeGeometry>,
    lengthAlong: number,
    height: number,
    depthAcross: number,
  ): readonly [number, number, number] =>
    geo.axis === 'x' ? [lengthAlong, height, depthAcross] : [depthAcross, height, lengthAlong]

  for (const gate of gates) {
    const geo = edgeGeometry(node, gate.edge)
    const along = geo.startM + gate.offsetM

    if (gate.kind === 'swing') {
      /**
       * Kanat kapı: korkuluk hattındaki menteşeli bir kanat. Kapalı hâlde
       * çizilir (istirahat konumu), ama menteşe ve kilit dikmeleri hangi
       * uçtan döndüğünü söyler — kapı bir korkuluk boşluğu değil, bir
       * mekanizma.
       */
      parts.push({
        role: 'gate',
        center: place(geo, along, deckTopY + HANDRAIL_HEIGHT_M / 2, 0),
        size: span(geo, gate.widthM, HANDRAIL_HEIGHT_M, RAIL_SECTION_M),
      })
      for (const end of [-1, 1] as const) {
        parts.push({
          role: 'gate-post',
          center: place(geo, along + end * (gate.widthM / 2), deckTopY + HANDRAIL_HEIGHT_M / 2, 0),
          size: span(geo, RAIL_SECTION_M * 1.6, HANDRAIL_HEIGHT_M, RAIL_SECTION_M * 1.6),
        })
      }
      // Tampon: kanadın içeri açılırken dayandığı blok. `opensInward`
      // katalog verisi — kanat DAİMA içeri açılır, dışarı açılan bir kapı
      // operatörü boşluğa iter.
      parts.push({
        role: 'gate-post',
        center: place(geo, along, deckTopY + RAIL_SECTION_M, -geo.outward * GATE_BUMPER_OFFSET_M),
        size: span(geo, gate.widthM * 0.25, RAIL_SECTION_M * 2, RAIL_SECTION_M),
      })
      continue
    }

    /**
     * Yukarı-devrilir kapı: dengelenmiş sallanan tip. Kanatlardan biri
     * daima kapalıdır — palet alınırken dış kanat kalkar, iç kanat iner ve
     * açık kenar HİÇBİR ZAMAN oluşmaz. Bu yüzden iki kanat çiziliyor:
     * biri korkuluk hattında dikey, öteki paletin üstünde yatay.
     *
     * Yatay kanadın kotu `GATE_SPECS.upAndOver.clearHeightAbovePalletM` —
     * katalogun palet üstü serbest yüksekliği. Bu sabit buraya kadar hiç
     * okunmuyordu.
     */
    const clearY =
      deckTopY + PALLET_STACK_REFERENCE_M + GATE_SPECS.upAndOver.clearHeightAbovePalletM
    parts.push({
      role: 'gate',
      center: place(geo, along, deckTopY + HANDRAIL_HEIGHT_M / 2, 0),
      size: span(geo, gate.widthM, HANDRAIL_HEIGHT_M, RAIL_SECTION_M),
    })
    parts.push({
      role: 'gate',
      center: place(geo, along, clearY, -geo.outward * (gate.widthM / 4)),
      size: span(geo, gate.widthM, RAIL_SECTION_M, gate.widthM / 2),
    })
    // Sallanma ekseni: iki kanadı birleştiren mil.
    parts.push({
      role: 'gate-pivot',
      center: place(geo, along, deckTopY + HANDRAIL_HEIGHT_M, 0),
      size: span(geo, gate.widthM * 1.05, RAIL_SECTION_M, RAIL_SECTION_M),
    })
  }
}

/**
 * Bütün mezzanine'in parça listesi — geometri havuzunun tükettiği tek yer.
 */
export function mezzanineParts(node: MezzanineNode): MezzaninePart[] {
  const parts: MezzaninePartDraft[] = []
  const resolved = resolveTierElevations(node.tiers)

  const columnProfile = resolveColumnProfile(node)
  const columnPoints = gridColumnPositions(node)

  for (const [order, tier] of resolved.entries()) {
    /**
     * Bu katın parçaları nerede başlıyor.
     *
     * Etiket beş yardımcının her birine parametre olarak geçirilmek yerine
     * SONRADAN basılıyor, ve gerekçesi şu: beşinden birine eklemeyi unutmak
     * sessizce yanlış katta duran bir kutu üretirdi. Aralık damgası unutulamaz.
     */
    const from = parts.length

    // Kolonun bu kata düşen boyu: bir önceki katın güverte üstünden bu katın
    // güverte üstüne. En alttaki zeminden başlar ve taban plakasını taşır.
    const previous = resolved[order - 1]
    const y0 = previous ? previous.deckTopM : 0
    for (const point of columnPoints) {
      pushColumn(parts, point.x, point.z, y0, tier.deckTopM, columnProfile, order)
      if (node.columnType === 'double') {
        pushColumn(
          parts,
          point.x,
          point.z + columnProfile.b,
          y0,
          tier.deckTopM,
          columnProfile,
          order,
        )
      }
    }

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

    for (let index = from; index < parts.length; index++) {
      const part = parts[index]
      if (part) part.tier = order
    }
  }

  // Damga her aralığa vuruldu, yani her taslak artık tam. Tek dönüşüm noktası
  // burası ve bilerek: `tier`i "opsiyonel ama aslında hep var" bırakmak,
  // tüketicilerin her okumada `?? 0` yazması demekti — ve o `?? 0`, etiketi
  // basmayı unutan bir yardımcıyı sessizce zemin katına koyardı.
  return parts as MezzaninePart[]
}

/** Üst kotu kolonun tepesini veren kat — patlatmanın kolon boyunu buradan
 *  okuyor. Dışa açık, çünkü test onu bağımsız ölçüyor. */
export function tierCount(node: MezzanineNode): number {
  return resolveTierElevations(node.tiers).length
}
