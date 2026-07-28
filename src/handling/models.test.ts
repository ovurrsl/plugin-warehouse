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
 * kendi içi, burası dokümandan kataloğa TRANSKRİPSİYON. 600 küsur sayının
 * herhangi biri yanlış kopyalandıysa bir artık sıfırdan sapar.
 */

const ALL = TRUCK_MODEL_IDS.map((id) => TRUCK_MODELS[id])

describe('katalog şekli', () => {
  test('22 satır: 4 mpt + 2 ept + 7 forklift + 4 rt + 5 tt', () => {
    expect(ALL.length).toBe(22)
    expect(modelsOf('hand-pallet').length).toBe(4)
    expect(modelsOf('powered-pallet').length).toBe(2)
    expect(modelsOf('forklift').length).toBe(7)
    expect(modelsOf('reach').length).toBe(4)
    expect(modelsOf('turret').length).toBe(5)
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

  test('forklift: l2 = arkaSarkma + y + x, 7/7', () => {
    for (const m of modelsOf('forklift')) {
      expect(m.rearOverhang).not.toBeNull()
      expect(m.x).not.toBeNull()
      const residual = counterbalancedChainResidualM({
        lengthToForkFaceL2: m.l2,
        rearOverhangM: m.rearOverhang as number,
        wheelbaseY: m.y,
        loadDistanceX: m.x as number,
      })
      expect(chainCloses(residual), `${m.id}: artık ${residual}`).toBe(true)
    }
  })

  test('reach: x = (0.210 + y) − l2, 4/4', () => {
    for (const m of modelsOf('reach')) {
      const residual = reachChainResidualM({
        loadDistanceX: m.x as number,
        rearToDriveAxleM: REACH_REAR_TO_DRIVE_AXLE_M.value,
        wheelbaseY: m.y,
        lengthToForkFaceL2: m.l2,
      })
      expect(chainCloses(residual), `${m.id}: artık ${residual}`).toBe(true)
    }
  })

  test('turret jenerik zinciri REDDEDER: l1 − l2 = 0.286 sabit, sapma 914 mm', () => {
    expect(forkChainApplies('turret')).toBe(false)
    for (const m of modelsOf('turret')) {
      expect(m.l1 - m.l2).toBeCloseTo(0.286, 9)
      const wrong = forkChainResidualM({
        overallLengthL1: m.l1,
        lengthToForkFaceL2: m.l2,
        forkLengthM: m.fork.length,
      })
      expect(wrong).toBeCloseTo(-0.914, 9)
    }
  })
})

describe("T4 — kompakt platform Ast'ın l1'den türetilemeyeceğini kanıtlar", () => {
  const main = TRUCK_MODELS['ept-2500']
  const compact = TRUCK_MODELS['ept-2500-compact']

  test('yayınlanmış deltalar: l1/l2 −0.103, Ast −0.108', () => {
    expect(main.l1 - compact.l1).toBeCloseTo(0.103, 9)
    expect(main.l2 - compact.l2).toBeCloseTo(0.103, 9)
    const dAst1000 = (main.ast?.load1000x1200 ?? 0) - (compact.ast?.load1000x1200 ?? 0)
    const dAst800 = (main.ast?.load800x1200 ?? 0) - (compact.ast?.load800x1200 ?? 0)
    expect(dAst1000).toBeCloseTo(0.108, 9)
    expect(dAst800).toBeCloseTo(0.108, 9)
  })

  test('103 ≠ 108: formülle koridor uyduran her yol burada kırılır', () => {
    expect(main.l1 - compact.l1).not.toBeCloseTo(0.108, 3)
  })
})

describe('T5 — palet yönelimi: 1000×1200 her yayınlanmış çiftte dardır', () => {
  test('14 yayınlanmış çift, hepsinde load1000x1200 < load800x1200', () => {
    const published = ALL.filter((m) => m.ast !== null)
    expect(published.length).toBe(14)
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

  test('rt-2500-narrow ve rt-2500 Efficiency sunmaz; rt-1800/rt-2000 sunar', () => {
    expect(TRUCK_MODELS['rt-2500-narrow'].travelKmh.efficiency).toBeNull()
    expect(TRUCK_MODELS['rt-2500'].travelKmh.efficiency).toBeNull()
    expect(TRUCK_MODELS['rt-1800'].travelKmh.efficiency).toBe(11)
    expect(TRUCK_MODELS['rt-2000'].travelKmh.efficiency).toBe(11)
  })
})

describe('T7 — zarf genişliği yayınlanmış en geniş kesittir', () => {
  test('tt: kabin gövdeden geniş, zarf 1.45', () => {
    for (const m of modelsOf('turret')) {
      expect(envelopeWidthM(m)).toBeCloseTo(1.45, 9)
    }
  })

  test('rt-2500-narrow: kabin şasiden DAR, zarf b1 = 1.198 (b2 ?? b1 burada yanlıştı)', () => {
    expect(envelopeWidthM(TRUCK_MODELS['rt-2500-narrow'])).toBeCloseTo(1.198, 9)
  })

  test('b2 yayınlanmamışsa zarf b1', () => {
    for (const m of modelsOf('forklift')) {
      expect(envelopeWidthM(m)).toBe(m.b1)
    }
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

  test('tt h3 tavanları modele göre; 18.0 yalnız tt-1600', () => {
    expect(MAST_H3_CAP_M['tt-1000']).toBeCloseTo(11.5, 9)
    expect(MAST_H3_CAP_M['tt-1200']).toBeCloseTo(11.5, 9)
    expect(MAST_H3_CAP_M['tt-1400']).toBeCloseTo(13.0, 9)
    expect(MAST_H3_CAP_M['tt-1600-short']).toBeCloseTo(14.0, 9)
    expect(MAST_H3_CAP_M['tt-1600']).toBeCloseTo(18.0, 9)
    expect(MAST_H3_CAP_M['rt-1800' as keyof typeof MAST_H3_CAP_M]).toBeUndefined()
  })
})

describe("T10 — her yayınlanmış null'ın gaps.ts'te karşılığı var", () => {
  test('ast === null olan her satıra Ast boşluk girişi dokunuyor', () => {
    const nullAst = ALL.filter((m) => m.ast === null)
    expect(nullAst.length).toBe(8) // 3 mpt kısa varyant + 5 tt
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

  test('reach b10 null + kayıtlı; tt-1400 y çelişkisi kayıtlı', () => {
    for (const m of modelsOf('reach')) {
      expect(m.b10).toBeNull()
    }
    expect(KNOWN_GAPS.some((g) => g.scope === 'reach' && g.figure.includes('b10'))).toBe(true)
    expect(KNOWN_GAPS.some((g) => g.scope === 'tt-1400' && g.figure.includes('y'))).toBe(true)
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
  test('rt-2500-narrow paleti ayak ÜZERİNDEN taşır (b4 < 0.8), diğer üç reach arasına indirir', () => {
    expect(TRUCK_MODELS['rt-2500-narrow'].b4 as number).toBeLessThan(0.8)
    for (const id of ['rt-1800', 'rt-2000', 'rt-2500'] as const) {
      expect(TRUCK_MODELS[id].b4 as number).toBeGreaterThan(0.8)
    }
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

  test('mast tablo kümeleri: rt-2500-narrow yalnız A, rt-1800 A+B, rt-2000/rt-2500 A+B+C', () => {
    expect(TRUCK_MODELS['rt-2500-narrow'].mastTables).toEqual(['reach-a'])
    expect(TRUCK_MODELS['rt-1800'].mastTables).toEqual(['reach-a', 'reach-b'])
    expect(TRUCK_MODELS['rt-2000'].mastTables).toEqual(['reach-a', 'reach-b', 'reach-c'])
    expect(TRUCK_MODELS['rt-2500'].mastTables).toEqual(['reach-a', 'reach-b', 'reach-c'])
  })

  test("rezidüel kapasite yalnız reach'te yayınlanmamış", () => {
    for (const m of ALL) {
      expect(m.residualCapacityPublished, m.id).toBe(m.variant !== 'reach')
    }
  })

  test('dönüş pivotu: forklift y + 0.190 (Wa ile teyitli), reach 0.210 + y, transpaletlerde yok', () => {
    for (const m of modelsOf('forklift')) {
      expect((m.waPivotFromRear as number) - m.y).toBeCloseTo(0.19, 9)
    }
    for (const m of modelsOf('reach')) {
      expect((m.waPivotFromRear as number) - m.y).toBeCloseTo(0.21, 9)
    }
    for (const m of [...modelsOf('hand-pallet'), ...modelsOf('powered-pallet')]) {
      expect(m.waPivotFromRear).toBeNull()
    }
  })

  test('tt-1600: pivot z + y yayınlanmış Wa ile tam örtüşür — ailenin tek doğrulama noktası', () => {
    const m = TRUCK_MODELS['tt-1600']
    expect(m.waPivotFromRear).toBeCloseTo(m.Wa as number, 9)
  })

  test('mpt Ast/Wa yalnız standart varyantta', () => {
    expect(TRUCK_MODELS['mpt-520x1150'].ast).not.toBeNull()
    expect(TRUCK_MODELS['mpt-520x1150'].Wa).not.toBeNull()
    for (const id of ['mpt-520x950', 'mpt-520x795', 'mpt-680x1150'] as const) {
      expect(TRUCK_MODELS[id].ast).toBeNull()
      expect(TRUCK_MODELS[id].Wa).toBeNull()
    }
  })
})
