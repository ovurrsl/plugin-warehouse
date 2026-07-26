import { beforeEach, describe, expect, test } from 'bun:test'
import { resetSeamIndex, snapToNeighbourSeam } from './magnet'
import { hasRightNeighbour, resetNeighbourIndex } from './neighbours'
import { PalletRackNode } from './schema'
import { bayPitch } from './slots'

const rack = (id: string, overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: `pallet_rack_${id}`, ...overrides })

const scene = (...racks: Array<ReturnType<typeof rack>>) =>
  Object.fromEntries(racks.map((r) => [r.id, r])) as Record<string, unknown>

const PITCH = bayPitch(rack('probe'))

describe('a dragged bay clicks into the end of a run', () => {
  beforeEach(() => {
    resetSeamIndex()
    resetNeighbourIndex()
  })

  test('the snapped position is one the neighbour index accepts', () => {
    // The whole contract, in one assertion. A magnet that lands a bay *near* the
    // seam is worse than none: the run looks joined and the frame builder still
    // draws two posts a few centimetres apart, with nothing to say why. What the
    // magnet returns has to be a position `hasRightNeighbour` agrees with, to
    // its own half-millimetre tolerance.
    const standing = rack('a', { position: [0, 0, 0] })
    const dragged = rack('b', { position: [40, 0, 40] })
    const nodes = scene(standing, dragged)

    // Dropped 12 cm short and 7 cm off line — the sort of miss a hand drag
    // actually makes, and well outside the neighbour test's tolerance.
    const snapped = snapToNeighbourSeam(dragged, [PITCH - 0.12, 0, 0.07], [dragged.id], nodes)
    expect(snapped).not.toBeNull()

    const landed = rack('b', { position: snapped as [number, number, number] })
    resetNeighbourIndex()
    expect(hasRightNeighbour(scene(standing, landed), standing.id)).toBe(true)
  })

  test('it pulls to either side of a bay', () => {
    const standing = rack('a', { position: [0, 0, 0] })
    const dragged = rack('b', { position: [40, 0, 40] })
    const nodes = scene(standing, dragged)

    const right = snapToNeighbourSeam(dragged, [PITCH - 0.1, 0, 0], [dragged.id], nodes)
    expect(right?.[0]).toBeCloseTo(PITCH, 9)

    resetSeamIndex()
    const left = snapToNeighbourSeam(dragged, [-PITCH + 0.1, 0, 0], [dragged.id], nodes)
    expect(left?.[0]).toBeCloseTo(-PITCH, 9)
  })

  test('it follows the run when the run is turned', () => {
    // A rotated run's next bay is along its own local +X, not world X. Reading
    // the world axis would magnet onto a seam at right angles to the run and
    // look almost right until you turned the camera.
    const angle = Math.PI / 2
    const standing = rack('a', { position: [5, 0, 5], rotation: [0, angle, 0] })
    const dragged = rack('b', { position: [40, 0, 40], rotation: [0, angle, 0] })
    const nodes = scene(standing, dragged)

    const snapped = snapToNeighbourSeam(dragged, [5.05, 0, 5 - PITCH + 0.1], [dragged.id], nodes)
    expect(snapped?.[0]).toBeCloseTo(5, 9)
    expect(snapped?.[2]).toBeCloseTo(5 - PITCH, 9)

    const landed = rack('b', {
      position: snapped as [number, number, number],
      rotation: [0, angle, 0],
    })
    resetNeighbourIndex()
    expect(hasRightNeighbour(scene(standing, landed), standing.id)).toBe(true)
  })

  test('it lets go outside the magnet radius', () => {
    // Half a metre. A bay being placed in the next aisle must not be dragged
    // back into the run behind it.
    const standing = rack('a', { position: [0, 0, 0] })
    const dragged = rack('b', { position: [40, 0, 40] })
    const nodes = scene(standing, dragged)
    expect(snapToNeighbourSeam(dragged, [PITCH - 0.8, 0, 0], [dragged.id], nodes)).toBeNull()
    expect(snapToNeighbourSeam(dragged, [0, 0, 4], [dragged.id], nodes)).toBeNull()
  })

  test('a bay of a different shape is not pulled onto a seam it cannot share', () => {
    // Same predicate the frame builder uses. A deeper or differently sectioned
    // bay leaves a post that genuinely is not shared, so magnetting it into the
    // seam would produce a joint that only the magnet believes in.
    const standing = rack('a', { position: [0, 0, 0] })
    for (const departure of [{ depth: 2.4 }, { uprightWidth: 0.101 }, { depthPositions: 2 }]) {
      resetSeamIndex()
      const dragged = rack('b', { position: [40, 0, 40], ...departure })
      const nodes = scene(standing, dragged)
      const snapped = snapToNeighbourSeam(dragged, [PITCH - 0.1, 0, 0], [dragged.id], nodes)
      expect({ departure, snapped }).toEqual({ departure, snapped: null })
    }
  })

  test('a bay turned a different way is not pulled either', () => {
    const standing = rack('a', { position: [0, 0, 0] })
    const dragged = rack('b', { position: [40, 0, 40], rotation: [0, Math.PI / 4, 0] })
    expect(
      snapToNeighbourSeam(dragged, [PITCH - 0.1, 0, 0], [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a bay does not magnet to a seam of its own', () => {
    // Otherwise nudging a lone bay would step it a whole pitch, and dragging a
    // whole run would have every bay in it pulling on every other.
    const lone = rack('a', { position: [0, 0, 0] })
    expect(snapToNeighbourSeam(lone, [PITCH - 0.1, 0, 0], [lone.id], scene(lone))).toBeNull()
  })

  test('a seam another bay already fills is not offered', () => {
    // Two bays inside each other is the one outcome worse than no magnet.
    const first = rack('a', { position: [0, 0, 0] })
    const second = rack('b', { position: [PITCH, 0, 0] })
    const dragged = rack('c', { position: [40, 0, 40] })
    const nodes = scene(first, second, dragged)

    // Aiming at the filled seam between them gets nothing...
    expect(snapToNeighbourSeam(dragged, [PITCH + 0.05, 0, 0], [dragged.id], nodes)).toBeNull()
    // ...but the free end of the run still takes it.
    resetSeamIndex()
    const end = snapToNeighbourSeam(dragged, [2 * PITCH - 0.1, 0, 0], [dragged.id], nodes)
    expect(end?.[0]).toBeCloseTo(2 * PITCH, 9)
  })

  test('the hole a bay is being dragged out of stays open to drop back into', () => {
    // The bay is still recorded at its old position while the drag is in flight,
    // so treating "occupied" as absolute would lock the user out of the gap they
    // just lifted a bay from.
    const left = rack('a', { position: [0, 0, 0] })
    const middle = rack('b', { position: [PITCH, 0, 0] })
    const right = rack('c', { position: [2 * PITCH, 0, 0] })
    const nodes = scene(left, middle, right)

    const back = snapToNeighbourSeam(middle, [PITCH + 0.09, 0, 0.05], [middle.id], nodes)
    expect(back?.[0]).toBeCloseTo(PITCH, 9)
    expect(back?.[2]).toBeCloseTo(0, 9)
  })

  test('a whole run dragged together does not fight itself', () => {
    // Every bay of a moving run is a seam owner for every other. Without the
    // moving-set filter the group would snap to itself and refuse to travel.
    const run = [0, 1, 2].map((index) => rack(`r${index}`, { position: [index * PITCH, 0, 0] }))
    const nodes = scene(...run)
    const movingIds = run.map((r) => r.id)
    const head = run[0] as ReturnType<typeof rack>
    expect(snapToNeighbourSeam(head, [PITCH - 0.05, 0, 0], movingIds, nodes)).toBeNull()
  })

  test('the nearest free seam wins when two are in reach', () => {
    const left = rack('a', { position: [0, 0, 0] })
    const right = rack('b', { position: [4 * PITCH, 0, 0] })
    const dragged = rack('c', { position: [40, 0, 40] })
    const nodes = scene(left, right, dragged)
    // Just past `a`'s right seam, far from `b`'s left seam.
    const snapped = snapToNeighbourSeam(dragged, [PITCH + 0.2, 0, 0], [dragged.id], nodes)
    expect(snapped?.[0]).toBeCloseTo(PITCH, 9)
  })

  test('a wider bay magnets at its own pitch, not the default', () => {
    const wide = { bayClearWidth: 3.6 }
    const standing = rack('a', { position: [0, 0, 0], ...wide })
    const dragged = rack('b', { position: [40, 0, 40], ...wide })
    const pitch = bayPitch(standing)
    expect(pitch).not.toBeCloseTo(PITCH, 3)

    const snapped = snapToNeighbourSeam(
      dragged,
      [pitch - 0.1, 0, 0],
      [dragged.id],
      scene(standing, dragged),
    )
    expect(snapped?.[0]).toBeCloseTo(pitch, 9)
  })

  test('the y the drag arrived with is the y it leaves with', () => {
    // The magnet is a plan snap. Slab elevation is the host's business and it
    // runs after this.
    const standing = rack('a', { position: [0, 0, 0] })
    const dragged = rack('b', { position: [40, 0, 40] })
    const snapped = snapToNeighbourSeam(
      dragged,
      [PITCH - 0.1, 3.25, 0],
      [dragged.id],
      scene(standing, dragged),
    )
    expect(snapped?.[1]).toBe(3.25)
  })
})
