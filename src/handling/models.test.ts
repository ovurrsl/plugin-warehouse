import { describe, expect, test } from 'bun:test'
import {
  chainCloses,
  counterbalancedChainResidualM,
  forkChainApplies,
  forkChainResidualM,
  reachChainResidualM,
} from './chains'
import { REACH_REAR_TO_DRIVE_AXLE_M } from './constants'
import { gapsFor, KNOWN_GAPS } from './gaps'
import {
  EFG_ZT_H2_M,
  EKX_H4_OVER_H3_M,
  MAST_H3_CAP_M,
  MAST_ROWS,
  mastRowFor,
  mastRowMatchingH3,
  mastRowsFor,
  REACH_H1_OVER_H2_M,
  REACH_H4_OVER_H3_M,
} from './masts'
import { aisleBandForVariant } from './metrics'
import { envelopeWidthM, modelsOf, TRUCK_MODEL_IDS, TRUCK_MODELS, type TruckModel } from './models'

/**
 * `chains.test.ts` doküman literallerini kilitler; bu dosya AYNI zincirleri
 * `TRUCK_MODELS`'a uygular. İkisi farklı hatayı yakalar: orası dokümanın
 * kendi içi, burası dokümandan kataloğa TRANSKRİPSİYON. Bir sayı yanlış
 * kopyalandıysa bir artık sıfırdan sapar.
 */

const ALL = TRUCK_MODEL_IDS.map((id) => TRUCK_MODELS[id])

describe('katalog şekli', () => {
  test('kullanıcının filosu: aile başına bir satır, beş satır', () => {
    expect(ALL.length).toBe(5)
    for (const variant of [
      'hand-pallet',
      'powered-pallet',
      'forklift',
      'reach',
      'turret',
    ] as const) {
      expect(modelsOf(variant).length, variant).toBe(1)
    }
    expect(modelsOf('agv').length).toBe(0)
  })

  test('her satırın id alanı kayıt anahtarıyla aynı', () => {
    for (const id of TRUCK_MODEL_IDS) {
      expect(TRUCK_MODELS[id].id).toBe(id)
    }
  })
})

describe('zincirler katalog satırlarına hakemlik eder', () => {
  test('turret dışı her satırda l1 = l2 + çatal boyu', () => {
    for (const m of ALL) {
      if (!forkChainApplies(m.variant)) continue
      const residual = forkChainResidualM({
        overallLengthL1: m.l1,
        lengthToForkFaceL2: m.l2,
        forkLengthM: m.fork.length,
      })
      expect(chainCloses(residual), `${m.id}: artık ${residual}`).toBe(true)
    }
  })

  test('forklift: l2 = arkaSarkma + y + x', () => {
    const m = TRUCK_MODELS['forklift-1300']
    const residual = counterbalancedChainResidualM({
      lengthToForkFaceL2: m.l2,
      rearOverhangM: m.rearOverhang as number,
      wheelbaseY: m.y,
      loadDistanceX: m.x as number,
    })
    expect(chainCloses(residual), `artık ${residual}`).toBe(true)
  })

  test('reach: x = (0.210 + y) − l2', () => {
    const m = TRUCK_MODELS['rt-1800']
    const residual = reachChainResidualM({
      loadDistanceX: m.x as number,
      rearToDriveAxleM: REACH_REAR_TO_DRIVE_AXLE_M.value,
      wheelbaseY: m.y,
      lengthToForkFaceL2: m.l2,
    })
    expect(chainCloses(residual), `artık ${residual}`).toBe(true)
  })

  test('turret jenerik zinciri REDDEDER: l1 − l2 = 0.286, sapma 914 mm', () => {
    expect(forkChainApplies('turret')).toBe(false)
    const m = TRUCK_MODELS['tt-1600']
    expect(m.l1 - m.l2).toBeCloseTo(0.286, 9)
    const wrong = forkChainResidualM({
      overallLengthL1: m.l1,
      lengthToForkFaceL2: m.l2,
      forkLengthM: m.fork.length,
    })
    expect(wrong).toBeCloseTo(-0.914, 9)
  })
})

describe('T5 — palet yönelimi: 1000×1200 her yayınlanmış çiftte dardır', () => {
  test('üç yayınlanmış çift (ept, forklift, rt), hepsinde load1000x1200 < load800x1200', () => {
    const published = ALL.filter((m) => m.ast !== null)
    expect(published.map((m) => m.id).sort()).toEqual(['ept-2500', 'forklift-1300', 'rt-1800'])
    for (const m of published) {
      const ast = m.ast as NonNullable<TruckModel['ast']>
      expect(ast.load1000x1200, m.id).toBeLessThan(ast.load800x1200)
    }
  })
})

describe("T6 — sunulmayan paket null'dur, asla 0", () => {
  test('hiçbir hız 0 değil', () => {
    for (const m of ALL) {
      for (const v of [m.travelKmh.laden, m.travelKmh.efficiency, m.travelKmh.plus]) {
        expect(v, m.id).not.toBe(0)
      }
    }
  })

  test('mpt motorsuzdur: üç kanal da null — 0 yazılsaydı simülasyon hatası sanılırdı', () => {
    const { travelKmh } = TRUCK_MODELS['mpt-680x1150']
    expect(travelKmh.laden).toBeNull()
    expect(travelKmh.efficiency).toBeNull()
    expect(travelKmh.plus).toBeNull()
  })
})

describe('T7 — zarf genişliği yayınlanmış en geniş kesittir', () => {
  test('tt-1600: kabin gövdeden 240 mm geniş, zarf 1.45', () => {
    expect(envelopeWidthM(TRUCK_MODELS['tt-1600'])).toBeCloseTo(1.45, 9)
    expect(TRUCK_MODELS['tt-1600'].b1).toBeCloseTo(1.21, 9)
  })

  test('b2 yayınlanmamışsa ya da eşitse zarf b1', () => {
    expect(envelopeWidthM(TRUCK_MODELS['forklift-1300'])).toBe(TRUCK_MODELS['forklift-1300'].b1)
    expect(envelopeWidthM(TRUCK_MODELS['rt-1800'])).toBeCloseTo(1.27, 9)
  })
})

describe('T8 — mast kimlikleri', () => {
  test('türetilmiş sabitler doküman değerlerinde', () => {
    expect(REACH_H4_OVER_H3_M).toBeCloseTo(0.746, 9)
    expect(REACH_H1_OVER_H2_M).toBeCloseTo(0.73, 9)
    expect(EKX_H4_OVER_H3_M).toBeCloseTo(2.55, 9)
  })

  test('forklift iki grubunun tepe payı EŞİT DEĞİL — tek sabitle satır türetilemez', () => {
    const a = MAST_ROWS.find((r) => r.id === 'efg-a-zt-3000')
    const b = MAST_ROWS.find((r) => r.id === 'efg-b-zt-3000')
    if (!a || !b) throw new Error('EFG 3000 ZT satırları katalogdan düşmüş')
    expect(a.h4 - a.h3).toBeCloseTo(0.59, 9)
    expect(b.h4 - b.h3).toBeCloseTo(0.612, 9)
    expect(a.h4 - a.h3).not.toBeCloseTo(b.h4 - b.h3, 3)
  })

  test('ZT serbest kaldırma h2 = 0.150 her satırda', () => {
    for (const row of MAST_ROWS) {
      expect(row.h2).toBe(EFG_ZT_H2_M)
    }
  })
})

describe('T9 — satırlar arasından konfigürasyon uydurulamaz', () => {
  const forklift = TRUCK_MODELS['forklift-1300']
  const reach = TRUCK_MODELS['rt-1800']

  test('tam h3 satır döner, ara h3 null', () => {
    expect(mastRowMatchingH3(forklift, 3.0)?.id).toBe('efg-a-zt-3000')
    expect(mastRowMatchingH3(forklift, 2.5)).toBeNull()
    expect(mastRowMatchingH3(forklift, 3.02)).toBeNull()
  })

  test('satırı olmayan aile grup aralığının içinde bile satır alamaz', () => {
    expect(mastRowsFor(reach).length).toBe(0)
    expect(mastRowMatchingH3(reach, 4.25)).toBeNull()
  })

  test('model sunmadığı tablonun satırını alamaz', () => {
    expect(mastRowFor(reach, 'efg-a-zt-3000')).toBeNull()
    expect(mastRowFor(forklift, 'efg-b-zt-3000')).toBeNull()
    expect(mastRowFor(forklift, 'efg-a-zt-3000')?.h4).toBeCloseTo(3.59, 9)
  })

  test('tt-1600 h3 tavanı 18.0 — ve yalnız o modelde bir tavan var', () => {
    expect(MAST_H3_CAP_M['tt-1600']).toBeCloseTo(18.0, 9)
    expect(Object.keys(MAST_H3_CAP_M)).toEqual(['tt-1600'])
  })
})

describe("T10 — her yayınlanmış null'ın gaps.ts'te karşılığı var", () => {
  test('ast === null olan her satıra Ast boşluk girişi dokunuyor', () => {
    const nullAst = ALL.filter((m) => m.ast === null)
    expect(nullAst.map((m) => m.id).sort()).toEqual(['mpt-680x1150', 'tt-1600'])
    for (const m of nullAst) {
      const hit = gapsFor(m).some((gap) => gap.figure.includes('Ast'))
      expect(hit, `${m.id}: Ast boşluk girişi yok`).toBe(true)
    }
  })

  test('Wa === null olan her satıra Wa boşluk girişi dokunuyor', () => {
    for (const m of ALL.filter((x) => x.Wa === null)) {
      const hit = gapsFor(m).some((gap) => gap.figure.includes('Wa'))
      expect(hit, `${m.id}: Wa boşluk girişi yok`).toBe(true)
    }
  })

  test('reach b10 null + kayıtlı', () => {
    expect(TRUCK_MODELS['rt-1800'].b10).toBeNull()
    expect(KNOWN_GAPS.some((g) => g.scope === 'reach' && g.figure.includes('b10'))).toBe(true)
  })
})

describe('T11 — rapor sınıf bandını değiştirmez', () => {
  test("aisleBandForVariant('turret') hâlâ EN 15620: 1.7–1.9, published", () => {
    const band = aisleBandForVariant('turret')
    expect(band.basis).toBe('published')
    expect(band.min).toBeCloseTo(1.7, 9)
    expect(band.max).toBeCloseTo(1.9, 9)
  })
})

describe('T12 — birim disiplini: metre alanına milimetre yazılamaz', () => {
  const metreFieldsOf = (m: TruckModel): Array<[string, number]> => {
    const out: Array<[string, number]> = []
    const push = (name: string, v: number | null) => {
      if (v !== null) out.push([name, v])
    }
    push('l1', m.l1)
    push('l2', m.l2)
    push('b1', m.b1)
    push('b2', m.b2)
    push('b4', m.b4)
    if (typeof m.b5 === 'number') push('b5', m.b5)
    else if (m.b5) {
      push('b5.min', m.b5.min)
      push('b5.max', m.b5.max)
    }
    push('b10', m.b10)
    push('b11', m.b11)
    push('y', m.y)
    push('x', m.x)
    push('fork.s', m.fork.s)
    push('fork.e', m.fork.e)
    push('fork.length', m.fork.length)
    push('c', m.c)
    push('h6', m.h6)
    push('h7', m.h7)
    push('h8', m.h8)
    push('h13', m.h13)
    if (typeof m.h14 === 'number') push('h14', m.h14)
    else if (m.h14) {
      push('h14.min', m.h14[0])
      push('h14.max', m.h14[1])
    }
    push('rearOverhang', m.rearOverhang)
    if (m.ast) {
      push('ast.1000', m.ast.load1000x1200)
      push('ast.800', m.ast.load800x1200)
    }
    push('Wa', m.Wa)
    push('waPivotFromRear', m.waPivotFromRear)
    return out
  }

  test('her metre alanı 0 < v < 100', () => {
    for (const m of ALL) {
      for (const [name, v] of metreFieldsOf(m)) {
        expect(v, `${m.id}.${name} = ${v}`).toBeGreaterThan(0)
        expect(v, `${m.id}.${name} = ${v} — mm mi yazıldı?`).toBeLessThan(100)
      }
    }
    for (const row of MAST_ROWS) {
      for (const v of [row.h1, row.h2, row.h3, row.h4]) {
        expect(v).toBeLessThan(100)
      }
    }
  })
})

describe('T13 — basis çamaşırhanesi yok: her tahmin ve boşluk gerekçeli', () => {
  test('her modelin notları boş değil', () => {
    for (const m of ALL) {
      expect(m.notes.length, m.id).toBeGreaterThan(0)
      for (const note of m.notes) {
        expect(note.length, m.id).toBeGreaterThan(10)
      }
    }
  })

  test('her boşluk girişinin gerekçesi tam cümle', () => {
    for (const gap of KNOWN_GAPS) {
      expect(gap.note.length, `${String(gap.scope)}/${gap.figure}`).toBeGreaterThan(40)
    }
  })

  test('tahmin sarmalayıcısının notu boş değil', () => {
    expect(REACH_REAR_TO_DRIVE_AXLE_M.note.length).toBeGreaterThan(40)
  })
})

describe('T14 — kimlikler markasız ve işlevsel', () => {
  test('her id aile önekiyle başlar, küçük harf slug', () => {
    for (const id of TRUCK_MODEL_IDS) {
      expect(id).toMatch(/^(mpt|ept|forklift|rt|tt)-[a-z0-9-]+$/)
    }
  })

  test('hiçbir id üretici adı ya da ürün kodu içermez', () => {
    for (const id of TRUCK_MODEL_IDS) {
      expect(id).not.toMatch(/jungheinrich|efg|etv|etm|ekx|linde|still|toyota|crown|yale/i)
    }
  })
})

describe('katalogda kilitli aile davranışları', () => {
  test('rt-1800 paleti ayaklar ARASINA indirir (b4 > 0.8)', () => {
    expect(TRUCK_MODELS['rt-1800'].b4 as number).toBeGreaterThan(0.8)
  })

  test('b5 şekli aileye göre: reach aralık, forklift null, gerisi sayı', () => {
    for (const m of ALL) {
      if (m.variant === 'reach') {
        const b5 = m.b5 as { min: number; max: number }
        expect(typeof b5).toBe('object')
        expect(b5.min).toBeLessThan(b5.max)
      } else if (m.variant === 'forklift') {
        expect(m.b5).toBeNull()
      } else {
        expect(typeof m.b5).toBe('number')
      }
    }
  })

  test("rezidüel kapasite yalnız reach'te yayınlanmamış", () => {
    for (const m of ALL) {
      expect(m.residualCapacityPublished, m.id).toBe(m.variant !== 'reach')
    }
  })

  test('dönüş pivotu: forklift y + 0.190 (Wa ile teyitli), reach 0.210 + y, transpaletlerde yok', () => {
    const forklift = TRUCK_MODELS['forklift-1300']
    expect((forklift.waPivotFromRear as number) - forklift.y).toBeCloseTo(0.19, 9)
    const reach = TRUCK_MODELS['rt-1800']
    expect((reach.waPivotFromRear as number) - reach.y).toBeCloseTo(0.21, 9)
    expect(TRUCK_MODELS['mpt-680x1150'].waPivotFromRear).toBeNull()
    expect(TRUCK_MODELS['ept-2500'].waPivotFromRear).toBeNull()
  })

  test('tt-1600: pivot z + y yayınlanmış Wa ile tam örtüşür — ailenin doğrulama noktası', () => {
    const m = TRUCK_MODELS['tt-1600']
    expect(m.waPivotFromRear).toBeCloseTo(m.Wa as number, 9)
  })
})
