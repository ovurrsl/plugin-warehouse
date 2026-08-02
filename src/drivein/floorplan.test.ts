import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { buildDriveInFloorplan, PLAN_ROLES } from './floorplan'
import { orientedPalletFootprint, slotZ, totalDepth, totalWidth } from './lanes'
import { driveInParts } from './parts'
import { DriveInRackNode } from './schema'

/**
 * The plan matches the model.
 *
 * Not a slogan — an assertion. Both the symbol and the mesh are projected from
 * `driveInParts`, and this file measures that they land in the same place. The
 * failure it guards against is the one the selective rack hit: two files each
 * computing frame positions from the same inputs, agreeing exactly until one of
 * them is edited, and then disagreeing silently because nothing compares them.
 */

const lane = (patch: Partial<DriveInRackNode> = {}) =>
  DriveInRackNode.parse({ id: 'drive-in-rack_probe', ...patch })

const ctx = { viewState: undefined } as unknown as GeometryContext

function rectsOf(geometry: FloorplanGeometry | null): Array<{
  x: number
  y: number
  width: number
  height: number
}> {
  if (geometry?.kind !== 'group') return []
  return geometry.children
    .filter((child): child is Extract<FloorplanGeometry, { kind: 'rect' }> => child.kind === 'rect')
    .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }))
}

describe('every steel rect sits where its 3D box does', () => {
  const cases: Array<[string, Partial<DriveInRackNode>]> = [
    ['defaults', {}],
    ['guides fitted', { guideRails: true }],
    ['deep lane', { palletsDeep: 8 }],
    ['C rail', { railType: 'c' }],
    ['wide lane', { laneClearWidth: 1.55 }],
  ]

  for (const [label, patch] of cases) {
    test(label, () => {
      const node = lane(patch)
      const plan = rectsOf(buildDriveInFloorplan(node, ctx))
      const steel = driveInParts(node, 'full').filter((part) => PLAN_ROLES.has(part.role))

      expect(steel.length).toBeGreaterThan(0)
      for (const part of steel) {
        const x = part.center[0] - part.size[0] / 2
        const y = part.center[2] - part.size[2] / 2
        const found = plan.find(
          (rect) =>
            Math.abs(rect.x - x) < 1e-9 &&
            Math.abs(rect.y - y) < 1e-9 &&
            Math.abs(rect.width - part.size[0]) < 1e-9 &&
            Math.abs(rect.height - part.size[2]) < 1e-9,
        )
        expect(found, `${part.role} @ ${part.center.join(',')} planda karşılığı yok`).toBeDefined()
      }
    })
  }
})

describe('what the plan deliberately leaves out', () => {
  test('braces, footplates, brackets and the top beam are not drawn', () => {
    // A brace is a diagonal in a vertical plane, so from above it is a line the
    // posts already cover; footplates hide under them; the top beam is six
    // metres up. Drawing any of them only thickens the symbol.
    for (const role of ['brace', 'footplate', 'bracket', 'top-beam', 'reinforcer'] as const) {
      expect(PLAN_ROLES.has(role), `${role} plana girmemeli`).toBe(false)
    }
  })

  test('but rails ARE drawn — they are the symbol', () => {
    // Without them a drive-in lane in plan is a row of posts and a rectangle,
    // indistinguishable from a deep selective bay.
    expect(PLAN_ROLES.has('rail')).toBe(true)
    const rails = driveInParts(lane(), 'full').filter((part) => part.role === 'rail')
    expect(rails.length).toBeGreaterThan(0)
  })
})

describe('the outer rectangle and the pallet positions', () => {
  test('the outline is the full outer width and depth', () => {
    const node = lane()
    const first = rectsOf(buildDriveInFloorplan(node, ctx))[0]
    expect(first?.width).toBeCloseTo(totalWidth(node), 9)
    expect(first?.height).toBeCloseTo(totalDepth(node), 9)
  })

  test('one pallet outline per depth position, at the slot centres', () => {
    const node = lane()
    const [acrossLane, intoDepth] = orientedPalletFootprint(node)
    const plan = rectsOf(buildDriveInFloorplan(node, ctx))

    for (let depth = 1; depth <= node.palletsDeep; depth++) {
      const y = slotZ(node, depth) - intoDepth / 2
      const found = plan.find(
        (rect) =>
          Math.abs(rect.y - y) < 1e-9 &&
          Math.abs(rect.width - acrossLane) < 1e-9 &&
          Math.abs(rect.height - intoDepth) < 1e-9,
      )
      expect(found, `derinlik ${depth} planda yok`).toBeDefined()
    }
  })
})

describe('rotation', () => {
  test('is negated for SVG', () => {
    // SVG rotates clockwise with y down; three.js rotates counter-clockwise
    // about +Y. Invisible at 0° and obvious at 90°.
    const geometry = buildDriveInFloorplan(lane({ rotation: [0, Math.PI / 2, 0] }), ctx)
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    expect(geometry.transform?.rotate).toBeCloseTo(-Math.PI / 2, 9)
  })
})
