/**
 * Görev çevrimi — faz makinesi, VERİ olarak.
 *
 * Faz betiği bir kod dalı değil, bir dizidir (plan §5.4). Her fazın süresi
 * **yayınlanmış bir orandan ve yayınlanmış bir mesafeden** hesaplanır:
 * `süre = mesafe / oran`. Sabit süre yoktur — sabit süre, makinenin
 * yayınlanmış hızını yalana çevirir.
 *
 * Yayınlanmamış açısal hız UYDURULMAZ: hizalanma süresi `Wa` yayının
 * uzunluğunun sürüş hızına bölümüdür, ve bu bir TÜRETİMDİR (Wa dış dönüş
 * yarıçapıdır, referans noktasının izlediği yayın yarıçapı değil) —
 * `ALIGN_BASIS` bunu adıyla taşır.
 */

import type { TruckModel } from '../handling/models'
import type { Station } from './stations'

export type DutyPhase =
  | 'travel-to-source'
  | 'align-source'
  | 'lift-source'
  | 'engage'
  | 'lower-travel'
  | 'travel-to-target'
  | 'align-target'
  | 'lift-target'
  | 'release'
  | 'lower-home'
  | 'dwell'

export type PhaseStep = {
  phase: DutyPhase
  /** Saniye. Mesafe/oran; sıfır süreli faz üretilmez. */
  durationS: number
  /** Bu fazın sonunda çatalın olması gereken kot, metre. */
  forkY: number
  /** Bu faz boyunca araç hareket ediyorsa hedef yay parametresi. */
  s: number | null
}

/**
 * Hizalanma süresinin dayanağı — TÜRETİLMİŞ, yayınlanmış değil.
 *
 * `ω = v / Wa` yaklaşımı: EFG'de Wa 1.440, dingil 1.249 — %15 fark. Panel
 * bu notu taşır; hiçbir çevrim süresi raporu bunu yayınlanmış diye alıntılar.
 */
export const ALIGN_BASIS_NOTE =
  'Hizalanma süresi Wa yayından türetilmiştir; üretici açısal hız yayınlamıyor.'

/** Taşıma sırasında çatalın yerden yüksekliği — güvenli taşıma kotu. */
export const TRAVEL_FORK_Y = 0.3

/** Yükü bırakıp almanın mekanik süresi. Ölçülmüş değil, çalışma tahmini. */
export const ENGAGE_S = 1.5
export const DWELL_S = 2

function speedMps(model: TruckModel): number {
  const kmh = model.travelKmh.laden ?? model.travelKmh.efficiency ?? model.travelKmh.plus ?? 0
  return (kmh * 1000) / 3600
}

/** Kaldırma hızı; yayınlanmamışsa (forklift) makul bir taban kullanılır. */
function liftMps(model: TruckModel): number {
  return model.liftMs ?? 0.3
}

function lowerMps(model: TruckModel): number {
  return model.lowerMs ?? model.liftMs ?? 0.4
}

/**
 * Bir istasyonda hizalanma süresi: çeyrek Wa yayı, sürüş hızında.
 *
 * Wa yayınlanmamışsa (bazı transpalet satırları) hizalanma fazı ÜRETİLMEZ —
 * uydurulmuş bir süre, çevrim raporunu uydurulmuş yapardı.
 */
function alignS(model: TruckModel): number {
  if (model.Wa === null) return 0
  const v = speedMps(model)
  if (v <= 0) return 0
  return ((Math.PI / 2) * model.Wa * 0.5) / v
}

/**
 * Bir alma–bırakma çevriminin faz betiği.
 *
 * Betik bir dizidir ve okuyan (`fleet.ts`) yalnız süreleri toplar; hangi
 * fazın ne yaptığı burada, tek yerde yazılıdır.
 */
export function buildCycle(
  model: TruckModel,
  source: Station,
  target: Station,
  startS: number,
): PhaseStep[] {
  const v = speedMps(model)
  const lift = liftMps(model)
  const lower = lowerMps(model)
  const align = alignS(model)

  const sourceY = Math.max(source.slot.localPosition[1], source.reading.minSetDownY)
  const targetY = Math.max(target.slot.localPosition[1], target.reading.minSetDownY)

  const travel = (from: number, to: number) => (v > 0 ? Math.abs(to - from) / v : 0)

  const steps: PhaseStep[] = [
    {
      phase: 'travel-to-source',
      durationS: travel(startS, source.s),
      forkY: TRAVEL_FORK_Y,
      s: source.s,
    },
    { phase: 'align-source', durationS: align, forkY: TRAVEL_FORK_Y, s: source.s },
    {
      phase: 'lift-source',
      durationS: lift > 0 ? Math.abs(sourceY - TRAVEL_FORK_Y) / lift : 0,
      forkY: sourceY,
      s: source.s,
    },
    { phase: 'engage', durationS: ENGAGE_S, forkY: sourceY, s: source.s },
    {
      phase: 'lower-travel',
      durationS: lower > 0 ? Math.abs(sourceY - TRAVEL_FORK_Y) / lower : 0,
      forkY: TRAVEL_FORK_Y,
      s: source.s,
    },
    {
      phase: 'travel-to-target',
      durationS: travel(source.s, target.s),
      forkY: TRAVEL_FORK_Y,
      s: target.s,
    },
    { phase: 'align-target', durationS: align, forkY: TRAVEL_FORK_Y, s: target.s },
    {
      phase: 'lift-target',
      durationS: lift > 0 ? Math.abs(targetY - TRAVEL_FORK_Y) / lift : 0,
      forkY: targetY,
      s: target.s,
    },
    { phase: 'release', durationS: ENGAGE_S, forkY: targetY, s: target.s },
    {
      phase: 'lower-home',
      durationS: lower > 0 ? Math.abs(targetY - TRAVEL_FORK_Y) / lower : 0,
      forkY: TRAVEL_FORK_Y,
      s: target.s,
    },
    { phase: 'dwell', durationS: DWELL_S, forkY: TRAVEL_FORK_Y, s: target.s },
  ]

  // Sıfır süreli faz üretilmez: hizalanma yayınlanmamışsa o adım hiç yoktur
  // ve çevrim raporu onu saymaz.
  return steps.filter((step) => step.durationS > 0)
}

/** Çevrimin toplam süresi — panelin "çevrim N s" okuması. */
export function cycleSeconds(steps: readonly PhaseStep[]): number {
  return steps.reduce((total, step) => total + step.durationS, 0)
}

/** Verilen `t` anında hangi adımda ve o adımın neresindeyiz. */
export function stepAt(
  steps: readonly PhaseStep[],
  t: number,
): { step: PhaseStep; index: number; progress: number } | null {
  if (steps.length === 0) return null
  let remaining = t
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (!step) continue
    if (remaining < step.durationS) {
      return { step, index, progress: step.durationS > 0 ? remaining / step.durationS : 1 }
    }
    remaining -= step.durationS
  }
  const last = steps[steps.length - 1]
  return last ? { step: last, index: steps.length - 1, progress: 1 } : null
}

/** Paletin araçta olduğu fazlar — `engage` sonundan `release` sonuna. */
export function carriesPallet(phase: DutyPhase): boolean {
  return (
    phase === 'lower-travel' ||
    phase === 'travel-to-target' ||
    phase === 'align-target' ||
    phase === 'lift-target'
  )
}
