import { describe, expect, test } from 'bun:test'
import {
  bayOffsets,
  DEFAULT_MULTIPLY,
  localToWorld,
  type MultiplySpec,
  multiplyPlacements,
  rowOffsets,
  runExtent,
} from './multiply'
import { hasRightNeighbour, resetNeighbourIndex } from './neighbours'
import { PalletRackNode } from './schema'
import { bayPitch, rowDepth } from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_mul', ...overrides })

const spec = (overrides: Partial<MultiplySpec> = {}): MultiplySpec => ({
  ...DEFAULT_MULTIPLY,
  ...overrides,
})

describe('laying a run down from one bay', () => {
  test('the source is never in the list', () => {
    // Multiplying must not move or duplicate the bay the user placed and
    // aligned. Twenty bays means nineteen new nodes.
    const r = rack()
    expect(multiplyPlacements(r, spec({ bays: 1 }))).toHaveLength(0)
    expect(multiplyPlacements(r, spec({ bays: 20 }))).toHaveLength(19)
    expect(multiplyPlacements(r, spec({ bays: 4, rows: 3 }))).toHaveLength(11)
  })

  test('bays step by exactly one pitch, so every seam shares a post', () => {
    const r = rack()
    const offsets = bayOffsets(r, 5)
    expect(offsets).toHaveLength(5)
    expect(offsets[0]).toBe(0)
    for (let index = 1; index < offsets.length; index++) {
      expect((offsets[index] ?? 0) - (offsets[index - 1] ?? 0)).toBeCloseTo(bayPitch(r), 12)
    }
  })

  test('the run the panel places is a run the neighbour index recognises', () => {
    // The two halves of the shared-frame story meet here: `multiply` decides
    // where the bays go and `neighbours` decides which frames they build. If the
    // pitch ever drifts between the two, every seam quietly grows a second post.
    resetNeighbourIndex()
    const source = rack({ position: [4, 0, -2] })
    const nodes: Record<string, unknown> = { [source.id]: source }
    multiplyPlacements(source, spec({ bays: 6 })).forEach((placement, index) => {
      const id = `pallet_rack_s${index}`
      nodes[id] = { ...source, id, position: placement.position, rotation: placement.rotation }
    })

    const deferring = Object.values(nodes).filter((node) =>
      hasRightNeighbour(nodes, (node as { id: string }).id),
    )
    expect(deferring).toHaveLength(5)
  })

  test('rows march along local −Z, behind the aisle the first run faces', () => {
    const r = rack({ depth: 1.1 })
    const rows = rowOffsets(r, spec({ rows: 3, aisleWidth: 3.2 }))
    expect(rows.map((row) => row.z)).toEqual([0, -(1.1 + 3.2), -2 * (1.1 + 3.2)])
    expect(rows.every((row) => !row.flipped)).toBe(true)
  })

  test('back to back pairs the rows and turns the second one round', () => {
    // Spine, aisle, spine — and the flip, which is what makes back to back mean
    // "two runs on opposite aisles" rather than "one run with a gap in it".
    const r = rack({ depth: 1.1 })
    const rows = rowOffsets(r, spec({ rows: 4, backToBack: true, backToBackGap: 0.2 }))
    const gaps = rows.slice(1).map((row, index) => (rows[index]?.z ?? 0) - row.z - rowDepth(r))
    expect(gaps[0]).toBeCloseTo(0.2, 9)
    expect(gaps[1]).toBeCloseTo(3.2, 9)
    expect(gaps[2]).toBeCloseTo(0.2, 9)
    expect(rows.map((row) => row.flipped)).toEqual([false, true, false, true])
  })

  test('a flipped row is turned by half a turn, and nothing else is', () => {
    const r = rack({ rotation: [0, Math.PI / 6, 0] })
    const placed = multiplyPlacements(r, spec({ rows: 2, backToBack: true }))
    expect(placed).toHaveLength(1)
    expect(placed[0]?.rotation[1]).toBeCloseTo(Math.PI / 6 + Math.PI, 9)

    const unpaired = multiplyPlacements(r, spec({ rows: 2 }))
    expect(unpaired[0]?.rotation[1]).toBeCloseTo(Math.PI / 6, 9)
  })

  test('local +X carries onto world (cos, −sin) — the sign that lays a run mirrored', () => {
    // The same convention `neighbours.rightNeighbourPosition` uses. Getting it
    // backwards looks correct at 0° and lays the run the wrong way at 90°.
    const r = rack({ position: [10, 0, 5], rotation: [0, Math.PI / 2, 0] })
    const [x, y, z] = localToWorld(r, 3, 0)
    expect(x).toBeCloseTo(10, 9)
    expect(y).toBe(0)
    expect(z).toBeCloseTo(5 - 3, 9)

    const [bx, , bz] = localToWorld(r, 0, 3)
    expect(bx).toBeCloseTo(13, 9)
    expect(bz).toBeCloseTo(5, 9)
  })

  test('a rotated run places its bays at the same spacing it would unrotated', () => {
    const straight = rack({ position: [0, 0, 0] })
    const turned = rack({ position: [0, 0, 0], rotation: [0, Math.PI / 3, 0] })
    const distance = (placements: ReturnType<typeof multiplyPlacements>) =>
      placements.map((placement) => Math.hypot(placement.position[0], placement.position[2]))
    const expected = distance(multiplyPlacements(straight, spec({ bays: 4 })))
    const actual = distance(multiplyPlacements(turned, spec({ bays: 4 })))
    expect(actual).toHaveLength(expected.length)
    for (const [index, value] of actual.entries()) {
      expect(value).toBeCloseTo(expected[index] ?? 0, 9)
    }
  })
})

describe('the run extent the box and the panel both read', () => {
  test('width is N pitches plus the closing post', () => {
    // N bays stand on N+1 frames, so the run is longer than N x pitch by exactly
    // one upright. Measuring it as N x pitch leaves the last frame outside the
    // collision box, and the run happily overlaps whatever is at its far end.
    const r = rack()
    for (const bays of [1, 2, 20]) {
      expect(runExtent(r, spec({ bays })).width).toBeCloseTo(bays * bayPitch(r) + r.uprightWidth, 9)
    }
  })

  test('depth covers every row and the gaps between them', () => {
    const r = rack({ depth: 1.1 })
    const extent = runExtent(r, spec({ rows: 4, backToBack: true, backToBackGap: 0.2 }))
    // 4 x 1.1 + 0.2 + 3.2 + 0.2
    expect(extent.depth).toBeCloseTo(8, 9)
  })

  test('the centre is half a run from the source, along +X and −Z', () => {
    // The source bay is an *end* of the run, not its middle — the placement box
    // has to be offset or it sits half off the run it is meant to be checking.
    const r = rack()
    const extent = runExtent(r, spec({ bays: 5, rows: 3 }))
    expect(extent.centerLocal[0]).toBeCloseTo(2 * bayPitch(r), 9)
    expect(extent.centerLocal[1]).toBeLessThan(0)

    const single = runExtent(r, spec())
    expect(single.centerLocal).toEqual([0, 0])
  })

  test('the extent contains every bay the same spec places', () => {
    // One derivation, two consumers, and this is what keeps them honest: the box
    // the tool collides must actually contain the nodes the command creates.
    const r = rack()
    const layout = spec({ bays: 6, rows: 3, backToBack: true })
    const extent = runExtent(r, layout)
    const half: [number, number] = [extent.width / 2, extent.depth / 2]
    const bayHalf: [number, number] = [(r.bayClearWidth + 2 * r.uprightWidth) / 2, rowDepth(r) / 2]

    for (const placement of [{ position: r.position }, ...multiplyPlacements(r, layout)]) {
      const dx = placement.position[0] - extent.centerLocal[0]
      const dz = placement.position[2] - extent.centerLocal[1]
      expect(Math.abs(dx) + bayHalf[0]).toBeLessThanOrEqual(half[0] + 1e-9)
      expect(Math.abs(dz) + bayHalf[1]).toBeLessThanOrEqual(half[1] + 1e-9)
    }
  })
})
