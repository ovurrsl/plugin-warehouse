/**
 * Araç gövde parçaları — kutu listeleri, aile başına bir emitter.
 *
 * İki katman (`full`/`simple`) AYNI gövde kümesini ve aynı dış zarfı üretir;
 * fark yalnız parça sayısındadır. Mast `simple`'da tek Y-ölçekli prizmaya
 * birleştirilmez: teleskopun kademe kayması yok olurdu — bu "daha az parça"
 * değil, farklı bir harekettir — ve `simple`'da var olmayan gövde anahtarları
 * attribute-parite testini yazılamaz hâle getirirdi.
 *
 * Ölçüler `TruckModel`'den okunur; yayınlanmamış görsel detaylar (lastik
 * çapı, mast rayı kesiti) bu dosyada adlandırılmış sabittir ve YALNIZ görsele
 * girer — çarpışma kutusu ve plan zarfı `truck/metrics.ts`'ten okur.
 */

import type { MastRow } from '../handling/masts'
import type { TruckModel } from '../handling/models'
import { forkSpreadM } from './metrics'
import { forkliftParts } from './parts-forklift'
import { palletTruckParts } from './parts-pallet-truck'
import { reachParts } from './parts-reach'
import { turretParts } from './parts-turret'

export type TruckDetail = 'full' | 'simple'

export type TruckPartRole =
  | 'chassis'
  | 'counterweight'
  | 'cowl'
  | 'mast-rail'
  | 'carriage'
  | 'backrest'
  | 'fork'
  | 'overhead-guard'
  | 'cab'
  | 'platform'
  | 'tiller'
  | 'straddle-leg'
  | 'wheel'
  | 'hub'
  | 'guide-roller'
  /** Gövdeyi bölen bel kuşağı / tampon çıtası — koyu, gövde renginden ayrı. */
  | 'belt'
  /** Turuncu çakar — bir depo aracını tek bakışta tanıtan şey. */
  | 'beacon'

/**
 * Hareket eden birimler. Parçalar araç çerçevesinde emit edilir; `stage1` ve
 * `carriage` parçaları DİNLENME pozunda yazılır ve renderer grubu kinematiğin
 * verdiği Y kadar öteler — vertex'ler asla pozu taşımaz (§3.4 kuralı).
 * `cab` yalnız turret'te: man-up kabin, dilim 8'de mast ile yükselecek.
 */
export type TruckBody = 'chassis' | 'steer' | 'mast' | 'stage1' | 'carriage' | 'cab'

export type TruckPart =
  | {
      kind?: 'box'
      role: TruckPartRole
      center: readonly [number, number, number]
      size: readonly [number, number, number]
    }
  | {
      kind: 'cyl'
      role: TruckPartRole
      center: readonly [number, number, number]
      radius: number
      length: number
      axis: 'y' | 'z'
      segments: number
    }
  | {
      kind: 'sloped'
      role: TruckPartRole
      center: readonly [number, number, number]
      size: readonly [number, number, number]
      face: 'front' | 'back'
      drop: number
    }
  | {
      kind: 'beam'
      role: TruckPartRole
      from: readonly [number, number]
      to: readonly [number, number]
      z: number
      thickness: number
      width: number
    }

/**
 * Renk, TOTAL kayıt — ternary zinciri değil: `rack`'te iki rolün tek dala
 * düşüp aynı rengi alması tam bu yüzden yaşandı. Markasız endüstriyel palet;
 * üretici renkleri (RAL 1028 vb.) kasten kullanılmıyor.
 */
export const TRUCK_ROLE_COLORS: Record<TruckPartRole, string> = {
  chassis: '#d98a2b',
  cowl: '#d98a2b',
  counterweight: '#3d434b',
  'mast-rail': '#2e333a',
  carriage: '#2e333a',
  backrest: '#3d434b',
  fork: '#23272d',
  'overhead-guard': '#3d434b',
  cab: '#22262c',
  platform: '#3d434b',
  tiller: '#2e333a',
  'straddle-leg': '#3d434b',
  wheel: '#1a1d21',
  hub: '#8b939e',
  'guide-roller': '#4a525c',
  belt: '#23272d',
  beacon: '#e8a317',
}

/** Zeminle z-çakışmasını önleyen taban payı. T26 "en alçak vertex [0, 1 mm]"
 *  bandının içinde. */
export const GROUND_CLEARANCE = 0.0005

/** Modelin çizdiği gövdeler — beş aile, beş farklı makine. */
export function bodiesOf(model: TruckModel): readonly TruckBody[] {
  switch (model.variant) {
    case 'forklift':
    case 'reach':
      return ['chassis', 'steer', 'mast', 'stage1', 'carriage']
    case 'turret':
      return ['chassis', 'mast', 'stage1', 'cab', 'carriage']
    case 'hand-pallet':
    case 'powered-pallet':
      return ['chassis', 'steer']
    default:
      return ['chassis']
  }
}

/**
 * Aile gövde rengi — beş makine beş kimlik. Donanım rolleri (mast, çatal,
 * tekerlek…) ortak paletten kalır; yalnız gövde/kaput/platform aile rengini
 * giyer. Üretici renkleri kasten değil: markasız, ayırt edilir tonlar.
 */
const VARIANT_BODY_COLOR: Record<TruckModel['variant'], string> = {
  'hand-pallet': '#a83a34',
  'powered-pallet': '#2e6b4f',
  forklift: '#d98a2b',
  reach: '#33608c',
  turret: '#b8892f',
  agv: '#5b636e',
}

const BODY_ROLES: ReadonlySet<TruckPartRole> = new Set(['chassis', 'cowl', 'platform'])

/** Bir parçanın nihai rengi: gövde rolleri aile rengini, gerisi rol paletini. */
export function partColorOf(variant: TruckModel['variant'], role: TruckPartRole): string {
  return BODY_ROLES.has(role) ? VARIANT_BODY_COLOR[variant] : TRUCK_ROLE_COLORS[role]
}

/** Tek dağıtıcı — `spec.variant` üzerinden aile emitter'ına. Her aile kendi
 *  yayınlanmış ölçülerinden çizilir; vekil kutu kalmadı. */
export function truckParts(
  model: TruckModel,
  mastRow: MastRow | null,
  body: TruckBody,
  detail: TruckDetail,
): TruckPart[] {
  switch (model.variant) {
    case 'forklift':
      return forkliftParts(model, mastRow, body, detail)
    case 'reach':
      return reachParts(model, body, detail)
    case 'turret':
      return turretParts(model, body, detail)
    case 'hand-pallet':
    case 'powered-pallet':
      return palletTruckParts(model, body, detail)
    default:
      return []
  }
}

// ── Paylaşılan alt-emitter'lar ──────────────────────────────────────────────
// Çatal aritmetiği beş ailede aynıdır ve çatal ucu düzlemi, palet alma
// mantığının (dilim 8) okuyacağı şeydir — bu yüzden TEK yerde durur.

/**
 * Bir çift çatal, taşıyıcının YEREL çerçevesinde (blade altı y ≈ 0).
 *
 * `full`: topuk + bıçak + incelen uç. `simple`: tam boy ve tam açıklıkta tek
 * bıçak — açıklığı düşürmek plandaki en okunur çizgiyi (iki çatal izi) tek
 * çizgiye indirir ve LOD geçişinde pozisyon zıplaması olarak görünür.
 */
export function pushForkPair(
  parts: TruckPart[],
  args: {
    /** Çatal sırtının (yük yüzü) araç-X'i. */
    faceX: number
    model: TruckModel
    detail: TruckDetail
  },
): void {
  const { s, e, length } = args.model.fork
  const spread = forkSpreadM(args.model)
  const centerZ = (spread - e) / 2
  const bladeY = 0.005 + s / 2

  for (const side of [-1, 1] as const) {
    const z = side * centerZ
    if (args.detail === 'simple') {
      parts.push({
        role: 'fork',
        center: [args.faceX + length / 2, bladeY, z],
        size: [length, s, e],
      })
      continue
    }
    // Bıçak, ucun incelen son 0.15'i hariç.
    parts.push({
      role: 'fork',
      center: [args.faceX + (length - 0.15) / 2, bladeY, z],
      size: [length - 0.15, s, e],
    })
    // İncelen uç: yarı kalınlık, alt yüz hizalı.
    parts.push({
      role: 'fork',
      center: [args.faceX + length - 0.075, 0.005 + s / 4, z],
      size: [0.15, s / 2, e],
    })
    // Topuk: bıçağı taşıyıcıya bağlayan dik parça.
    parts.push({
      role: 'fork',
      center: [args.faceX - 0.03, 0.28, z],
      size: [0.06, 0.56, e],
    })
  }
}

/**
 * Bir lastik — SİLİNDİR, kutu değil: kutu tekerlek, "kutu kutu çizilmiş"
 * görünümünün bir numaralı kaynağıydı. İki katman AYNI sayıda ve AYNI
 * konumda tekerlek üretir; fark yalnız kenar sayısında (§3.2: "aynı sayı,
 * aynı pozisyon, daha az segment"). Alt yüz tam zemin payında.
 */
export function pushWheel(
  parts: TruckPart[],
  args: { x: number; z: number; diameter: number; width: number; detail: TruckDetail },
): void {
  const radius = args.diameter / 2
  parts.push({
    kind: 'cyl',
    role: 'wheel',
    center: [args.x, GROUND_CLEARANCE + radius, args.z],
    radius,
    length: args.width,
    axis: 'z',
    segments: args.detail === 'full' ? 12 : 8,
  })
  // Jant — yalnız yakın katman ve yalnız görünür boyuttaki tekerlekte.
  // Lastikten DAR kalır: zarf genişliği katmanla değişemez (T20).
  if (args.detail === 'full' && args.diameter >= 0.12) {
    parts.push({
      kind: 'cyl',
      role: 'hub',
      center: [args.x, GROUND_CLEARANCE + radius, args.z],
      radius: radius * 0.45,
      length: args.width * 0.6,
      axis: 'z',
      segments: 10,
    })
  }
}

/**
 * Bir mast kademesi: `full` iki ray + verilen kirişler, `simple` aynı dış
 * zarfta tek kutu. Kademe başına bir çağrı — kademeler ASLA tek prizmaya
 * birleştirilmez.
 */
export function pushMastStage(
  parts: TruckPart[],
  args: {
    centerX: number
    /** Ray merkezlerinin ±Z'si. */
    railZ: number
    railSize: readonly [number, number, number]
    yBottom: number
    crossbarYs: readonly number[]
    detail: TruckDetail
  },
): void {
  const [rx, height, rz] = args.railSize
  const centerY = args.yBottom + height / 2
  if (args.detail === 'simple') {
    parts.push({
      role: 'mast-rail',
      center: [args.centerX, centerY, 0],
      size: [rx, height, args.railZ * 2 + rz],
    })
    return
  }
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'mast-rail',
      center: [args.centerX, centerY, side * args.railZ],
      size: [rx, height, rz],
    })
  }
  for (const y of args.crossbarYs) {
    parts.push({
      role: 'mast-rail',
      center: [args.centerX, y, 0],
      size: [rx * 0.8, 0.1, args.railZ * 2 - rz],
    })
  }
}

/**
 * Gövde kabuğu — TEK kutu yerine etek + bel kuşağı + üst gövde.
 *
 * ## Neden
 *
 * Beş ailenin beşi de gövdesini tek bir prizma olarak çiziyordu: turret'in
 * 1,6 m'lik sarı bloğu, reach'in 1,05 m'lik mavi levhası, transpaletin yeşil
 * tuğlası. Tek prizmanın iki sonucu var ve ikisi de görsel:
 *
 *   - **Silüette hiçbir kırılma yok.** Bir metre yüksekliğinde kesintisiz bir
 *     yüz, hangi açıdan bakılırsa bakılsın düz bir renk lekesi olarak okunuyor;
 *     makineyi makine yapan yatay gölge çizgisi hiç doğmuyor.
 *   - **Tekerlekler gövdenin içinde kayboluyor.** Prizma izin tamamı kadar
 *     geniş ve lastik hep içeride kalıyor, yani araç tekerlek üstünde
 *     DURMUYOR gibi görünüyor — havada duran bir kutu.
 *
 * Kabuk üç kutu: içeri kaçık bir ETEK (lastik açığa çıkar, altta gölge
 * doğar), izin tam genişliğinde ince bir BEL KUŞAĞI (gerçek makinelerdeki
 * tampon çıtası; koyu renk, gövdeyi ikiye böler) ve kuşaktan bir tık dar ÜST
 * GÖVDE.
 *
 * Üçü de İKİ katmanda birden çiziliyor. Bu bilinçli: kırılma bir ayrıntı
 * değil siluetin kendisi, ve uzak katmanda düşürmek LOD geçişinde aracın
 * şeklini değiştirirdi. Z zarfını kuşak belirliyor ve iki katmanda da aynı —
 * T20'nin ölçtüğü şey.
 *
 * Oranlar SEÇİLMİŞ VARSAYILAN: hiçbir katalog gövde kesitini yayımlamıyor.
 */
export function pushBodyShell(
  parts: TruckPart[],
  args: {
    role: Extract<TruckPartRole, 'chassis' | 'cowl' | 'counterweight'>
    xRear: number
    xFront: number
    /** Bel kuşağının — yani izin — yarı genişliği. */
    halfWidth: number
    yBottom: number
    yTop: number
    /** Kuşağın kotu. Gövdenin alt üçte birine yakın durması gerçekçi. */
    beltY: number
    /** Eteğin kuşaktan içeri kaçıklığı, yan başına. */
    skirtInset: number
  },
): void {
  const length = args.xFront - args.xRear
  const centerX = (args.xRear + args.xFront) / 2
  const beltHeight = Math.min(0.09, (args.yTop - args.yBottom) * 0.12)
  const beltBottom = args.beltY - beltHeight / 2
  const beltTop = args.beltY + beltHeight / 2

  if (beltBottom > args.yBottom) {
    parts.push({
      role: args.role,
      center: [centerX, (args.yBottom + beltBottom) / 2, 0],
      size: [length, beltBottom - args.yBottom, 2 * (args.halfWidth - args.skirtInset)],
    })
  }
  parts.push({
    role: 'belt',
    center: [centerX, args.beltY, 0],
    size: [length, beltHeight, 2 * args.halfWidth],
  })
  if (args.yTop > beltTop) {
    parts.push({
      role: args.role,
      center: [centerX, (beltTop + args.yTop) / 2, 0],
      size: [length, args.yTop - beltTop, 2 * (args.halfWidth - 0.012)],
    })
  }
}

/**
 * Turuncu çakar — kaide + lamba, GÖVDENİN üstünde.
 *
 * Koruyucu tavanın üstüne konmuyor ve sebebi zarf: tavanın kotu h6, yani
 * yayımlanmış zarf yüksekliğinin ta kendisi. Oraya bir lamba koymak makineyi
 * kataloğun söylediğinden yüksek çizerdi — bu paketin bütün ölçü disiplinine
 * aykırı. Gövde tepesi zarfın epey altında ve lamba oraya sığıyor.
 *
 * Yalnız yakın katmanda: 40 m'den 110 mm'lik bir lamba tek piksel etmiyor.
 */
export function pushBeacon(
  parts: TruckPart[],
  args: { x: number; yBase: number; z: number; detail: TruckDetail },
): void {
  if (args.detail !== 'full') return
  parts.push({
    role: 'belt',
    center: [args.x, args.yBase + 0.02, args.z],
    size: [0.09, 0.04, 0.09],
  })
  parts.push({
    kind: 'cyl',
    role: 'beacon',
    center: [args.x, args.yBase + 0.095, args.z],
    radius: 0.05,
    length: 0.11,
    axis: 'y',
    segments: 8,
  })
}

/**
 * Koruyucu tavan: dört direk + `full`'da çubuklu ızgara, `simple`'da tek
 * levha. Direkler iki katmanda da durur — tavanı düşürmek sürücü korumasını
 * siler ve zarf yüksekliğini değiştirir.
 */
export function pushOverheadGuard(
  parts: TruckPart[],
  args: {
    xFront: number
    xRear: number
    z: number
    yBottom: number
    yTop: number
    detail: TruckDetail
  },
): void {
  const post = 0.05
  for (const x of [args.xFront, args.xRear]) {
    for (const side of [-1, 1] as const) {
      parts.push({
        role: 'overhead-guard',
        center: [x, (args.yBottom + args.yTop) / 2, side * args.z],
        size: [post, args.yTop - args.yBottom, post],
      })
    }
  }
  const roofY = args.yTop - 0.025
  const length = args.xFront - args.xRear
  const centerX = (args.xFront + args.xRear) / 2
  if (args.detail === 'simple') {
    parts.push({
      role: 'overhead-guard',
      center: [centerX, roofY, 0],
      size: [length + post, 0.05, args.z * 2 + post],
    })
    return
  }
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'overhead-guard',
      center: [centerX, roofY, side * args.z],
      size: [length + post, 0.05, post],
    })
  }
  for (const t of [-0.3, 0, 0.3]) {
    parts.push({
      role: 'overhead-guard',
      center: [centerX + t * length, roofY, 0],
      size: [0.04, 0.04, args.z * 2],
    })
  }
}
