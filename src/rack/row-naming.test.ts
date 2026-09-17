import { describe, expect, test } from 'bun:test'
import {
  alignBackToBackBays,
  computeBayIndex,
  getContiguousRackRow,
  getEndRackStatus,
  isFirstRackOfRow,
  isLastRackOfRow,
  normalizeAngle,
  parseAislePairInput,
} from './row-naming'
import { PalletRackNode } from './schema'
import { bayPitch } from './slots'

const makeRack = (id: string, overrides: Record<string, unknown> = {}): PalletRackNode =>
  PalletRackNode.parse({
    id: `pallet_rack_${id}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    rowLabel: 'A1',
    ...overrides,
  })

describe('H1: row-naming loop prevention and termination guarantees', () => {
  test('circular / cyclic rack graph terminates in < 1ms without infinite loop', () => {
    // Construct two racks where left neighbor of A is B, and left neighbor of B is A
    // In unvalidated scene data or back-to-back/cyclic graph, pitch directions can create mutual left dependencies
    const rLoopA = {
      id: 'pallet_rack_loop_a',
      type: 'warehouse:pallet-rack',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      bayClearWidth: 1.0,
      uprightWidth: 0.1, // pitch = 1.1, left is [-1.1, 0]
    }
    const rLoopB = {
      id: 'pallet_rack_loop_b',
      type: 'warehouse:pallet-rack',
      position: [-1.1, 0, 0],
      rotation: [0, 0, 0],
      bayClearWidth: -1.2,
      uprightWidth: 0.1, // pitch = -1.1, left is [-1.1 - (-1.1), 0] = [0, 0]
    }

    const nodes = {
      [rLoopA.id]: rLoopA,
      [rLoopB.id]: rLoopB,
    }

    const start = performance.now()
    const row = getContiguousRackRow(nodes, rLoopA.id)
    const elapsed = performance.now() - start

    // Must terminate almost instantaneously (< 10ms bound for CI)
    expect(elapsed).toBeLessThan(10)
    expect(Array.isArray(row)).toBe(true)
    expect(row.length).toBeGreaterThanOrEqual(1)
  })

  test('linear 3-rack row traversal returns nodes in correct left-to-right order', () => {
    const proto = makeRack('proto')
    const pitch = bayPitch(proto)

    const r1 = makeRack('lin_1', { position: [0, 0, 0] })
    const r2 = makeRack('lin_2', { position: [pitch, 0, 0] })
    const r3 = makeRack('lin_3', { position: [pitch * 2, 0, 0] })

    const nodes = {
      [r1.id]: r1,
      [r2.id]: r2,
      [r3.id]: r3,
    }

    // Starting from middle rack r2:
    const rowFromMid = getContiguousRackRow(nodes, r2.id)
    expect(rowFromMid).toEqual([r1.id, r2.id, r3.id])

    // Starting from end rack r3:
    const rowFromEnd = getContiguousRackRow(nodes, r3.id)
    expect(rowFromEnd).toEqual([r1.id, r2.id, r3.id])

    expect(isFirstRackOfRow(nodes, r1.id)).toBe(true)
    expect(isFirstRackOfRow(nodes, r2.id)).toBe(false)
    expect(isFirstRackOfRow(nodes, r3.id)).toBe(false)

    expect(isLastRackOfRow(nodes, r1.id)).toBe(false)
    expect(isLastRackOfRow(nodes, r2.id)).toBe(false)
    expect(isLastRackOfRow(nodes, r3.id)).toBe(true)
  })

  test('isolated single rack returns 1-element row', () => {
    const single = makeRack('single', { position: [50, 0, 50] })
    const nodes = { [single.id]: single }

    const row = getContiguousRackRow(nodes, single.id)
    expect(row).toEqual([single.id])
    expect(isFirstRackOfRow(nodes, single.id)).toBe(true)
    expect(isLastRackOfRow(nodes, single.id)).toBe(true)
  })
})

describe('M1: Bay Sequencing & Naming Strategies', () => {
  test('computeBayIndex computes correct indices for all sequence modes', () => {
    // Sequential: 1, 2, 3, 4, 5
    expect([0, 1, 2, 3, 4].map((i) => computeBayIndex(i, 'sequential'))).toEqual([1, 2, 3, 4, 5])
    // Odd: 1, 3, 5, 7, 9
    expect([0, 1, 2, 3, 4].map((i) => computeBayIndex(i, 'odd'))).toEqual([1, 3, 5, 7, 9])
    // Even: 2, 4, 6, 8, 10
    expect([0, 1, 2, 3, 4].map((i) => computeBayIndex(i, 'even'))).toEqual([2, 4, 6, 8, 10])
  })

  test('parseAislePairInput parses standard aisle pairs and formats', () => {
    expect(parseAislePairInput('A B')).toEqual({
      frontAisle: 'A',
      rearAisle: 'B',
      signDisplay: 'A B',
    })
    expect(parseAislePairInput('C/D')).toEqual({
      frontAisle: 'C',
      rearAisle: 'D',
      signDisplay: 'C D',
    })
    expect(parseAislePairInput('E - F')).toEqual({
      frontAisle: 'E',
      rearAisle: 'F',
      signDisplay: 'E F',
    })
    // Single aisle input derives next consecutive letter
    expect(parseAislePairInput('A')).toEqual({
      frontAisle: 'A',
      rearAisle: 'B',
      signDisplay: 'A B',
    })
  })

  test('normalizeAngle normalizes angles across full revolution bounds', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 5)
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0, 5)
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 5)
  })

  test('angle normalization enables neighbour discovery when rotation differs by 2*PI', () => {
    const proto = makeRack('norm_proto')
    const pitch = bayPitch(proto)

    const r1 = makeRack('norm_1', { position: [0, 0, 0], rotation: [0, 0, 0] })
    const r2 = makeRack('norm_2', { position: [pitch, 0, 0], rotation: [0, Math.PI * 2, 0] })

    const nodes = {
      [r1.id]: r1,
      [r2.id]: r2,
    }

    const row = getContiguousRackRow(nodes, r1.id)
    expect(row).toEqual([r1.id, r2.id])
  })

  test('getEndRackStatus returns both isFirst and isLast in single traversal', () => {
    const proto = makeRack('status_proto')
    const pitch = bayPitch(proto)

    const r1 = makeRack('stat_1', { position: [0, 0, 0] })
    const r2 = makeRack('stat_2', { position: [pitch, 0, 0] })
    const r3 = makeRack('stat_3', { position: [pitch * 2, 0, 0] })

    const nodes = {
      [r1.id]: r1,
      [r2.id]: r2,
      [r3.id]: r3,
    }

    expect(getEndRackStatus(nodes, r1.id)).toEqual({ isFirst: true, isLast: false })
    expect(getEndRackStatus(nodes, r2.id)).toEqual({ isFirst: false, isLast: false })
    expect(getEndRackStatus(nodes, r3.id)).toEqual({ isFirst: false, isLast: true })
  })

  test('alignBackToBackBays sorts row 2 collinear with row 1 cross-aisle origin', () => {
    const proto = makeRack('align_proto')
    const pitch = bayPitch(proto)

    // Row 1 along local +X (from 0 to pitch * 2)
    const r1_1 = makeRack('r1_1', { position: [0, 0, 0] })
    const r1_2 = makeRack('r1_2', { position: [pitch, 0, 0] })
    const r1_3 = makeRack('r1_3', { position: [pitch * 2, 0, 0] })

    // Row 2 placed back to back, rotated 180° so its bays are at x = 0, pitch, 2*pitch
    const r2_1 = makeRack('r2_1', { position: [pitch * 2, 0, -1.3], rotation: [0, Math.PI, 0] })
    const r2_2 = makeRack('r2_2', { position: [pitch, 0, -1.3], rotation: [0, Math.PI, 0] })
    const r2_3 = makeRack('r2_3', { position: [0, 0, -1.3], rotation: [0, Math.PI, 0] })

    const nodes = {
      [r1_1.id]: r1_1,
      [r1_2.id]: r1_2,
      [r1_3.id]: r1_3,
      [r2_1.id]: r2_1,
      [r2_2.id]: r2_2,
      [r2_3.id]: r2_3,
    }

    const { alignedRow1, alignedRow2 } = alignBackToBackBays(
      nodes,
      [r1_1.id, r1_2.id, r1_3.id],
      [r2_1.id, r2_2.id, r2_3.id]
    )

    expect(alignedRow1).toEqual([r1_1.id, r1_2.id, r1_3.id])
    // Sorted along Row 1's axis so x=0 is first (r2_3)
    expect(alignedRow2).toEqual([r2_3.id, r2_2.id, r2_1.id])
  })

  describe('Adversarial Regression: Y Elevation & Slab Isolation Tests', () => {
    test('Y elevation isolation prevents cross-floor collision and bridging between ground and mezzanine racks', () => {
      const proto = makeRack('elev_proto')
      const pitch = bayPitch(proto)
      const g1 = makeRack('elev_g1', { position: [0, 0, 0] })
      const g2 = makeRack('elev_g2', { position: [pitch, 0, 0] })
      const m1 = makeRack('elev_m1', { position: [0, 3.5, 0] })
      const m2 = makeRack('elev_m2', { position: [pitch, 3.5, 0] })

      const sceneNodes = {
        [g1.id]: g1,
        [g2.id]: g2,
        [m1.id]: m1,
        [m2.id]: m2,
      }

      expect(getContiguousRackRow(sceneNodes, g1.id)).toEqual([g1.id, g2.id])
      expect(getContiguousRackRow(sceneNodes, g2.id)).toEqual([g1.id, g2.id])
      expect(getContiguousRackRow(sceneNodes, m1.id)).toEqual([m1.id, m2.id])
      expect(getContiguousRackRow(sceneNodes, m2.id)).toEqual([m1.id, m2.id])
    })

    test('supportSlabId isolation prevents bridging across slabs even if elevation matches', () => {
      const proto = makeRack('slab_proto')
      const pitch = bayPitch(proto)
      const r1 = makeRack('slab_r1', {
        position: [0, 3.5, 0],
        supportSlabId: 'slab_1',
      })
      const r2 = makeRack('slab_r2', {
        position: [pitch, 3.5, 0],
        supportSlabId: 'slab_2',
      })

      const sceneNodes = {
        [r1.id]: r1,
        [r2.id]: r2,
      }

      expect(getContiguousRackRow(sceneNodes, r1.id)).toEqual([r1.id])
      expect(getContiguousRackRow(sceneNodes, r2.id)).toEqual([r2.id])
    })
  })
})

