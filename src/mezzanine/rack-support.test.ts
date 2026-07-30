import { describe, expect, test } from 'bun:test'
import { boxesOverlap, occupiedVolumes, toWorldBox } from '../clash'
import { PalletRackNode } from '../rack/schema'
import { deckSlabId } from './deck-slabs'
import { resolveTierElevations } from './metrics'
import {
  overloadedRacks,
  rackDeclaredLoadKg,
  rackFootprintM2,
  racksOnMezzanine,
  tierLoadSummary,
} from './rack-support'
import { emptyAccessories, MezzanineNode } from './schema'

const tier = (patch: Record<string, unknown> = {}) => ({
  index: 0,
  elevationM: 'auto',
  clearHeightM: 3,
  loadClass: 500,
  floorType: 'WOOD_CHIPBOARD_30',
  accessories: emptyAccessories(),
  ...patch,
})

const mezzanine = (patch: Record<string, unknown> = {}) =>
  MezzanineNode.parse({
    id: 'mezzanine_test',
    position: [0, 0, 0],
    grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
    tiers: [tier()],
    ...patch,
  })

/** Bir tier'in yürüme yüzeyi — çakışma testleri hâlâ kotla çalışıyor. */
function deckTop(node: ReturnType<typeof mezzanine>, tierIndex = 0): number {
  const resolved = resolveTierElevations(node.tiers)[tierIndex]
  if (!resolved) throw new Error('tier yok')
  return resolved.deckTopM
}

/**
 * Bir tier'in güvertesine oturmuş raf.
 *
 * Ölçüt artık `supportSlabId`. Eski testler rafı `position[1] = deckTop`
 * ile kuruyordu ve geçiyorlardı — ama editör o durumu ASLA üretemezdi:
 * host güverteye oturan rafın mesh'ini kaldırır, `position[1]` 0 kalır.
 * Yani testler yeşilken özellik ölüydü. Şimdi ölçtükleri şey editörün
 * gerçekten ürettiği şey.
 */
const rackOnDeck = (
  mezz: ReturnType<typeof mezzanine>,
  tierIndex: number,
  patch: Record<string, unknown> = {},
) => PalletRackNode.parse({ supportSlabId: deckSlabId(mezz.id, tierIndex), ...patch })

const rackOnGround = (patch: Record<string, unknown> = {}) => PalletRackNode.parse(patch)

describe('mezzanine üstündeki rafları bulmak', () => {
  test('güvertesine oturan raf sayılır', () => {
    const mezz = mezzanine()
    const found = racksOnMezzanine({ 'rack-1': rackOnDeck(mezz, 0) }, mezz)
    expect(found).toHaveLength(1)
    expect(found[0]?.tierIndex).toBe(0)
  })

  test('mezzanine ALTINDA duran raf sayılmaz — orası zaten rafa açık hacim', () => {
    const mezz = mezzanine()
    expect(racksOnMezzanine({ 'rack-1': rackOnGround() }, mezz)).toHaveLength(0)
  })

  test('başka bir slab üstündeki raf sayılmaz', () => {
    const mezz = mezzanine()
    const rack = PalletRackNode.parse({ supportSlabId: 'slab_zemin' })
    expect(racksOnMezzanine({ r: rack }, mezz)).toHaveLength(0)
  })

  test('BAŞKA bir mezzanine’in güvertesindeki raf bu mezzanine’e sayılmaz', () => {
    const mine = mezzanine()
    const other = mezzanine({ id: 'mezzanine_other' })
    const rack = PalletRackNode.parse({ supportSlabId: deckSlabId(other.id, 0) })
    expect(racksOnMezzanine({ r: rack }, mine)).toHaveLength(0)
    expect(racksOnMezzanine({ r: rack }, other)).toHaveLength(1)
  })

  test('çok katlı mezzanine: raf hangi tier’e oturduysa o sayılır', () => {
    const mezz = mezzanine({
      tiers: [tier(), tier({ index: 1, loadClass: 750, floorType: 'METAL_GRID' })],
    })
    const found = racksOnMezzanine({ r: rackOnDeck(mezz, 1) }, mezz)
    expect(found).toHaveLength(1)
    expect(found[0]?.tierIndex).toBe(1)
    // İzin üst tier'in yük sınıfından gelir, alttakinden değil.
    expect(found[0]?.allowanceKg).toBeCloseTo(750 * (found[0]?.footprintM2 ?? 0), 9)
  })

  test('sahnedeki raf olmayan düğümler yok sayılır', () => {
    const mezz = mezzanine()
    expect(racksOnMezzanine({ x: { type: 'warehouse:pallet' }, y: null }, mezz)).toHaveLength(0)
  })
})

describe('yük sınıfı — oran, FEM değil', () => {
  test('beyan edilen yük = kat kapasitesi × var olan kat sayısı', () => {
    const rack = rackOnGround({ levelCapacity: 3000, levels: 3 })
    // Varsayılan `groundLevelStorage: true` zemini de bir kat sayar.
    expect(rackDeclaredLoadKg(rack)).toBe(3000 * 4)
  })

  test('taban izi = göz adımı × derinlik', () => {
    expect(rackFootprintM2(rackOnGround())).toBeCloseTo((2.7 + 0.122) * 1.1, 9)
  })

  test('hafif raf sınırı aşmaz', () => {
    const mezz = mezzanine()
    const found = racksOnMezzanine(
      { r: rackOnDeck(mezz, 0, { levelCapacity: 200, levels: 1 }) },
      mezz,
    )
    expect(overloadedRacks(found)).toHaveLength(0)
  })

  test('ağır raf aşar ve uyarı üretir', () => {
    const mezz = mezzanine()
    // 500 kg/m² × ~3.1 m² ≈ 1552 kg izin; 4 kat × 3000 kg = 12000 kg beyan.
    const found = racksOnMezzanine(
      { r: rackOnDeck(mezz, 0, { levelCapacity: 3000, levels: 3 }) },
      mezz,
    )
    expect(overloadedRacks(found)).toHaveLength(1)
  })

  test('yük sınıfını yükseltmek aşımı kaldırabilir', () => {
    const heavy = mezzanine({
      tiers: [tier({ loadClass: 1000, floorType: 'METAL_GRID' })],
    })
    const light = mezzanine()
    const rack = (m: ReturnType<typeof mezzanine>) =>
      rackOnDeck(m, 0, { levelCapacity: 900, levels: 1 })
    expect(overloadedRacks(racksOnMezzanine({ r: rack(light) }, light))).toHaveLength(1)
    expect(overloadedRacks(racksOnMezzanine({ r: rack(heavy) }, heavy))).toHaveLength(0)
  })

  test('tier özeti rafları toplar', () => {
    const mezz = mezzanine()
    const found = racksOnMezzanine(
      {
        a: rackOnDeck(mezz, 0, { levelCapacity: 1000, levels: 1 }),
        b: rackOnDeck(mezz, 0, { levelCapacity: 1000, levels: 1 }),
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
