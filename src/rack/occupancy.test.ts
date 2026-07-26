import { beforeEach, describe, expect, test } from 'bun:test'
import { occupiedSlots, resetOccupancyIndex, slotDraw } from './occupancy'
import { PalletRackNode } from './schema'
import { palletSlotsOf } from './slots'

const rack = (id: string, overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: `pallet_rack_${id}`, levels: 3, uprightHeight: 6, ...overrides })

const pallet = (id: string, rackId: string, address: string) => ({
  id,
  type: 'warehouse:pallet',
  slotRackId: rackId,
  slotAddress: address,
})

/** The store hands out a fresh `nodes` object on every write, and both indexes
 *  are memoised on its identity — so each case needs its own object. */
const scene = (...nodes: Array<{ id: string } & Record<string, unknown>>) =>
  Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, unknown>

describe('a slot address only means something inside its own rack', () => {
  beforeEach(() => resetOccupancyIndex())

  test('two bays holding the same address do not occupy each other', () => {
    // Every bay is a node now, so every bay emits `R1-B1-L1-P1-D1`. Addresses
    // stopped being globally unique the day a block became a line of nodes; the
    // index has to be scoped by rack id or a pallet in one bay would blank the
    // ghost in every other bay of the run.
    const a = rack('a')
    const b = rack('b')
    const nodes = scene(a, b, pallet('pallet_1', a.id, 'R1-B1-L1-P1-D1'))

    expect(occupiedSlots(nodes, a.id).has('R1-B1-L1-P1-D1')).toBe(true)
    expect(occupiedSlots(nodes, b.id).has('R1-B1-L1-P1-D1')).toBe(false)
  })

  test('a pallet missing either half of its attribution is skipped, not guessed', () => {
    const a = rack('a')
    const nodes = scene(
      a,
      { id: 'pallet_1', type: 'warehouse:pallet', slotRackId: a.id },
      { id: 'pallet_2', type: 'warehouse:pallet', slotAddress: 'R1-B1-L1-P1-D1' },
    )
    expect(occupiedSlots(nodes, a.id).size).toBe(0)
  })
})

describe('illustrative fill', () => {
  test('two bays of a run do not fill the same slots', () => {
    // The regression this exists for: `slotDraw` hashed the address alone, and
    // every bay emits the same addresses, so a twenty-bay run at 30% fill
    // stocked the identical three slots twenty times over — a repeating pattern
    // no warehouse has ever had.
    const a = rack('a')
    const b = rack('b', { position: [2.822, 0, 0] })
    const filled = (node: typeof a) =>
      palletSlotsOf(node)
        .filter((slot) => slotDraw(node.id, slot.id) < 0.4)
        .map((slot) => slot.id)

    const left = filled(a)
    const right = filled(b)
    expect(left.length).toBeGreaterThan(0)
    expect(right.length).toBeGreaterThan(0)
    expect(left).not.toEqual(right)
  })

  test('the draw is stable for one bay and one slot', () => {
    // It has to be, or the fill would reshuffle on every render.
    const first = slotDraw('pallet_rack_a', 'R1-B1-L1-P1-D1')
    expect(slotDraw('pallet_rack_a', 'R1-B1-L1-P1-D1')).toBe(first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(1)
  })

  test('the fill is progressive: raising the fraction only adds', () => {
    // What makes the control usable — a rack visibly fills instead of redealing
    // into a new arrangement every time the slider moves.
    const node = rack('a')
    const at = (fraction: number) =>
      new Set(
        palletSlotsOf(node)
          .filter((slot) => slotDraw(node.id, slot.id) < fraction)
          .map((slot) => slot.id),
      )
    const third = at(0.3)
    const half = at(0.5)
    for (const id of third) expect(half.has(id)).toBe(true)
  })

  test('the id and the address cannot be confused for one another', () => {
    // Fed as one stream, `ab` + `c` and `a` + `bc` would collide. The separator
    // is what stops two different bays from ever agreeing by accident.
    expect(slotDraw('ab', 'c')).not.toBe(slotDraw('a', 'bc'))
  })
})
