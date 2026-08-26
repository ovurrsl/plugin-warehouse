/**
 * Sarmal konveyör parçaları — iki liste, iki birleştirilmiş buffer.
 *
 * **STATIK** (`spiralStaticParts`): çevre ayakları, giriş/çıkış tanjant
 * güdükleri, tahrik motoru ve — yalnız tam katmanda — helisi takip eden
 * korkuluk kirişleri. Hareket etmez.
 *
 * **SLAT** (`spiralSlatParts`): taşıma yüzeyinin ayrık slat dizisi, DİNLENME
 * helisi üzerinde (y tabanı 0). `entryHeight` ofseti ve vida hareketi
 * renderer'da grup dönüşümüdür — slat vertex'leri kotu ya da pozu taşımaz.
 *
 * Merkez kolon ve güvenlik kafesi burada YOK: ikisi de silindir, birleştirilmiş
 * kutu üreticisi yalnız kutu emitliyor. Renderer'da birim silindir olarak
 * ölçekleniyorlar.
 */

import type { ConveyorDetail } from './parts'
import {
  beltWidthM,
  cageRadiusM,
  entryHeightM,
  exitAngleRad,
  exitHeightM,
  frameWidthM,
  handednessSign,
  handrailRadiusM,
  helixPoint,
  helixRadiusM,
  inclineRad,
  legCount,
  legRadiusM,
  pitchM,
  portSpanM,
  slatStepRad,
  totalAngleRad,
} from './spiral-metrics'
import type { ConveyorSpiralNode } from './spiral-schema'

export type SpiralPartRole = 'leg' | 'footplate' | 'stub' | 'motor' | 'handrail'

export type SpiralPart = {
  role: SpiralPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  rotationY?: number
  tiltX?: number
}

/** Slat kendi dönüşünü ve eğimini taşır — emitPart bunları tilt-sonra-yaw
 *  uyguluyor (canlı raflamayla aynı sıra). */
export type SpiralSlat = {
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  rotationY: number
  tiltX: number
}

const TWO_PI = Math.PI * 2

const LEG_SECTION_M = 0.08
const STUB_DEPTH_M = 0.06
const RAIL_HEIGHT_M = 1.0
const RAIL_SECTION_M = 0.04
/** Korkuluk segment adımı — slat'tan seyrek, üçgen bütçesi için. */
const HANDRAIL_STEP_RAD = TWO_PI / 12
/** Slat kalınlığı — koli, üst yüzeyine (helis + bunun yarısı) oturur. */
export const SLAT_THICKNESS_M = 0.03

/**
 * Statik iskelet.
 *
 * Ayaklar tam boy dikey direkler (çevre kulesi), slat halkasının DIŞINDA
 * (`legRadius > R + bant/2`). Tanjant güdükleri −X (giriş, `entryHeight`) ve
 * θexit (çıkış, `exitHeight`) — ikisi ayrı kotta, portların per-port Y'sinin
 * geometrik karşılığı. Korkuluk yalnız tam katmanda.
 */
export function spiralStaticParts(
  node: ConveyorSpiralNode,
  detail: ConveyorDetail,
  resolvedRise?: number,
): SpiralPart[] {
  const parts: SpiralPart[] = []
  const legR = legRadiusM(node)
  const legs = legCount(node)
  const top = exitHeightM(node, resolvedRise)
  const entry = entryHeightM(node)
  const cage = cageRadiusM(node)
  const span = portSpanM(node)
  const frame = frameWidthM(node)
  const thetaExit = exitAngleRad(node, resolvedRise)
  const rStub = (cage + span) / 2

  // Çevre destek ayakları — tam boy direkler + taban plakaları (full).
  for (let i = 0; i < legs; i++) {
    const angle = (i / legs) * TWO_PI
    const x = legR * Math.cos(angle)
    const z = legR * Math.sin(angle)
    parts.push({ role: 'leg', center: [x, top / 2, z], size: [LEG_SECTION_M, top, LEG_SECTION_M] })
    if (detail === 'full') {
      parts.push({ role: 'footplate', center: [x, 0.006, z], size: [0.18, 0.012, 0.18] })
    }
  }

  // Giriş tanjant güdüğü: −X (açı π), bant kotu `entryHeight`.
  parts.push({
    role: 'stub',
    center: [-(cage + span) / 2, entry - 0.03, 0],
    size: [span - cage, STUB_DEPTH_M, frame],
  })
  // Çıkış tanjant güdüğü: θexit açısında, bant kotu `exitHeight`.
  parts.push({
    role: 'stub',
    center: [rStub * Math.cos(thetaExit), top - 0.03, rStub * Math.sin(thetaExit)],
    size: [span - cage, STUB_DEPTH_M, frame],
    rotationY: thetaExit,
  })

  if (detail === 'full') {
    // Giriş güdüğünü taşıyan uç ayak.
    parts.push({
      role: 'leg',
      center: [-span + 0.1, entry / 2, 0],
      size: [LEG_SECTION_M, entry, LEG_SECTION_M],
    })
    // Çıkış güdüğünü taşıyan uç ayak (θexit açısında).
    const rLeg = span - 0.1
    parts.push({
      role: 'leg',
      center: [rLeg * Math.cos(thetaExit), top / 2, rLeg * Math.sin(thetaExit)],
      size: [LEG_SECTION_M, top, LEG_SECTION_M],
    })
    // Tahrik motoru — tabanda, kolonun yanında (RAL 7016 = gövde boyası).
    parts.push({
      role: 'motor',
      center: [-cage * 0.5, 0.2, cage * 0.55],
      size: [0.5, 0.35, 0.4],
    })
  }

  // Korkuluk: helisi handrailRadius'ta, bant üstünden RAIL_HEIGHT yukarıda
  // takip eder. YALNIZ tam katmanda ve `hasHandrail` açıkken.
  if (detail === 'full' && node.hasHandrail) {
    const railR = handrailRadiusM(node)
    const r = helixRadiusM(node)
    const s = handednessSign(node)
    const scale = railR / r
    const total = totalAngleRad(node, resolvedRise)
    const chord = railR * HANDRAIL_STEP_RAD
    const tilt = -s * inclineRad(node)
    for (let t = 0; t <= total + 1e-9; t += HANDRAIL_STEP_RAD) {
      const [hx, hy, hz] = helixPoint(node, t)
      parts.push({
        role: 'handrail',
        center: [hx * scale, entry + hy + RAIL_HEIGHT_M, hz * scale],
        size: [RAIL_SECTION_M, RAIL_SECTION_M, chord],
        rotationY: Math.PI + s * t,
        tiltX: tilt,
      })
    }
  }

  return parts
}

/**
 * Slat dizisi — DİNLENME helisi (y tabanı 0), `entryHeight` YOK.
 *
 * Her slat R yarıçapında, radyal uzunluğu bant genişliği (local X → radyal),
 * teğetsel genişliği bir slat adımının yayı. `rotationY = π + s·t` local X'i o
 * parametredeki radyal yöne çeviriyor; `tiltX = -s·eğim` slat'ı tırmanış
 * yönü boyunca yukarı yatırıyor.
 *
 * Aralık `t ∈ [−adım, toplamAçı]`: girişin bir adım ALTINDA fazladan bir slat,
 * vida sarma dikişini gizleyen pay (invaryans testi bu marj slat'ı hariç
 * tutuyor).
 */
export function spiralSlatParts(
  node: ConveyorSpiralNode,
  detail: ConveyorDetail,
  resolvedRise?: number,
): SpiralSlat[] {
  const belt = beltWidthM(node)
  const r = helixRadiusM(node)
  const s = handednessSign(node)
  const step = slatStepRad(detail)
  const total = totalAngleRad(node, resolvedRise)
  const tangential = Math.max(0.02, r * step * 0.85)
  const tilt = -s * inclineRad(node)
  const slats: SpiralSlat[] = []
  for (let t = -step; t <= total + 1e-9; t += step) {
    const [x, y, z] = helixPoint(node, t)
    slats.push({
      center: [x, y, z],
      size: [belt, SLAT_THICKNESS_M, tangential],
      rotationY: Math.PI + s * t,
      tiltX: tilt,
    })
  }
  return slats
}

/** İlk slat (t = −adım) vida dikişini gizleyen marj — invaryans testinde
 *  kaynak olarak kullanılmaz. */
export const SLAT_MARGIN_COUNT = 1

/** Bir slat merkezini vida hareketiyle taşıyan yardımcı — üç konvansiyonu
 *  (Y dönüşü + Y ötelemesi) `screwYawPerStep`/`screwYPerStep` ile aynı. Test
 *  bunu slat_k → slat_{k+1} için kilitliyor. */
export function screwCenter(
  center: readonly [number, number, number],
  yaw: number,
  dy: number,
): [number, number, number] {
  const [x, y, z] = center
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  // three'nin Y dönüşü: x' = x·cos + z·sin, z' = −x·sin + z·cos.
  return [x * cos + z * sin, y + dy, -x * sin + z * cos]
}

export { pitchM }
