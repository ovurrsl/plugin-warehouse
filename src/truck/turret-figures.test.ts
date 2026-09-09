import { describe, expect, test } from 'bun:test'
import { TRUCK_MODELS } from '../handling/models'
import { mastRowOf, modelOf, planWidthM } from './metrics'
import { bodiesOf, truckParts } from './parts'

/**
 * BEKÇİ: turret'in çizimi YAYINLANMIŞ satırlardan türer, sabit sayılardan değil.
 *
 * ## Bulunan hata
 *
 * `parts-turret.ts` tekerlekleri `rearX + 0.45` ve `bodyFrontX − 0.05` diye
 * koyuyordu: aralarında 1.17 m vardı, yayınlanmış aks aralığı ise y = 2.220.
 * Dört metrelik makinenin bütün tekerlekleri arka üçte birine toplanmıştı.
 * Yük tekerleği Ø0.34 çiziliyordu; yayınlanmış ön lastik 15.0 × 7.6 in =
 * Ø0.381 × 0.193.
 *
 * ## Neden test
 *
 * Bu hataların hiçbiri HATA VERMEZ. `0.45` kodda masum durur, makine çizilir,
 * paneli açılır — yalnız yanlış orandadır. Deponun kendi kuralı bunu adıyla
 * anıyor: "makul görünen uydurma bir değer, eksik olandan kötüdür, çünkü
 * incelemeden geçer."
 *
 * Bu yüzden testler ÇİZİLENİ yayınlanmış satırla karşılaştırıyor, kodda yazan
 * sayıyla değil: bir sabit geri gelirse burada patlar.
 */

const model = modelOf('tt-1600')

type Drawn = { role: string; center: readonly number[]; size: readonly number[] }

function drawnParts(detail: 'full' | 'simple'): Drawn[] {
  const out: Drawn[] = []
  for (const body of bodiesOf(model)) {
    for (const part of truckParts(model, mastRowOf(null), body, detail)) {
      const q = part as unknown as {
        kind?: string
        role: string
        center?: readonly number[]
        size?: readonly number[]
        radius?: number
        length?: number
        axis?: string
        from?: readonly number[]
        to?: readonly number[]
        z?: number
        thickness?: number
        width?: number
      }
      if (q.kind === 'cyl') {
        const r = q.radius ?? 0
        const l = q.length ?? 0
        out.push({
          role: q.role,
          center: q.center ?? [0, 0, 0],
          size: q.axis === 'z' ? [2 * r, 2 * r, l] : [2 * r, l, 2 * r],
        })
      } else if (q.kind === 'beam') {
        const from = q.from ?? [0, 0]
        const to = q.to ?? [0, 0]
        const len = Math.hypot(to[0]! - from[0]!, to[1]! - from[1]!)
        out.push({
          role: q.role,
          center: [(from[0]! + to[0]!) / 2, (from[1]! + to[1]!) / 2, q.z ?? 0],
          size: [len, q.thickness ?? 0, q.width ?? 0],
        })
      } else {
        out.push({ role: q.role, center: q.center ?? [0, 0, 0], size: q.size ?? [0, 0, 0] })
      }
    }
  }
  return out
}

const wheels = drawnParts('full').filter((part) => part.role === 'wheel')

describe('turret tekerlekleri yayınlanmış satırlardan', () => {
  test('üç teker: bir tahrik, iki yük', () => {
    expect(wheels).toHaveLength(3)
  })

  /**
   * Asıl iddia. z sabit yazılmaz, satırdan türer — ve bu paketin başka bir
   * testi (`tt pivotu öndedir`) zaten z + y = Wa eşitliğini tutuyor.
   */
  test('aks aralığı = yayınlanmış y, sabit sayı değil', () => {
    const drive = wheels.filter((wheel) => Math.abs(wheel.center[2]!) < 1e-6)
    const load = wheels.filter((wheel) => Math.abs(wheel.center[2]!) > 1e-6)
    expect(drive).toHaveLength(1)
    expect(load).toHaveLength(2)
    expect(load[0]!.center[0]! - drive[0]!.center[0]!).toBeCloseTo(model.y, 6)
  })

  test('tahrik aksı arka yüzden z kadar içeride (z = Wa − y)', () => {
    const z = (model.waPivotFromRear ?? 0) - model.y
    const drive = wheels.find((wheel) => Math.abs(wheel.center[2]!) < 1e-6)
    expect(z).toBeCloseTo(0.282, 6)
    expect(drive?.center[0]).toBeCloseTo(-model.l1 / 2 + z, 6)
  })

  test('yük tekerleri yayınlanmış b10 izinde', () => {
    const load = wheels.filter((wheel) => Math.abs(wheel.center[2]!) > 1e-6)
    for (const wheel of load) {
      expect(Math.abs(wheel.center[2]!) * 2).toBeCloseTo(model.b10 ?? 0, 6)
    }
  })

  /**
   * Yayınlanmış lastikler: arka 15.7 × 6.3 in, ön 15.0 × 7.6 in. Ø0.34 bir
   * uydurmaydı ve tam bu satır onu geri gelmekten alıkoyar.
   */
  test('lastik çapları yayınlanmış ölçülerde', () => {
    const drive = wheels.find((wheel) => Math.abs(wheel.center[2]!) < 1e-6)
    const load = wheels.find((wheel) => Math.abs(wheel.center[2]!) > 1e-6)
    expect(drive?.size[1]).toBeCloseTo(0.399, 6)
    expect(load?.size[1]).toBeCloseTo(0.381, 6)
  })
})

describe('turret zarfı çizimle kapanıyor', () => {
  /**
   * Yayınlanmış genel genişliği yapan KABİN DEĞİL ÖN AKS:
   * b10 + ön lastik = 1.258 + 0.192 = 1.450 = b2, tam.
   */
  test('çizilen genişlik = planWidthM, ve onu yük tekerleri belirliyor', () => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const part of drawnParts('full')) {
      min = Math.min(min, part.center[2]! - part.size[2]! / 2)
      max = Math.max(max, part.center[2]! + part.size[2]! / 2)
    }
    expect(max - min).toBeCloseTo(planWidthM(model), 4)
    const load = wheels.find((wheel) => Math.abs(wheel.center[2]!) > 1e-6)
    expect(Math.abs(load!.center[2]!) + load!.size[2]! / 2).toBeCloseTo(planWidthM(model) / 2, 4)
  })

  test('çizilen uzunluk = l1', () => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const part of drawnParts('full')) {
      min = Math.min(min, part.center[0]! - part.size[0]! / 2)
      max = Math.max(max, part.center[0]! + part.size[0]! / 2)
    }
    expect(max - min).toBeCloseTo(model.l1, 4)
  })

  /**
   * h12 = h3 + h7 = 3.930 "maksimum platform yüksekliği"dir, en yüksek sabit
   * nokta değil. Mast ona çizilince kabin tavanının 1,34 m üstünde çıplak bir
   * direk kalıyordu.
   */
  test('h12 mast tepesi DEĞİL — çizim onun bir hayli altında biter', () => {
    let top = Number.NEGATIVE_INFINITY
    for (const part of drawnParts('full')) top = Math.max(top, part.center[1]! + part.size[1]! / 2)
    expect(top).toBeLessThan((model.h12 ?? 0) - 0.5)
    expect(top).toBeGreaterThan(model.h6 ?? 0)
  })

  test('h12 gerçekten h3 + h7 — okumanın aritmetik kanıtı', () => {
    expect((model.h12 ?? 0) - (model.h7 ?? 0)).toBeCloseTo(3.5, 6)
  })
})

describe('l8 bir turret kafası ölçüsü', () => {
  /** Satır 4.41 ile teyit: l8 − x = 1.103 − 0.445 = 0.658. */
  test('l8 − x = 0.658', () => {
    expect(1.103 - (TRUCK_MODELS['tt-1600'].x ?? 0)).toBeCloseTo(0.658, 6)
  })
})
