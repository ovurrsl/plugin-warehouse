import { describe, expect, test } from 'bun:test'
import {
  getContiguousRackRow,
  isFirstRackOfRow,
  isLastRackOfRow,
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
