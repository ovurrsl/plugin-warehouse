import { describe, expect, test } from 'bun:test'
import { boxesOverlap, occupiedVolumes, toWorldBox } from '../clash'
import { PalletRackNode } from '../rack/schema'
import { resolveTierElevations } from './metrics'
import {
  overloadedRacks,
  rackDeclaredLoadKg,
  rackFootprintM2,
  racksOnMezzanine,
  tierLoadSummary,
} from './rack-support'
import { emptyAccessories, MezzanineNode } from './schema'

const mezzanine = (patch: Record<string, unknown> = {}) =>
  MezzanineNode.parse({
    position: [0, 0, 0],
    grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
    tiers: [
      {
        index: 0,
        elevationM: 'auto',
        clearHeightM: 3,
        loadClass: 500,
        floorType: 'WOOD_CHIPBOARD_30',
        accessories: emptyAccessories(),
      },
    ],
    ...patch,
  })

/** Bir tier'in yürüme yüzeyi — rafın "üstünde durması" için gereken kot. */
function deckTop(node: ReturnType<typeof mezzanine>, tierIndex = 0): number {
  const tier = resolveTierElevations(node.tiers)[tierIndex]
  if (!tier) throw new Error('tier yok')
  return tier.deckTopM
}

const rackAt = (x: number, y: number, z: number, patch: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ position: [x, y, z], ...patch })

describe('mezzanine üstündeki rafları bulmak', () => {
  test('döşemede duran raf sayılır', () => {
    const mezz = mezzanine()
    const rack = rackAt(0, deckTop(mezz), 0)
    const found = racksOnMezzanine({ 'rack-1': rack }, mezz)
    expect(found).toHaveLength(1)
    expect(found[0]?.tierIndex).toBe(0)
  })

  test('mezzanine ALTINDA duran raf sayılmaz — orası zaten rafa açık hacim', () => {
    const mezz = mezzanine()
    const rack = rackAt(0, 0, 0)
    expect(racksOnMezzanine({ 'rack-1': rack }, mezz)).toHaveLength(0)
  })

  test('taban izinin dışındaki raf sayılmaz', () => {
    const mezz = mezzanine()
    // Taban izi 20×15; x=50 açıkça dışarıda.
    const rack = rackAt(50, deckTop(mezz), 0)
    expect(racksOnMezzanine({ 'rack-1': rack }, mezz)).toHaveLength(0)
  })

  test('döndürülmüş mezzanine: raf YEREL çerçevede sınanır', () => {
    // 90° döndürülmüş: taban izi dünyada 15×20 olur. Yerelde (9, 0)
    // içeride (halfWidth 10); dünyada bu (0, −9) noktasına düşer.
    const mezz = mezzanine({ rotation: [0, Math.PI / 2, 0] })
    const inside = rackAt(0, deckTop(mezz), -9)
    expect(racksOnMezzanine({ r: inside }, mezz)).toHaveLength(1)
    // Yerel X=9 dünyada z=−9; dünya x=9 ise yerel z=9 > halfDepth(7.5) → dışarıda.
    const outside = rackAt(9, deckTop(mezz), 0)
    expect(racksOnMezzanine({ r: outside }, mezz)).toHaveLength(0)
  })

  test('sahnedeki raf olmayan düğümler yok sayılır', () => {
    const mezz = mezzanine()
    expect(racksOnMezzanine({ x: { type: 'warehouse:pallet' }, y: null }, mezz)).toHaveLength(0)
  })
})

describe('yük sınıfı — oran, FEM değil', () => {
  test('beyan edilen yük = kat kapasitesi × var olan kat sayısı', () => {
    const rack = rackAt(0, 0, 0, { levelCapacity: 3000, levels: 3 })
    // Varsayılan `groundLevelStorage: true` zemini de bir kat sayar.
    expect(rackDeclaredLoadKg(rack)).toBe(3000 * 4)
  })

  test('taban izi = göz adımı × derinlik', () => {
    const rack = rackAt(0, 0, 0)
    expect(rackFootprintM2(rack)).toBeCloseTo((2.7 + 0.122) * 1.1, 9)
  })

  test('hafif raf sınırı aşmaz', () => {
    const mezz = mezzanine()
    const rack = rackAt(0, deckTop(mezz), 0, { levelCapacity: 200, levels: 1 })
    const found = racksOnMezzanine({ r: rack }, mezz)
    expect(overloadedRacks(found)).toHaveLength(0)
  })

  test('ağır raf aşar ve uyarı üretir', () => {
    const mezz = mezzanine()
    // 500 kg/m² × ~3.1 m² ≈ 1552 kg izin; 4 kat × 3000 kg = 12000 kg beyan.
    const rack = rackAt(0, deckTop(mezz), 0, { levelCapacity: 3000, levels: 3 })
    const found = racksOnMezzanine({ r: rack }, mezz)
    expect(overloadedRacks(found)).toHaveLength(1)
  })

  test('yük sınıfını yükseltmek aşımı kaldırabilir', () => {
    const heavy = mezzanine({
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 1000,
          floorType: 'METAL_GRID',
          accessories: emptyAccessories(),
        },
      ],
    })
    const light = mezzanine()
    const rack = (m: ReturnType<typeof mezzanine>) =>
      rackAt(0, deckTop(m), 0, { levelCapacity: 900, levels: 1 })
    expect(overloadedRacks(racksOnMezzanine({ r: rack(light) }, light))).toHaveLength(1)
    expect(overloadedRacks(racksOnMezzanine({ r: rack(heavy) }, heavy))).toHaveLength(0)
  })

  test('tier özeti rafları toplar', () => {
    const mezz = mezzanine()
    const y = deckTop(mezz)
    const found = racksOnMezzanine(
      {
        a: rackAt(-3, y, 0, { levelCapacity: 1000, levels: 1 }),
        b: rackAt(3, y, 0, { levelCapacity: 1000, levels: 1 }),
      },
      mezz,
    )
    const summary = tierLoadSummary(found, 0)
    expect(summary.count).toBe(2)
    expect(summary.declaredKg).toBe(4000)
  })
})

describe('çakışma: mezzanine altı AÇIK kalır', () => {
  /** Dünya çerçevesinde bir sonda kutusu — `toWorldBox`'ın kendisiyle
   *  kurulur, elle `ClashBox` yazmak alanları uydurmak demek. */
  const probe = (center: [number, number, number], size: [number, number, number]) =>
    toWorldBox(center, size, [0, 0, 0], 0)

  test('altındaki hacim boş — bir raf oraya girebilir', () => {
    const mezz = mezzanine()
    const volumes = occupiedVolumes(mezz)
    // Göz ortası (kolon ızgarası ±10/±5/0 × ±7.5/±2.5), zeminden 1 m
    // yukarısı: hiçbir kolonun/kirişin içinde değil.
    expect(volumes.some((box) => boxesOverlap(box, probe([2.5, 1, 0], [0.4, 0.4, 0.4])))).toBe(
      false,
    )
  })

  test('kolonun içi DOLU — oraya bir şey konamaz', () => {
    const mezz = mezzanine()
    const volumes = occupiedVolumes(mezz)
    // Köşe kolonu: taban izi 20×15 → (−10, −7.5).
    expect(volumes.some((box) => boxesOverlap(box, probe([-10, 1, -7.5], [0.4, 0.4, 0.4])))).toBe(
      true,
    )
  })

  test('döşeme kotu dolu — üstüne konan şey döşemeye oturur, içine değil', () => {
    const mezz = mezzanine()
    const volumes = occupiedVolumes(mezz)
    const y = deckTop(mezz)
    expect(
      volumes.some((box) => boxesOverlap(box, probe([2.5, y - 0.015, 0], [0.4, 0.02, 0.4]))),
    ).toBe(true)
  })
})
