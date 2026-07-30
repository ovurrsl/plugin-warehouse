/**
 * Merdiven geometrisi ve EN ISO 14122-3 doğrulaması.
 *
 * Saf: three yok, React yok. Basamak sayısı GERÇEK kot farkından çıkar —
 * kullanıcı hazır bir katalog ürünü (8/10/12/15 basamak) seçse bile aynı
 * doğrulamadan geçer ve uymuyorsa panel söyler. Bu, "katalog satırı kutsal
 * ama fizik daha kutsal" ayrımı: sayı reddedilmez, uyarılır.
 *
 * Ölçüler metre; standardın kendisi mm yayınlıyor ve `catalog.ts` çeviriyor.
 */

import { RAILING_RULES, STAIRCASE_GEOMETRY } from './catalog'
import type { StaircaseSpec } from './schema'

/**
 * Hedef rıht yüksekliği — EN ISO 14122-3'ün konforlu aralığının ORTASI,
 * standardın yayınladığı bir sayı değil. Ayrı bir sabit, çünkü `'auto'`
 * basamak sayısının tek girdisi bu ve bir gün değişirse tek yerde değişir.
 */
export const RISER_TARGET_M = 0.1875

/** `going + 2·rise` bandının ortası — going çözümünün hedefi. */
const GOING_FORMULA_TARGET_M = (0.6 + 0.66) / 2

export type StepGeometry = {
  steps: number
  /** Rıht yüksekliği, metre. */
  riseM: number
  /** Basış (going) — iki rıht arası yatay mesafe. */
  goingM: number
  /** Basamak derinliği = going + bindirme. Standardın ayrı bir eşiği var. */
  treadDepthM: number
  /** Kaç kollu: sahanlıklı merdiven iki kola bölünür. */
  flights: number
  /** Merdivenin YATAY uzanımı, sahanlık dahil — döşeme boşluğunun derinliği. */
  runM: number
  /**
   * Merdivenin YANAL uzanımı — `runM`'e dik eksende kapladığı genişlik.
   *
   * `turn90` ile `turn180` arasındaki tek gerçek geometrik fark burada.
   * İkisi de iki kollu (`flights = 2`) ve ikisinin de derinliği aynı —
   * ayrıldıkları yer ikinci kolun NEREYE gittiği:
   *
   *   - `continuous`: tek kol, yanal uzanım merdiven genişliği kadar.
   *   - `turn180` (dog-leg): ikinci kol geri katlanır ve birincinin YANINA
   *     gelir → yanal uzanım iki kol genişliği.
   *   - `turn90`: ikinci kol yana döner ve o eksende basamak boyunca uzar →
   *     yanal uzanım genişlik + ikinci kolun uzanımı.
   *
   * Bu ayrım olmadan iki sahanlık tipi aynı döşeme boşluğunu açıyordu, yani
   * kullanıcının seçimi hiçbir şeyi değiştirmiyordu.
   */
  lateralM: number
}

export type StairIssue = {
  code:
    | 'riser-too-tall'
    | 'tread-too-shallow'
    | 'going-out-of-range'
    | 'landing-required'
    | 'step-count-mismatch'
  msg: string
}

/**
 * Verilen rıhta karşılık gelen basış.
 *
 * `600 ≤ going + 2·rise ≤ 660` bandının ortasını hedefler, sonra
 * `210 ≤ going ≤ 310`e kırpar. Kırpma bandı bozabilir — o zaman `issues`
 * bunu söyler; sessizce banda uyan bir sayı UYDURULMAZ.
 */
function solveGoing(riseM: number): number {
  const ideal = GOING_FORMULA_TARGET_M - 2 * riseM
  const { min, max } = STAIRCASE_GEOMETRY.goingRangeM
  return Math.min(max, Math.max(min, ideal))
}

/**
 * Bir merdivenin basamak geometrisi ve standarda karşı denetimi.
 *
 * `elevationDeltaM` GERÇEK kot farkıdır (iki tier arası, ya da zeminden
 * tier'e) — bu fonksiyonun var oluş sebebi tam olarak budur: katalog
 * ürününü hayale değil, bulunduğu yere karşı doğrular.
 */
export function resolveSteps(
  spec: StaircaseSpec,
  elevationDeltaM: number,
): { geometry: StepGeometry; issues: StairIssue[] } {
  const issues: StairIssue[] = []
  const autoSteps = Math.max(1, Math.ceil(elevationDeltaM / RISER_TARGET_M))
  const steps = spec.steps === 'auto' ? autoSteps : spec.steps

  const riseM = elevationDeltaM / steps
  const goingM = solveGoing(riseM)
  const treadDepthM = goingM + STAIRCASE_GEOMETRY.overlapMinM

  if (riseM > STAIRCASE_GEOMETRY.riserMaxM) {
    issues.push({
      code: 'riser-too-tall',
      msg: `Rıht ${(riseM * 1000).toFixed(0)} mm — EN ISO 14122-3 en fazla ${(STAIRCASE_GEOMETRY.riserMaxM * 1000).toFixed(0)} mm veriyor. Basamak sayısını artırın (auto: ${autoSteps}).`,
    })
  }
  if (treadDepthM < STAIRCASE_GEOMETRY.treadDepthMinM) {
    issues.push({
      code: 'tread-too-shallow',
      msg: `Basamak derinliği ${(treadDepthM * 1000).toFixed(0)} mm — en az ${(STAIRCASE_GEOMETRY.treadDepthMinM * 1000).toFixed(0)} mm gerekiyor.`,
    })
  }
  // Kırpma bandı bozduysa söyle: `solveGoing` sessizce uyumlu bir sayı
  // döndürmüş gibi görünmemeli.
  const band = goingM + 2 * riseM
  if (band < 0.6 - 1e-9 || band > 0.66 + 1e-9) {
    issues.push({
      code: 'going-out-of-range',
      msg: `going + 2·rise = ${(band * 1000).toFixed(0)} mm, standardın 600–660 mm bandının dışında.`,
    })
  }
  if (elevationDeltaM > STAIRCASE_GEOMETRY.flightClimbHeightMaxM && spec.landing === 'continuous') {
    issues.push({
      code: 'landing-required',
      msg: `${elevationDeltaM.toFixed(2)} m tırmanış tek kolda çıkılamaz (en fazla ${STAIRCASE_GEOMETRY.flightClimbHeightMaxM.toFixed(1)} m); bir sahanlık gerekiyor.`,
    })
  }
  if (spec.steps !== 'auto' && spec.steps !== autoSteps) {
    issues.push({
      code: 'step-count-mismatch',
      msg: `Seçilen ${spec.steps} basamak bu kot farkına (${elevationDeltaM.toFixed(2)} m) göre ${autoSteps} olmalıydı; rıht ${(riseM * 1000).toFixed(0)} mm çıkıyor.`,
    })
  }

  const flights = spec.landing === 'continuous' ? 1 : 2
  // Sahanlık kolları böler: N basamak iki kola bölününce yatay uzanım
  // yarıya iner ama sahanlığın kendi boyu eklenir.
  const stepsPerFlight = Math.ceil(steps / flights)
  const flightRunM = stepsPerFlight * goingM
  const runM = flightRunM + (flights > 1 ? STAIRCASE_GEOMETRY.landingLengthMinM : 0)

  // İki sahanlık tipi DERİNLİKTE aynı, YANAL uzanımda ayrılıyor: turn180
  // ikinci kolu birincinin yanına geri katlar, turn90 onu dik eksende
  // basamak boyunca uzatır. Bu ayrım olmadan kullanıcının seçimi hiçbir
  // şeyi değiştirmiyordu.
  const lateralM =
    spec.landing === 'turn180'
      ? spec.widthM * 2
      : spec.landing === 'turn90'
        ? spec.widthM + flightRunM
        : spec.widthM

  return {
    geometry: { steps, riseM, goingM, treadDepthM, flights, runM, lateralM },
    issues,
  }
}

export type Rect = { x0: number; z0: number; x1: number; z1: number }

/**
 * Merdivenin döşemede açtığı boşluk.
 *
 * Genişlik katalogun açıklık diyagramından: `80 + genişlik + 80` mm.
 * Derinlik yatay uzanım + emniyet payı. Bu dikdörtgenle ÇAKIŞAN döşeme
 * panelleri çizilmez (CSG değil, panel dışlama — 15.000 m² ölçekte boolean
 * kesim kabul edilemez).
 */
export function stairVoidRect(
  geometry: StepGeometry,
  origin: { x: number; z: number; rotationRad: number },
): Rect {
  const clearance = 0.08 // katalog açıklık diyagramı: her yanda 80 mm
  // Genişlik merdivenin YANAL uzanımından — sahanlık tipi burada okunuyor.
  // `spec.widthM` kullanmak, dönen kolun döşemenin içinden çıkması demekti.
  const halfWidth = geometry.lateralM / 2 + clearance
  const depth = geometry.runM + clearance * 2

  // Yerel çerçevede: genişlik X'te, uzanım Z'de. Dünya çerçevesine
  // döndürülür — 90°'nin katları dışında eksen hizalı bir dikdörtgen
  // yaklaşıklığı kalır ve bu KASITLI: panel dışlama testi eksen hizalı,
  // ve döndürülmüş bir boşluk için biraz fazla panel düşmesi, az panel
  // düşmesinden (merdivenin döşemenin içinden çıkması) iyidir.
  const cos = Math.abs(Math.cos(origin.rotationRad))
  const sin = Math.abs(Math.sin(origin.rotationRad))
  const halfX = halfWidth * cos + (depth / 2) * sin
  const halfZ = halfWidth * sin + (depth / 2) * cos

  return {
    x0: origin.x - halfX,
    z0: origin.z - halfZ,
    x1: origin.x + halfX,
    z1: origin.z + halfZ,
  }
}

/** İki eksen hizalı dikdörtgen kesişiyor mu (dokunma kesişme sayılmaz). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
}

/** Korkuluk yüksekliği — açıklık koruma kuralının eşiği de burada. */
export const HANDRAIL_HEIGHT_M = RAILING_RULES.handrailHeightM
export const KICKBOARD_HEIGHT_M = RAILING_RULES.kickboardHeightM
