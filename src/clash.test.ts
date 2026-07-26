import { beforeAll, describe, expect, test } from 'bun:test'
import { registerNode } from '@pascal-app/core'
import { clashesWith } from './clash'
import { conveyorRollerDefinition } from './conveyor/definition'
import { ConveyorRollerNode } from './conveyor/schema'
import { palletDefinition } from './pallet/definition'
import { PalletNode } from './pallet/schema'
import { palletRackDefinition } from './rack/definition'
import { PalletRackNode } from './rack/schema'
import { bayPitch, levelSurfaceY } from './rack/slots'

/**
 * Everything in this package must refuse to be placed inside anything else —
 * including host kinds it has never heard of — and must still allow the
 * arrangements a warehouse is actually made of.
 *
 * The second half is the hard one and the reason these tests exist: a pallet
 * belongs *on* a rack beam, two bays belong at the sharing pitch with their
 * frames deliberately overlapping, and a conveyor belongs in the walkway under
 * a tunnelled bay. A clash test that gets the first half right and the second
 * half wrong is worse than none, because it forbids the layout.
 */

beforeAll(() => {
  // `footprintBox` reads the declared footprint through the registry, which is
  // what lets a host kind obstruct without this package listing it. So the
  // registry has to be populated for the test to mean anything.
  registerNode(palletDefinition as never)
  registerNode(palletRackDefinition as never)
  registerNode(conveyorRollerDefinition as never)
})

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_a', levels: 3, uprightHeight: 6, ...overrides })
const pallet = (overrides: Record<string, unknown> = {}) =>
  PalletNode.parse({ id: 'pallet_a', ...overrides })
const conveyor = (overrides: Record<string, unknown> = {}) =>
  ConveyorRollerNode.parse({ id: 'conveyor_roller_a', rollers: 40, ...overrides })

const scene = (...nodes: Array<{ id: string }>) =>
  Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, unknown>

const hits = (
  node: unknown,
  position: [number, number, number],
  rotationY: number,
  nodes: Record<string, unknown>,
) => clashesWith({ node, position, rotationY, nodes })

describe('nothing may be placed inside anything else', () => {
  test('a conveyor will not go down on a loaded pallet, or a pallet on a conveyor', () => {
    // The reported failure, both ways round. It was reachable because the test
    // only ever looked at racks: anything the package had not been told about
    // was invisible, silently, one kind at a time.
    const load = pallet({ position: [0, 0, 0], loadHeight: 1 })
    expect(hits(conveyor(), [0, 0, 0], 0, scene(load))).toEqual(['pallet_a'])

    const belt = conveyor({ position: [0, 0, 0] })
    expect(hits(pallet(), [0, 0, 0], 0, scene(belt))).toEqual(['conveyor_roller_a'])
  })

  test('a conveyor will not go through a rack upright', () => {
    const standing = rack({ position: [0, 0, 0], tunnelLevels: 2 })
    // The frames sit half a bay pitch either side of the node.
    expect(hits(conveyor(), [bayPitch(standing) / 2, 0, 0], Math.PI / 2, scene(standing))).toEqual([
      'pallet_rack_a',
    ])
  })

  test('a rack will not come down with an upright on a conveyor — the question is symmetric', () => {
    // One module, not two: a package that answered this only from the
    // conveyor's side would let the same overlap through whenever the rack was
    // the thing being placed. The conveyor here runs across the bay, so a
    // frame would land on the bed.
    const belt = conveyor({ position: [bayPitch(rack()) / 2, 0, 0], rotation: [0, Math.PI / 2, 0] })
    expect(hits(rack(), [0, 0, 0], 0, scene(belt))).toEqual(['conveyor_roller_a'])
  })

  test('clear ground is clear', () => {
    const standing = rack({ position: [0, 0, 0] })
    expect(hits(conveyor(), [40, 0, 40], 0, scene(standing))).toEqual([])
    expect(hits(pallet(), [40, 0, 40], 0, scene(standing))).toEqual([])
  })
})

describe('and the arrangements a warehouse is made of still work', () => {
  test('a pallet goes on a rack beam', () => {
    // The one that is easy to break and would be caught late: the pallet rests
    // *on* the load surface, so its underside and the beam top land on exactly
    // the same plane. Touching is not clashing.
    const standing = rack({ position: [0, 0, 0] })
    const surface = levelSurfaceY(standing, 1)
    expect(hits(pallet(), [0, surface, 0], 0, scene(standing))).toEqual([])
  })

  test('a pallet stands on the floor inside a bay', () => {
    // Ground-level storage: between the uprights, under the first beam.
    const standing = rack({ position: [0, 0, 0] })
    expect(hits(pallet({ loadHeight: 1 }), [0, 0, 0], 0, scene(standing))).toEqual([])
  })

  test('two bays stand at the sharing pitch, frames and all', () => {
    // The gesture the whole rack kind exists for. Each bay builds both frames
    // until it learns it has a neighbour, so their *steel* overlaps by an
    // upright — which is why same-kind placement is compared by footprint, the
    // box a kind tiles at, rather than by volume.
    const standing = rack({ id: 'pallet_rack_standing', position: [0, 0, 0] })
    const moving = rack({ id: 'pallet_rack_moving' })
    expect(hits(moving, [bayPitch(standing), 0, 0], 0, scene(standing))).toEqual([])
    // And a bay dropped on top of another is still refused.
    expect(hits(moving, [1, 0, 0], 0, scene(standing))).toEqual(['pallet_rack_standing'])
  })

  test('bracing is steel, and a run along the aisle goes through it', () => {
    // The narrow side of a pair of uprights looks like open air and is not:
    // z- and x-bracing fill a frame's depth plane with diagonals from the floor
    // to the top of the post. This is why the clash volume reads the *near*
    // tier — the far tier is posts and beams, and bracing is exactly what it
    // drops, so a conveyor could be run straight through a braced frame.
    const belt = conveyor({ transportHeight: 0.75 })
    for (const bracing of ['z-bracing', 'x-bracing'] as const) {
      const braced = rack({ id: 'pallet_rack_braced', bracing, tunnelLevels: 2 })
      expect({ bracing, hits: hits(belt, [0, 0, 0], 0, scene(braced)) }).toEqual({
        bracing,
        hits: ['pallet_rack_braced'],
      })
    }
    // An unbraced frame really is open, and the test has to say so rather than
    // refusing every rack on principle.
    const open = rack({ id: 'pallet_rack_open', bracing: 'open', tunnelLevels: 2 })
    expect(hits(belt, [0, 0, 0], 0, scene(open))).toEqual([])
  })

  test('crossing the bay through a tunnel clears the frames entirely', () => {
    // The other axis, and the one the tunnel is for: a conveyor running across
    // the depth passes between the frames rather than through them, so bracing
    // never enters into it.
    const belt = conveyor({ transportHeight: 0.75 })
    for (const bracing of ['z-bracing', 'x-bracing', 'open'] as const) {
      const braced = rack({ id: 'pallet_rack_x', bracing, tunnelLevels: 2 })
      expect({ bracing, hits: hits(belt, [0, 0, 0], Math.PI / 2, scene(braced)) }).toEqual({
        bracing,
        hits: [],
      })
    }
  })

  test('two conveyor modules butt end to end', () => {
    const standing = conveyor({ id: 'conveyor_roller_standing', position: [0, 0, 0] })
    const moving = conveyor({ id: 'conveyor_roller_moving' })
    const length = 40 * 0.075
    expect(hits(moving, [length, 0, 0], 0, scene(standing))).toEqual([])
    expect(hits(moving, [length / 2, 0, 0], 0, scene(standing))).toEqual([
      'conveyor_roller_standing',
    ])
  })

  test('a conveyor runs through the walkway a tunnel opens, and not through a solid bay', () => {
    // The requirement in one pair. Nothing computes the tunnel: a tunnelled
    // level emits no beams at all, so the clearance is in the parts list
    // because it is in the rack.
    const tunnelled = rack({ id: 'pallet_rack_tunnel', tunnelLevels: 2 })
    const solid = rack({ id: 'pallet_rack_solid' })
    const belt = conveyor({ transportHeight: 1.55 })
    expect(hits(belt, [0, 0, 0], Math.PI / 2, scene(tunnelled))).toEqual([])
    expect(hits(belt, [0, 0, 0], Math.PI / 2, scene(solid))).toEqual(['pallet_rack_solid'])
  })

  test('a node never clashes with itself, or with anything travelling with it', () => {
    const standing = conveyor({ id: 'conveyor_roller_standing', position: [0, 0, 0] })
    const partner = conveyor({ id: 'conveyor_roller_partner', position: [0, 0, 0] })
    expect(hits(standing, [0, 0, 0], 0, scene(standing))).toEqual([])
    expect(
      clashesWith({
        node: standing,
        position: [0, 0, 0],
        rotationY: 0,
        nodes: scene(standing, partner),
        ignore: ['conveyor_roller_partner'],
      }),
    ).toEqual([])
  })
})

describe('a kind this package has never heard of still obstructs', () => {
  test('anything declaring a floor footprint is read through the registry', () => {
    // The half a hand-written table keeps failing at. A host column, an item, a
    // cabinet — none of them are named anywhere in this package, and all of
    // them have to stop a conveyor being dropped through them.
    registerNode({
      kind: 'test:obstacle',
      schemaVersion: 1,
      schema: PalletNode,
      category: 'furnish',
      defaults: () => ({}),
      capabilities: {
        floorPlaced: {
          footprint: () => ({ dimensions: [2, 2, 2], rotation: [0, 0, 0] }),
          applies: () => true,
          collides: true,
        },
      },
    } as never)

    const obstacle = {
      id: 'test_obstacle_1',
      type: 'test:obstacle',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }
    expect(hits(conveyor(), [0, 0, 0], 0, scene(obstacle as never))).toEqual(['test_obstacle_1'])
    // And a two-metre box is cleared by two metres.
    expect(hits(conveyor(), [0, 0, 3], 0, scene(obstacle as never))).toEqual([])
  })

  test('a node with no footprint at all is not an obstruction', () => {
    // A level, a group, anything abstract. Treating those as solid would make
    // every placement invalid the moment a scene had a parent node in it.
    const level = { id: 'level_1', type: 'level', position: [0, 0, 0], rotation: [0, 0, 0] }
    expect(hits(conveyor(), [0, 0, 0], 0, scene(level as never))).toEqual([])
  })
})
