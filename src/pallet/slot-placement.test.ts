import { beforeEach, describe, expect, test } from 'bun:test'
import { resetOccupancyIndex } from '../rack/occupancy'
import { PalletRackNode } from '../rack/schema'
import { palletSlotsOf } from '../rack/slots'
import { LIFT_ALLOWANCE_M } from './cargo-constants'
import { CARTON, cargoHeightM } from './cargo-types'
import { specOf } from './presets'
import { admitsPallet, findSlotTarget, type PalletShape, resetRackIndex } from './slot-placement'

const rack = (patch: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_1', ...patch })

const slotsOf = (node: ReturnType<typeof rack>) =>
  palletSlotsOf(node).filter((slot) => slot.position === 1 && slot.depth === 1)

const CARTONS: PalletShape = { preset: 'epal-1', cargo: 'carton', fillRange: [0.2, 1] }
const EMPTY: ReadonlySet<string> = new Set()

beforeEach(() => {
  resetRackIndex()
  resetOccupancyIndex()
})

describe('the chain refuses before the pallet exists', () => {
  test('a slot that already holds a pallet is refused', () => {
    const node = rack()
    const slot = slotsOf(node)[0]!
    expect(admitsPallet(node, slot, CARTONS, new Set([slot.id]))).toEqual({
      ok: false,
      reason: 'occupied',
    })
  })

  test('a pallet of the wrong standard is refused rather than shrunk', () => {
    // The beams are where they are. A 1200 x 1200 on a bay set out for a Euro
    // pallet overhangs its neighbour whatever the panel says.
    const node = rack()
    const slot = slotsOf(node)[0]!
    expect(admitsPallet(node, slot, { ...CARTONS, preset: 'euro-1200x1200' }, EMPTY)).toEqual({
      ok: false,
      reason: 'footprint',
    })
  })

  test('the top level of a default bay takes no carton load at all', () => {
    // **The chain earning its place.** A schema-default rack clears 340 mm at
    // its top level and the rack inspector deliberately does not warn about it,
    // so the bay counts three pallet positions there. Once the deck and the
    // lift allowance are taken off, 96 mm of headroom remains and the shortest
    // carton variant is 250 — nothing can be stored in a position the capacity
    // figure counts.
    const node = rack()
    const top = slotsOf(node).at(-1)!
    expect(top.clearHeight).toBeCloseTo(0.34, 3)
    expect(admitsPallet(node, top, CARTONS, EMPTY)).toEqual({ ok: false, reason: 'clearance' })
  })

  test('a bare pallet still fits where a loaded one cannot', () => {
    // A refusal has to be about the load, not about the pallet: an empty deck in
    // a short opening is a real thing a warehouse does.
    const node = rack()
    const top = slotsOf(node).at(-1)!
    const verdict = admitsPallet(node, top, { ...CARTONS, cargo: 'none' }, EMPTY)
    expect(verdict.ok).toBe(true)
  })
})

describe('a range that does not fit is narrowed, not thrown away', () => {
  test('a middle level keeps the variants that clear the beam', () => {
    // 1400 mm of opening, less 144 of deck and 100 of lift, is 1156 — so the
    // five-layer 1250 mm load goes and the four-layer 1000 mm one stays.
    const node = rack()
    const middle = slotsOf(node)[1]!
    const verdict = admitsPallet(node, middle, CARTONS, EMPTY)
    expect(verdict).toEqual({ ok: true, range: [0.2, 0.8], clamped: true })
  })

  test('the ground level takes the whole range untouched', () => {
    const node = rack()
    const ground = slotsOf(node)[0]!
    expect(admitsPallet(node, ground, CARTONS, EMPTY)).toEqual({
      ok: true,
      range: [0.2, 1],
      clamped: false,
    })
  })

  test('the surviving range is exactly the variants that fit', () => {
    // Stated independently of the chain, so the two cannot drift together.
    const node = rack()
    for (const slot of slotsOf(node)) {
      const headroom = slot.clearHeight - LIFT_ALLOWANCE_M - specOf('epal-1').height
      const fitting = CARTON.variants.filter((v) => cargoHeightM(CARTON, v) <= headroom)
      const verdict = admitsPallet(node, slot, CARTONS, EMPTY)
      if (fitting.length === 0) {
        expect(verdict).toEqual({ ok: false, reason: 'clearance' })
        continue
      }
      expect(verdict).toEqual({
        ok: true,
        range: [Math.min(...fitting), Math.max(...fitting)],
        clamped: fitting.length !== CARTON.variants.length,
      })
    }
  })

  test('a narrowed range is still a range', () => {
    // Squeezing to one value would fill a whole level with identical loads,
    // which is the look the seeded fill exists to break.
    const node = rack()
    const verdict = admitsPallet(node, slotsOf(node)[1]!, CARTONS, EMPTY)
    if (!verdict.ok) throw new Error('expected admission')
    expect(verdict.range[1]).toBeGreaterThan(verdict.range[0])
  })
})

describe('the cursor finds the slot, and only a slot it would accept', () => {
  const scene = (...nodes: { id: string }[]) =>
    Object.fromEntries(nodes.map((node) => [node.id, node]))

  test('a cursor at a slot snaps to it, at the beam surface', () => {
    const node = rack({ position: [10, 0, 4] })
    const slot = slotsOf(node)[0]!
    const target = findSlotTarget(
      scene({ ...node, parentId: 'level_1' } as never),
      'level_1',
      10 + slot.localPosition[0],
      4 + slot.localPosition[2],
      CARTONS,
    )
    expect(target?.rackId).toBe(node.id)
    expect(target?.address).toBe(slot.id)
    expect(target?.position[1]).toBeCloseTo(slot.localPosition[1], 9)
  })

  test('a rotated bay puts its slots where the rotation says', () => {
    // A quarter turn sends local +X to world −Z. Getting this backwards is the
    // mistake the empty pallet's own markings shipped with, one axis over.
    const turned = rack({ position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] })
    const slot = slotsOf(turned).find((entry) => Math.abs(entry.localPosition[0]) > 0.5)
    if (!slot) throw new Error('expected an off-centre slot')
    const target = findSlotTarget(
      scene({ ...turned, parentId: 'level_1' } as never),
      'level_1',
      slot.localPosition[2],
      -slot.localPosition[0],
      CARTONS,
    )
    expect(target?.address).toBe(slot.id)
  })

  test('a cursor out of reach finds nothing', () => {
    const node = rack({ position: [0, 0, 0] })
    expect(
      findSlotTarget(scene({ ...node, parentId: 'level_1' } as never), 'level_1', 60, 60, CARTONS),
    ).toBeNull()
  })

  test('a full bay falls through to the floor', () => {
    // A snap the chain would then refuse is worse than no snap: the user aims at
    // a slot, the pallet jumps to it, and the click does nothing.
    const node = rack()
    const pallets = palletSlotsOf(node).map((slot, index) => ({
      id: `pallet_${index}`,
      type: 'warehouse:pallet',
      slotRackId: node.id,
      slotAddress: slot.id,
    }))
    const nodes = scene({ ...node, parentId: 'level_1' } as never, ...pallets)
    expect(findSlotTarget(nodes, 'level_1', 0, 0, CARTONS)).toBeNull()
  })

  test('a bay on another level is not offered', () => {
    const node = rack({ position: [0, 0, 0] })
    expect(
      findSlotTarget(scene({ ...node, parentId: 'level_2' } as never), 'level_1', 0, 0, CARTONS),
    ).toBeNull()
  })

  test('the nearest admitting slot wins', () => {
    const node = rack({ position: [0, 0, 0] })
    const slots = slotsOf(node)
    const first = slots[0]!
    const target = findSlotTarget(
      scene({ ...node, parentId: 'level_1' } as never),
      'level_1',
      // Well inside half a slot pitch: further than that and the neighbour is
      // genuinely the nearer one, which is the behaviour rather than a bug.
      first.localPosition[0] + 0.2,
      first.localPosition[2],
      CARTONS,
    )
    expect(target?.address).toBe(first.id)
  })
})
