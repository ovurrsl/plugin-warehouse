import { beforeEach, describe, expect, test } from 'bun:test'
import { hasRightNeighbour, resetNeighbourIndex, rightNeighbourPosition } from './neighbours'
import { PalletRackNode } from './schema'
import { bayPitch } from './slots'

const rack = (id: string, overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: `pallet_rack_${id}`, ...overrides })

/** The store hands out a fresh `nodes` object on every write, and the index is
 *  memoised on its identity — so every case here needs its own object or it
 *  would silently read the previous case's answer. */
const scene = (...nodes: ReturnType<typeof rack>[]) =>
  Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, unknown>

const PITCH = bayPitch(rack('probe'))

describe('a bay leaves its right frame to whatever stands against it', () => {
  beforeEach(() => resetNeighbourIndex())

  test('two bays one pitch apart: the left one defers, the right one closes', () => {
    const left = rack('a', { position: [0, 0, 0] })
    const right = rack('b', { position: [PITCH, 0, 0] })
    const nodes = scene(left, right)
    expect(hasRightNeighbour(nodes, left.id)).toBe(true)
    // Nothing is against the far end, so the run gets its closing frame.
    expect(hasRightNeighbour(nodes, right.id)).toBe(false)
  })

  test('a bay dragged clear grows its own frame back', () => {
    const left = rack('a', { position: [0, 0, 0] })
    const moved = rack('b', { position: [PITCH + 0.4, 0, 0] })
    expect(hasRightNeighbour(scene(left, moved), left.id)).toBe(false)
  })

  test('a millimetre of float drift still counts as abutting', () => {
    // Positions come from grid snapping and alignment pulls, which agree to far
    // better than this. The tolerance is for float drift, not for "close enough
    // to look joined" — 0.4 m above is refused, 0.1 mm here is accepted.
    const left = rack('a', { position: [0, 0, 0] })
    const right = rack('b', { position: [PITCH + 1e-4, 0, 1e-4] })
    expect(hasRightNeighbour(scene(left, right), left.id)).toBe(true)
  })

  test('the neighbour is found along the rotated local +X, not world +X', () => {
    // A run turned 90° puts its next bay on −Z. Reading world +X instead would
    // make every rotated run draw double posts at every seam.
    const angle = Math.PI / 2
    const first = rack('a', { position: [0, 0, 0], rotation: [0, angle, 0] })
    const [x, z] = rightNeighbourPosition(first)
    expect(x).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(-PITCH, 9)

    const second = rack('b', { position: [x, 0, z], rotation: [0, angle, 0] })
    expect(hasRightNeighbour(scene(first, second), first.id)).toBe(true)
  })

  test('bays facing different ways do not share a frame', () => {
    // Their posts genuinely do not coincide, so omitting one would open a gap in
    // the steel rather than tidy a duplicate away.
    const first = rack('a', { position: [0, 0, 0] })
    const turned = rack('b', { position: [PITCH, 0, 0], rotation: [0, Math.PI / 4, 0] })
    expect(hasRightNeighbour(scene(first, turned), first.id)).toBe(false)
  })

  test('a neighbour of a different section or depth does not share a frame', () => {
    const first = rack('a', { position: [0, 0, 0] })
    for (const departure of [{ uprightWidth: 0.101 }, { depth: 2.4 }, { depthPositions: 2 }]) {
      resetNeighbourIndex()
      const other = rack('b', { position: [PITCH, 0, 0], ...departure })
      expect({ departure, shared: hasRightNeighbour(scene(first, other), first.id) }).toEqual({
        departure,
        shared: false,
      })
    }
  })

  test('a wider bay looks one of its own pitches along, not the default', () => {
    const wide = { bayClearWidth: 3.6 }
    const first = rack('a', { position: [0, 0, 0], ...wide })
    const pitch = bayPitch(first)
    expect(pitch).not.toBeCloseTo(PITCH, 3)
    const second = rack('b', { position: [pitch, 0, 0], ...wide })
    expect(hasRightNeighbour(scene(first, second), first.id)).toBe(true)
  })

  test('a lone bay, and a non-rack sitting where a neighbour would be', () => {
    const lone = rack('a', { position: [0, 0, 0] })
    expect(hasRightNeighbour(scene(lone), lone.id)).toBe(false)

    resetNeighbourIndex()
    const nodes = {
      ...scene(lone),
      pallet_x: { id: 'pallet_x', type: 'warehouse:pallet', position: [PITCH, 0, 0] },
    } as Record<string, unknown>
    expect(hasRightNeighbour(nodes, lone.id)).toBe(false)
  })

  test('a full turn is the same orientation as none', () => {
    // The host's rotate affordance accumulates rather than wrapping, so a bay
    // turned eight times by 45° really does sit at 2π. Quantising the raw angle
    // made it a different shape from its neighbour at 0 and opened a gap in the
    // steel that nothing explained.
    const first = rack('a', { position: [0, 0, 0], rotation: [0, 0, 0] })
    const wrapped = rack('b', { position: [PITCH, 0, 0], rotation: [0, Math.PI * 2, 0] })
    expect(hasRightNeighbour(scene(first, wrapped), first.id)).toBe(true)

    resetNeighbourIndex()
    const negative = rack('c', { position: [0, 0, 0], rotation: [0, -Math.PI * 2, 0] })
    expect(hasRightNeighbour(scene(negative, wrapped), negative.id)).toBe(true)
  })

  test('a bay never reports itself as its own neighbour', () => {
    // Unreachable while `bayClearWidth` has a minimum, and guarded anyway: a bay
    // that did would delete its right frame with nothing to say why.
    const lone = rack('a', { position: [0, 0, 0] })
    expect(hasRightNeighbour(scene(lone), lone.id)).toBe(false)
  })

  test('a twenty-bay run stands on twenty-one frames', () => {
    // The headline claim, counted rather than asserted: nineteen bays defer,
    // the last one closes.
    const run = Array.from({ length: 20 }, (_, index) =>
      rack(`b${index}`, { position: [index * PITCH, 0, 0] }),
    )
    const nodes = scene(...run)
    const deferring = run.filter((bay) => hasRightNeighbour(nodes, bay.id)).length
    expect(deferring).toBe(19)
    // 19 bays x 1 frame + 1 bay x 2 frames.
    expect(deferring + (run.length - deferring) * 2).toBe(21)
  })

  test('the index is rebuilt when the store hands out a new nodes object', () => {
    // The memo is keyed on object identity because the store replaces `nodes` on
    // every write. Keyed on anything coarser, a bay dragged away would keep
    // reporting a neighbour it no longer has.
    const left = rack('a', { position: [0, 0, 0] })
    const right = rack('b', { position: [PITCH, 0, 0] })
    expect(hasRightNeighbour(scene(left, right), left.id)).toBe(true)
    const moved = rack('b', { position: [PITCH + 2, 0, 0] })
    expect(hasRightNeighbour(scene(left, moved), left.id)).toBe(false)
  })
})
