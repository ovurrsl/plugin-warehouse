/**
 * Görev çevrimi — faz makinesi, VERİ olarak (`truck/duty.ts`'in şekli).
 *
 * Spec §5 durum makinesi: IDLE → ÇAĞRILDI → KONUMLANIYOR → YÜKLENİYOR → SEYİR
 * → BOŞALTILIYOR → IDLE. Demoda dış çağıran yok, o yüzden ÇAĞRILDI ve
 * KONUMLANIYOR ilk seyir bacağına toplanıyor; geriye beş faz kalıyor.
 *
 * Betik bir kod dalı değil bir DİZİ: her adım süresini yayınlanmış hız ve
 * gerçek mesafeden alıyor (`süre = |Δy| / hız`). Kapı ve bekleme süreleri
 * yayınlanmamış — `catalog.ts`'te ÇALIŞMA TAHMİNİ olarak işaretli.
 *
 * ## KİLİT İNVARİYANTI (EN 1570 lezzeti)
 *
 * Kapının açık olduğu (`doorOpen: 1`) HER adımda platform TAM O DURAĞIN
 * kotunda olmak zorunda: `platformY === stops[doorStopIndex].baseY`. Hareket
 * eden bir platformun önünde açık kapı, var olmayan — ve tehlikeli — bir
 * makine. `palletlift.test.ts` bunu pinliyor.
 */

import { DOOR_CLOSE_S, DOOR_OPEN_S, DWELL_LOAD_S } from './catalog'

export type LiftPhase = 'idle' | 'doors-open' | 'loading' | 'doors-close' | 'travel'

export type LiftStep = {
  phase: LiftPhase
  /** Saniye. Mesafe/hız (seyir) ya da yayınlanmamış çalışma tahmini (kapı/bekleme). */
  durationS: number
  /** Bu adımın sonunda platformun olması gereken kot, metre. */
  platformY: number
  /** Kapının bağlı olduğu durak indeksi, ya da seyirde `null`. */
  doorStopIndex: number | null
  /** Kapı açık mı — 1 ise platform o durakta olmak ZORUNDA (kilit invariant'ı). */
  doorOpen: 0 | 1
}

/** Çevrim hız satırı — kapasite kademesinin m/dak'sı. */
export type CycleSpeedRow = { mpm: number }

/**
 * Bir devriye çevriminin faz betiği: alttan üste, sonra üstten alta.
 *
 * Duraklar deterministik bir sırayla ziyaret ediliyor (`0..n-1` sonra
 * `n-2..1`), her varışta kapı-aç / yükle / kapı-kapa, aralarda seyir. Çevrimin
 * sonunda alt durağa dönen kapanış bacağı var, yoksa sonraki çevrimin ilk
 * kapı adımı platform tepedeyken açılır — kilit invariant'ı ihlali.
 */
export function buildLiftCycle(
  stops: ReadonlyArray<{ baseY: number }>,
  speed: CycleSpeedRow,
): LiftStep[] {
  const n = stops.length
  if (n < 2) return []
  const mps = speed.mpm / 60

  const order: number[] = []
  for (let i = 0; i < n; i++) order.push(i)
  for (let i = n - 2; i >= 1; i--) order.push(i)

  const steps: LiftStep[] = []
  const travel = (from: number, to: number) => {
    const durationS = mps > 0 ? Math.abs(to - from) / mps : 0
    // Sıfır süreli seyir üretilmez (alt duraktan alt durağa "seyir" gibi).
    if (durationS <= 0) return
    steps.push({ phase: 'travel', durationS, platformY: to, doorStopIndex: null, doorOpen: 0 })
  }

  let prevY = stops[order[0] ?? 0]?.baseY ?? 0
  for (const i of order) {
    const y = stops[i]?.baseY ?? 0
    travel(prevY, y)
    steps.push({
      phase: 'doors-open',
      durationS: DOOR_OPEN_S,
      platformY: y,
      doorStopIndex: i,
      doorOpen: 1,
    })
    steps.push({
      phase: 'loading',
      durationS: DWELL_LOAD_S,
      platformY: y,
      doorStopIndex: i,
      doorOpen: 1,
    })
    steps.push({
      phase: 'doors-close',
      durationS: DOOR_CLOSE_S,
      platformY: y,
      doorStopIndex: i,
      doorOpen: 1,
    })
    prevY = y
  }
  // Kapanış bacağı: alt durağa dön.
  travel(prevY, stops[order[0] ?? 0]?.baseY ?? 0)

  return steps
}

/** Çevrimin toplam süresi, saniye. */
export function cycleLength(steps: readonly LiftStep[]): number {
  return steps.reduce((total, step) => total + step.durationS, 0)
}

/** `t` anında hangi adımda ve o adımın neresindeyiz (`duty.ts stepAt` şekli). */
export function stepAt(
  steps: readonly LiftStep[],
  t: number,
): { step: LiftStep; index: number; localT: number } | null {
  if (steps.length === 0) return null
  let remaining = t
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (!step) continue
    if (remaining < step.durationS) {
      return { step, index, localT: step.durationS > 0 ? remaining / step.durationS : 1 }
    }
    remaining -= step.durationS
  }
  const last = steps[steps.length - 1]
  return last ? { step: last, index: steps.length - 1, localT: 1 } : null
}
