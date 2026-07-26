import { describe, expect, test } from 'bun:test'
import { palletRackDefinition } from './definition'
import { multiplyPlacements, runExtent } from './multiply'
import { PalletRackNode } from './schema'
import { bayPitch, totalDepth, totalWidth } from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_def', ...overrides })

const footprintOf = (node: ReturnType<typeof rack>) =>
  palletRackDefinition.capabilities.floorPlaced.footprint(node as never).dimensions

describe('the declared footprint is what lets bays share a post', () => {
  test('a bay occupies exactly one pitch in the world', () => {
    // Not the outer width. The two numbers differ by one upright, and declaring
    // the wrong one is a silent, total failure: `collides: true` reads the
    // 122 mm difference as a conflict, so the placement box goes red and the
    // click is swallowed every time a bay is brought flush against another —
    // the one gesture the whole kind exists for.
    for (const config of [{}, { bayClearWidth: 3.6 }, { uprightWidth: 0.101 }, { depth: 2.4 }]) {
      const node = rack(config)
      const [width, height, depth] = footprintOf(node)
      expect({ config, width }).toEqual({ config, width: bayPitch(node) })
      expect(height).toBe(node.uprightHeight)
      expect(depth).toBe(totalDepth(node))
      // And it really is narrower than the steel — the overhang is the point.
      expect(width).toBeLessThan(totalWidth(node))
    }
  })

  test('two bays at the sharing pitch have footprints that touch, not overlap', () => {
    // The arithmetic the spatial grid actually performs. An epsilon of 1e-4 is
    // what the host compares with, so "touching" has to mean touching to well
    // inside that.
    const a = rack()
    const pitch = bayPitch(a)
    const [width] = footprintOf(a)
    const gap = pitch - width
    expect(Math.abs(gap)).toBeLessThan(1e-9)
  })

  test('a run of N bays tiles N footprints with no overlap anywhere', () => {
    const source = rack()
    const spec = {
      bays: 8,
      rows: 1,
      backToBack: false,
      backToBackGap: 0.2,
      aisleWidth: 3.2,
    }
    const [width] = footprintOf(source)
    const centres = [
      source.position[0],
      ...multiplyPlacements(source, spec).map((placement) => placement.position[0]),
    ].sort((a, b) => a - b)

    for (let index = 1; index < centres.length; index++) {
      const gap = (centres[index] ?? 0) - (centres[index - 1] ?? 0) - width
      expect(Math.abs(gap)).toBeLessThan(1e-9)
    }

    // And the collision box the tool tests covers exactly that tiling — not the
    // steel length, which is one upright longer and would refuse the next run.
    expect(runExtent(source, spec).collisionWidth).toBeCloseTo(width * spec.bays, 9)
    expect(runExtent(source, spec).width).toBeCloseTo(width * spec.bays + source.uprightWidth, 9)
  })

  test('the drag box stays the steel, because it is drawn rather than tested', () => {
    const node = rack()
    const bounds = palletRackDefinition.capabilities.dragBounds(node as never)
    expect(bounds.size[0]).toBeCloseTo(totalWidth(node), 9)
  })
})
