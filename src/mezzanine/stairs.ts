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

import {
  DEFAULT_UNIT,
  type LinearUnit,
  lengthLabel,
  millimetreLabel,
  publishedMillimetres,
} from '../units'
import { RAILING_RULES, STAIRCASE_GEOMETRY, STAIRCASE_STEP_COUNTS } from './catalog'
import type { StaircaseSpec } from './schema'

/**
 * Hedef rıht yüksekliği — EN ISO 14122-3'ün konforlu aralığının ORTASI,
 * standardın yayınladığı bir sayı değil. Ayrı bir sabit, çünkü `'auto'`
 * basamak sayısının tek girdisi bu ve bir gün değişirse tek yerde değişir.
 */
export const RISER_TARGET_M = 0.1875

/** `going + 2·rise` bandının ortası — going çözümünün hedefi. */
const GOING_FORMULA_TARGET_M = (0.6 + 0.66) / 2

/**
 * Bir koldaki en fazla basamak — katalogun hazır merdiven serisinin üst ucu.
 *
 * Katalog 8/10/12/15 basamaklı hazır merdiven yayınlıyor; daha uzunu ara
 * sahanlıklarla kollara bölünüyor. Sayı `STAIRCASE_STEP_COUNTS`'un son
 * elemanından türetiliyor ki iki yerde ayrı yaşamasınlar.
 */
const MAX_STEPS_PER_FLIGHT = STAIRCASE_STEP_COUNTS[STAIRCASE_STEP_COUNTS.length - 1] ?? 15

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
  /** Bir koldaki basamak sayısı — son kol daha az taşıyabilir. */
  stepsPerFlight: number
  /** Kol sayısı kullanıcının seçtiğinden fazla mı (15 basamak kuralı). */
  autoSplit: boolean
  /** Merdivenin YATAY uzanımı, sahanlık dahil — döşeme boşluğunun derinliği. */
  runM: number
  /** Tek bir kolun yatay uzanımı, sahanlık hariç. */
  flightRunM: number
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
  /**
   * Yalnız MESAJLARI etkiler, geometriyi değil — ve bir parametre, çünkü bu
   * modül saf kalmalı (dosya başlığındaki iddia). `issues`'ı gösteren tek
   * çağıran `parametrics.ts`; geometriyi alan dört çağıran varsayılanı
   * kullanıyor ve hiçbir mesaj üretmiyor.
   */
  unit: LinearUnit = DEFAULT_UNIT,
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
      msg: `Rıht ${millimetreLabel(riseM, unit)} — EN ISO 14122-3 en fazla ${publishedMillimetres(STAIRCASE_GEOMETRY.riserMaxM * 1000)} veriyor. Basamak sayısını artırın (auto: ${autoSteps}).`,
    })
  }
  if (treadDepthM < STAIRCASE_GEOMETRY.treadDepthMinM) {
    issues.push({
      code: 'tread-too-shallow',
      msg: `Basamak derinliği ${millimetreLabel(treadDepthM, unit)} — en az ${publishedMillimetres(STAIRCASE_GEOMETRY.treadDepthMinM * 1000)} gerekiyor.`,
    })
  }
  // Kırpma bandı bozduysa söyle: `solveGoing` sessizce uyumlu bir sayı
  // döndürmüş gibi görünmemeli.
  const band = goingM + 2 * riseM
  if (band < 0.6 - 1e-9 || band > 0.66 + 1e-9) {
    issues.push({
      code: 'going-out-of-range',
      msg: `going + 2·rise = ${millimetreLabel(band, unit)}, standardın 600–660 mm bandının dışında.`,
    })
  }
  /**
   * Tek DÜZ kolun istisnası: standart kol başına 3000 mm veriyor ama
   * kesintisiz düz bir kola 4000 mm'ye kadar izin veriyor.
   * `singleFlightClimbHeightMaxM` buraya kadar hiç okunmuyordu, dolayısıyla
   * meşru bir 3.5 m düz kol gereksiz yere uyarı alıyordu.
   */
  const continuousLimit =
    spec.landing === 'continuous'
      ? STAIRCASE_GEOMETRY.singleFlightClimbHeightMaxM
      : STAIRCASE_GEOMETRY.flightClimbHeightMaxM
  if (elevationDeltaM > continuousLimit && spec.landing === 'continuous') {
    issues.push({
      code: 'landing-required',
      msg: `${lengthLabel(elevationDeltaM, unit)} tırmanış tek düz kolda çıkılamaz (en fazla ${continuousLimit.toFixed(1)} m); bir sahanlık gerekiyor.`,
    })
  }
  if (spec.steps !== 'auto' && spec.steps !== autoSteps) {
    issues.push({
      code: 'step-count-mismatch',
      msg: `Seçilen ${spec.steps} basamak bu kot farkına (${lengthLabel(elevationDeltaM, unit)}) göre ${autoSteps} olmalıydı; rıht ${millimetreLabel(riseM, unit)} çıkıyor.`,
    })
  }

  /**
   * Katalog hazır merdivenleri 8/10/12/15 basamak yayınlıyor ve 15'ten
   * uzun bir merdiven ara sahanlıklarla kollara BÖLÜNÜYOR. Kullanıcının
   * seçtiği sahanlık tipi ne olursa olsun bu bölünme zorunlu: 3 m'nin
   * altında kalan 20 basamaklı kesintisiz bir kol sessizce tek kol
   * kalıyordu.
   */
  const requested = spec.landing === 'continuous' ? 1 : 2
  const flights = Math.max(requested, Math.ceil(steps / MAX_STEPS_PER_FLIGHT))
  const autoSplit = flights > requested
  // Sahanlık kolları böler: N basamak iki kola bölününce yatay uzanım
  // yarıya iner ama sahanlığın kendi boyu eklenir.
  const stepsPerFlight = Math.ceil(steps / flights)
  const flightRunM = stepsPerFlight * goingM
  const landingCount = flights - 1
  const runM = flightRunM + landingCount * STAIRCASE_GEOMETRY.landingLengthMinM

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
    geometry: {
      steps,
      riseM,
      goingM,
      treadDepthM,
      flights,
      stepsPerFlight,
      autoSplit,
      runM,
      flightRunM,
      lateralM,
    },
    issues,
  }
}

/**
 * Bir merdiven kolunun yerel çerçevesi.
 *
 * Kol kendi yönünde uzanır ve yön sahanlık tipine göre değişir; bu yüzden
 * her kol kendi YAW'ıyla taşınıyor ve parçalar `rotationY` ile emit
 * ediliyor. Eksen hizalı kutu yaklaşıklığı ile çizilseydi, geri katlanan
 * ya da yana dönen bir kol yanlış yerde durur.
 */
export type FlightFrame = {
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
export function flightFrames(
  stair: StaircaseSpec,
  geometry: StepGeometry,
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

export type Rect = { x0: number; z0: number; x1: number; z1: number }

/**
 * Merdivenin YEREL sınır kutusu — kolları ÇİZEN yerleşimden türetiliyor.
 *
 * Bu fonksiyonun `flightFrames`'i okumasının sebebi, boşluğun ikinci bir
 * hesapla tahmin edilmesinin daha önce sessizce yanlış çıkması: dikdörtgen
 * `origin ± yarım ölçü` diye kuruluyordu, oysa `flightFrames` bütün kolları
 * origin'in TEK tarafına koyuyor (`z ∈ [0, …]`) ve dönüşlü sahanlıklarda
 * ikinci kol yana da kayıyor. Varsayılan merdivende boşluk yerel
 * z −1,71…+1,71 çıkıyordu, merdiven ise 0…3,26: boşluğun yarısı güvertenin
 * DIŞINDA hiçbir paneli silmiyor, merdivenin üst yarısı ise sağlam bir
 * panelin ALTINDA kalıyordu. 5 m'lik varsayılan göz ızgarası hatayı yutuyor
 * (silinen 5 m'lik satır merdivenin tamamını kapsıyor); şemanın izin verdiği
 * 2 m'lik gözde merdivenin üstü döşemeden çıkıyor — yani bu dosyanın kendi
 * yorumunun "kaçınılacak sonuç" diye adlandırdığı şey. Planda da aynı kayma
 * görünüyordu: kesikli beyaz kutu anahattın yarısı kadar dışarı taşıyordu.
 *
 * Basamak bindirmesi, limon kirişi ve dikme kesitleri buraya GİRMİYOR:
 * hepsi 60 mm'nin altında taşıyor ve katalogun 80 mm'lik açıklığı onları
 * zaten yutuyor. Kolun kendi ekseni ve boyu ise tam.
 */
function stairLocalBounds(spec: StaircaseSpec, geometry: StepGeometry): Rect {
  const frames = flightFrames(spec, geometry, 0)
  const landing = STAIRCASE_GEOMETRY.landingLengthMinM
  const half = spec.widthM / 2
  const xs: number[] = []
  const zs: number[] = []

  for (const [index, frame] of frames.entries()) {
    const run = geometry.goingM * frame.steps
    // Kolun kendisi: boyuna 0…run, yanal ±yarım genişlik — kol çerçevesinde.
    const alongs = [0, run]
    // Ara sahanlık kolun ucunun ötesinde.
    if (index < frames.length - 1) alongs.push(run + landing)
    for (const along of alongs) {
      for (const lateral of [-half, half]) {
        xs.push(frame.ox + frame.dx * along - frame.dz * lateral)
        zs.push(frame.oz + frame.dz * along + frame.dx * lateral)
      }
    }
    // turn180'in sahanlığı İKİ kolu birden örtüyor ve `pushStaircase` onu
    // kol çerçevesinde değil, doğrudan merdiven-yerel +X'te yarım genişlik
    // kaydırıp iki kol eninde basıyor. Kol çerçevesinden geçirmek onu ters
    // yöne kaydırırdı — boşluk merdivenin bir kolu kadar yanlış tarafa
    // taşardı.
    if (index < frames.length - 1 && spec.landing === 'turn180') {
      xs.push(-half, -half + 2 * spec.widthM)
      zs.push(frame.oz + run, frame.oz + run + landing)
    }
  }

  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) }
}

/**
 * Merdivenin döşemede açtığı boşluk, dünya çerçevesinde.
 *
 * Katalogun açıklık diyagramı her yanda 80 mm istiyor. Bu dikdörtgenle
 * ÇAKIŞAN döşeme panelleri çizilmez (CSG değil, panel dışlama — 15.000 m²
 * ölçekte boolean kesim kabul edilemez).
 */
export function stairVoidRect(
  spec: StaircaseSpec,
  geometry: StepGeometry,
  origin: { x: number; z: number; rotationRad: number },
): Rect {
  const clearance = 0.08 // katalog açıklık diyagramı: her yanda 80 mm
  const local = stairLocalBounds(spec, geometry)

  // Yerel kutu dünya çerçevesine KÖŞE köşe taşınıyor — 90°'nin katları
  // dışında eksen hizalı bir yaklaşıklık kalıyor ve bu KASITLI: panel
  // dışlama testi eksen hizalı, ve fazla panel düşmesi az düşmesinden
  // (merdivenin döşemenin içinden çıkmasından) iyidir.
  const cos = Math.cos(origin.rotationRad)
  const sin = Math.sin(origin.rotationRad)
  const xs: number[] = []
  const zs: number[] = []
  for (const lx of [local.x0 - clearance, local.x1 + clearance]) {
    for (const lz of [local.z0 - clearance, local.z1 + clearance]) {
      xs.push(origin.x + lx * cos - lz * sin)
      zs.push(origin.z + lx * sin + lz * cos)
    }
  }

  return {
    x0: Math.min(...xs),
    z0: Math.min(...zs),
    x1: Math.max(...xs),
    z1: Math.max(...zs),
  }
}

/** İki eksen hizalı dikdörtgen kesişiyor mu (dokunma kesişme sayılmaz). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
}

/** Korkuluk yüksekliği — açıklık koruma kuralının eşiği de burada. */
export const HANDRAIL_HEIGHT_M = RAILING_RULES.handrailHeightM
export const KICKBOARD_HEIGHT_M = RAILING_RULES.kickboardHeightM
