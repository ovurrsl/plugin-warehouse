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
  | 'guide-roller'

/**
 * Hareket eden birimler. Parçalar araç çerçevesinde emit edilir; `stage1` ve
 * `carriage` parçaları DİNLENME pozunda yazılır ve renderer grubu kinematiğin
 * verdiği Y kadar öteler — vertex'ler asla pozu taşımaz (§3.4 kuralı).
 */
export type TruckBody = 'chassis' | 'steer' | 'mast' | 'stage1' | 'carriage'

export type TruckPart = {
  role: TruckPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
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
  'guide-roller': '#4a525c',
}

/** Zeminle z-çakışmasını önleyen taban payı. T26 "en alçak vertex [0, 1 mm]"
 *  bandının içinde. */
export const GROUND_CLEARANCE = 0.0005

/** Modelin çizdiği gövdeler. Ayrıntılı emitter'ı olmayan aileler tek gövdeyle
 *  (zarf) çizilir — dilim 8/9 kendi emitter'larını getirdiğinde genişler. */
export function bodiesOf(model: TruckModel): readonly TruckBody[] {
  return model.variant === 'forklift'
    ? ['chassis', 'steer', 'mast', 'stage1', 'carriage']
    : ['chassis']
}

/**
 * Tek dağıtıcı. `forklift` ayrıntılı gövdesini çizer; kalan aileler dilim
 * 8/9'a kadar yayınlanmış zarflarında TEK kutu olarak durur — uydurma bir
 * gövde yerine doğru ölçülü dürüst bir vekil. İki katman aynı kutuyu üretir,
 * parite bedavaya sağlanır.
 */
export function truckParts(
  model: TruckModel,
  mastRow: MastRow | null,
  body: TruckBody,
  detail: TruckDetail,
): TruckPart[] {
  if (model.variant === 'forklift') return forkliftParts(model, mastRow, body, detail)
  if (body !== 'chassis') return []
  return placeholderParts(model)
}

/** Yayınlanmış zarf, tek kutu. `h14` transpalet kolu gibi tepe noktalarını
 *  içerir; yükseklik `overallHeightM`'in okuduğu satırların aynısından gelir. */
function placeholderParts(model: TruckModel): TruckPart[] {
  const width = Math.max(model.b1, model.b2 ?? 0)
  const h14Max = typeof model.h14 === 'number' ? model.h14 : (model.h14?.[1] ?? 0)
  const height = Math.max(model.h6 ?? 0, model.h12 ?? 0, model.h13 ?? 0, h14Max, 0.3)
  return [
    {
      role: 'chassis',
      center: [0, GROUND_CLEARANCE + height / 2, 0],
      size: [model.l1, height, width],
    },
  ]
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

/** Bir lastik — kutu olarak, alt yüzü zemin payında. İki katman AYNI sayıda
 *  ve AYNI konumda tekerlek üretir (§3.2); fark diğer parçalarda. */
export function pushWheel(
  parts: TruckPart[],
  args: { x: number; z: number; diameter: number; width: number },
): void {
  parts.push({
    role: 'wheel',
    center: [args.x, GROUND_CLEARANCE + args.diameter / 2, args.z],
    size: [args.diameter, args.diameter, args.width],
  })
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
