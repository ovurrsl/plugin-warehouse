/**
 * Sarmal konveyörün ölçü okumaları — helis matematiği tek yerden (spec §3).
 *
 * Yerel çerçeve: origin helis taban dairesinin merkezinde, Y=0 zemin. Kolon
 * +Y'ye yükselir. Helis yarıçapı R; slat'lar R yarıçapında bir helis üzerinde.
 * Giriş tanjantı −X'te (bant kotu `entryHeight`), çıkış tanjantı +X'te
 * (`exitHeight`) — ikisi ayrı kotta, bu paketin per-port Y taşıyan ilk kind'ı.
 *
 * Bütün fonksiyonlar saf: `spiral.test.ts` yayınlanmış formülleri (pitch =
 * 2πR·tan) ve sınıf üst sınırlarını bunların üstünden kilitliyor.
 */

import type { ConveyorDetail } from './parts'
import { SPIRAL_BELT_SPEED_MS } from './spiral-catalog'
import type { ConveyorSpiralNode } from './spiral-schema'

const TWO_PI = Math.PI * 2

/** Dış çap, metre. */
export function outerDiameterM(node: ConveyorSpiralNode): number {
  return Number(node.outerDiameter) / 1000
}

/** Bant genişliği, metre. */
export function beltWidthM(node: ConveyorSpiralNode): number {
  return Number(node.beltWidth) / 1000
}

/** Helis yarıçapı: R = (dış çap − bant)/2 (spec §3). */
export function helixRadiusM(node: ConveyorSpiralNode): number {
  return (outerDiameterM(node) - beltWidthM(node)) / 2
}

/** Eğim, radyan. */
export function inclineRad(node: ConveyorSpiralNode): number {
  return (node.inclineDeg * Math.PI) / 180
}

/** Kiralite işareti: `cw` → −1, `ccw` → +1. Helis yönünü çevirir (VERTEKS). */
export function handednessSign(node: ConveyorSpiralNode): number {
  return node.handedness === 'cw' ? -1 : 1
}

/** Bir tam turdaki dikey yükseliş: pitch = 2π·R·tan(eğim) (spec §3). */
export function pitchM(node: ConveyorSpiralNode): number {
  return TWO_PI * helixRadiusM(node) * Math.tan(inclineRad(node))
}

/** Tam tur sayısı: yükseklik / pitch. */
export function turnCount(node: ConveyorSpiralNode): number {
  return node.travelHeight / pitchM(node)
}

/** Toplam açı parametresi: tur × 2π. */
export function totalAngleRad(node: ConveyorSpiralNode): number {
  return turnCount(node) * TWO_PI
}

/** Helis yayının gerçek uzunluğu: yükseklik / sin(eğim) (bir malın kat ettiği yol). */
export function helixArcLengthM(node: ConveyorSpiralNode): number {
  return node.travelHeight / Math.sin(inclineRad(node))
}

/**
 * Helis noktası, DİNLENME çerçevesinde (y tabanı 0): [R·cos(s·t),
 * (pitch/2π)·t, R·sin(s·t)]. `entryHeight` ofseti buraya GİRMEZ — slat'lar bu
 * saf helis üzerinde inşa edilip renderer'da grup olarak `entryHeight` kadar
 * kaldırılıyor, yani kot geometri anahtarına girmiyor (teleskopik uzamanın
 * grup ötelemesi olmasının aynısı).
 */
export function helixPoint(node: ConveyorSpiralNode, t: number): [number, number, number] {
  const r = helixRadiusM(node)
  const s = handednessSign(node)
  return [r * Math.cos(s * t), (pitchM(node) / TWO_PI) * t, r * Math.sin(s * t)]
}

/** Tur başına slat sayısı: tam 30, sade 10. */
export function slatsPerTurn(detail: ConveyorDetail): number {
  return detail === 'full' ? 30 : 10
}

/** İki slat arası açı adımı, radyan. */
export function slatStepRad(detail: ConveyorDetail): number {
  return TWO_PI / slatsPerTurn(detail)
}

/**
 * Bir slat adımının dikey karşılığı: pitch·adım/2π.
 *
 * Vida hareketinin özü: slat grubu tam bu kadar yükselirken tam bir slat adımı
 * dönerse dinlenme helisi kendi üstüne oturur. `spiral.test.ts` bunu ε içinde
 * kanıtlıyor — animasyon numarasının tam olduğu buradan.
 */
export function screwYPerStep(node: ConveyorSpiralNode, detail: ConveyorDetail): number {
  return (pitchM(node) * slatStepRad(detail)) / TWO_PI
}

/**
 * Bir slat adımlık grup Y-dönüşü (three konvansiyonu, −s·adım).
 *
 * `helixPoint` merkezini bu açıyla Y çevresinde döndürüp `screwYPerStep` kadar
 * yükseltmek, slat_k'yı slat_{k+1}'e taşır — vida simetrisi. İşaret `−s`,
 * three'nin Y dönüşü matematiksel yönün tersi olduğu için.
 */
export function screwYawPerStep(node: ConveyorSpiralNode, detail: ConveyorDetail): number {
  return -handednessSign(node) * slatStepRad(detail)
}

/** Giriş (alt) tanjant kotu, metre. */
export function entryHeightM(node: ConveyorSpiralNode): number {
  return node.entryHeight
}

/** Çıkış (üst) tanjant kotu: giriş + yükseklik. */
export function exitHeightM(node: ConveyorSpiralNode): number {
  return node.entryHeight + node.travelHeight
}

/** Korkuluk/kafes üstü için toplam boy payı. */
export const OVERHEAD_MARGIN_M = 0.3

/** Kolider ve footprint'in okuduğu toplam boy: çıkış kotu + pay. */
export function overallHeightM(node: ConveyorSpiralNode): number {
  return exitHeightM(node) + OVERHEAD_MARGIN_M
}

/**
 * Merkez kolon yarıçapı, metre — spec §2: çap ~0,4–0,6 m.
 *
 * Bandın İÇ kenarından (R − bant/2) en az 5 cm içeride tutuluyor; aksi hâlde
 * slat halkası kolonun içine girerdi (`spiral.test.ts` çakışmayı kilitliyor).
 */
export function columnRadiusM(node: ConveyorSpiralNode): number {
  const inner = helixRadiusM(node) - beltWidthM(node) / 2
  return Math.max(0.12, Math.min(0.3, inner - 0.05))
}

/** Slat halkasının dış yarıçapı: R + bant/2. */
export function slatOuterRadiusM(node: ConveyorSpiralNode): number {
  return helixRadiusM(node) + beltWidthM(node) / 2
}

/** Korkuluğun bant dış kenarından ofseti. */
export const HANDRAIL_OFFSET_M = 0.1
/** Ayakların bant dış kenarından ofseti. */
export const LEG_OFFSET_M = 0.2
/** Kafesin bant dış kenarından ofseti — ayakların da dışında. */
export const CAGE_OFFSET_M = 0.3

/** Korkuluğun helisi takip ettiği yarıçap. */
export function handrailRadiusM(node: ConveyorSpiralNode): number {
  return slatOuterRadiusM(node) + HANDRAIL_OFFSET_M
}

/** Çevre destek ayaklarının yarıçapı — slat halkasının DIŞINDA. */
export function legRadiusM(node: ConveyorSpiralNode): number {
  return slatOuterRadiusM(node) + LEG_OFFSET_M
}

/** Güvenlik kafesi yarıçapı — her şeyin dışında. */
export function cageRadiusM(node: ConveyorSpiralNode): number {
  return slatOuterRadiusM(node) + CAGE_OFFSET_M
}

/** Giriş/çıkış tanjant güdüğünün kafes kenarından uzanımı, metre. */
export const TANGENT_STUB_M = 0.6

/** Bir portun (tanjant ucunun) merkezden yerel X uzaklığı. */
export function portSpanM(node: ConveyorSpiralNode): number {
  return cageRadiusM(node) + TANGENT_STUB_M
}

/** Kolider/plan izinin kenar uzunluğu: kafes çapı + iki tanjant güdüğü. */
export function footprintM(node: ConveyorSpiralNode): number {
  return 2 * cageRadiusM(node) + 2 * TANGENT_STUB_M
}

/** Çevre ayağı sayısı, 4–8 — çevre uzunluğuna göre. */
export function legCount(node: ConveyorSpiralNode): number {
  const circumference = TWO_PI * legRadiusM(node)
  return Math.min(8, Math.max(4, Math.round(circumference / 1.2)))
}

/** Gövde genişliği payı (yan profiller) — tanjant güdüklerinin çerçevesi. */
export const FRAME_OVER_BELT_M = 0.12

/** Malın kat ettiği yolun toplam bant sınıfı için port genişliği. */
export function frameWidthM(node: ConveyorSpiralNode): number {
  return beltWidthM(node) + FRAME_OVER_BELT_M
}

/** Sınıfın görselleştirme hızı, m/s. */
export function beltSpeedMS(node: ConveyorSpiralNode): number {
  return SPIRAL_BELT_SPEED_MS[node.loadClass]
}

// ── Taşınan koliler ──────────────────────────────────────────────────────────
//
// Bant SABİT çizilir; hareket eden koliler helis yolunu takip eden ayrı
// instance'lardır (spec §5: "yük nesneleri aynı helis yolunu takip eden ayrı
// instance'lar"). Aşağısı o yolun saf matematiği — renderer yalnız matrisleri
// yazar.

/** İki koli arası yay uzaklığı, metre — SEÇİLMİŞ VARSAYILAN (görselleştirme). */
export const SPIRAL_BOX_GAP_M = 1.4
/** Aynı anda çizilen en fazla koli — üçgen/matris bütçesi. */
export const SPIRAL_MAX_BOXES = 24

/**
 * Helis yayının `t` parametresi başına uzunluğu: √(R² + (pitch/2π)²).
 *
 * Bir malın kat ettiği yol düz değil eğik: her radyanlık `t` artışı hem yatay
 * R·dt hem dikey (pitch/2π)·dt gider. Koli aralığı ve hızı bu orana bölünerek
 * `t`'ye çevriliyor, yani koliler yayda eşit aralıklı ve gerçek hızda akar.
 */
export function helixArcPerRad(node: ConveyorSpiralNode): number {
  const r = helixRadiusM(node)
  const c = pitchM(node) / TWO_PI
  return Math.hypot(r, c)
}

/** İki koli arası `t` adımı: yay aralığı / (yay/radyan). */
export function spiralBoxStepRad(node: ConveyorSpiralNode): number {
  return SPIRAL_BOX_GAP_M / Math.max(helixArcPerRad(node), 1e-3)
}

/** Aynı anda helis üzerinde görünen koli sayısı, 1…SPIRAL_MAX_BOXES. */
export function spiralBoxCount(node: ConveyorSpiralNode): number {
  const span = totalAngleRad(node)
  const step = spiralBoxStepRad(node)
  return Math.max(1, Math.min(SPIRAL_MAX_BOXES, Math.floor(span / step)))
}

/**
 * Kolinin `t` ilerleme hızı, radyan/saniye: bant hızı / (yay/radyan).
 *
 * Böylece kolinin yay üzerindeki çizgisel hızı tam `beltSpeedMS` olur. İşaret
 * renderer'da akış yönünden (`up`/`down`) veriliyor; kiralite `t`'nin y'sini
 * değiştirmediği için tırmanış yönünü etkilemez.
 */
export function spiralBoxRateRadPerSec(node: ConveyorSpiralNode): number {
  return beltSpeedMS(node) / Math.max(helixArcPerRad(node), 1e-3)
}
