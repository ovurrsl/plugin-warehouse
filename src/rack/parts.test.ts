import { describe, expect, test } from 'bun:test'
import { type RackPart, type RackPartRole, rackParts } from './parts'
import { PalletRackNode } from './schema'
import { bayPitch, frameCentersX, totalDepth, totalWidth } from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_parts', ...overrides })

type Aabb = { min: [number, number, number]; max: [number, number, number] }

/** A part's axis-aligned bounds, with a tilt folded into the Y/Z extents. */
function bounds(part: RackPart): Aabb {
  const [cx, cy, cz] = part.center
  const [sx, sy, sz] = part.size
  const tilt = part.tiltX ?? 0
  const cos = Math.abs(Math.cos(tilt))
  const sin = Math.abs(Math.sin(tilt))
  const hy = (sy * cos + sz * sin) / 2
  const hz = (sy * sin + sz * cos) / 2
  return {
    min: [cx - sx / 2, cy - hy, cz - hz],
    max: [cx + sx / 2, cy + hy, cz + hz],
  }
}

/**
 * Overlap along every axis, in metres, reported only when it is real.
 *
 * Parts that meet exactly — a beam end against an upright face — land on the
 * boundary, where the two computed coordinates differ by a couple of ulps.
 * Anything under a micron is that, not steel sharing space, and treating it as
 * a hit would make the check cry wolf on the very fit it exists to enforce.
 */
const CONTACT_TOLERANCE = 1e-6

function penetration(a: Aabb, b: Aabb): number {
  let smallest = Number.POSITIVE_INFINITY
  for (let axis = 0; axis < 3; axis++) {
    const overlap =
      Math.min(a.max[axis] ?? 0, b.max[axis] ?? 0) - Math.max(a.min[axis] ?? 0, b.min[axis] ?? 0)
    if (overlap <= CONTACT_TOLERANCE) return 0
    smallest = Math.min(smallest, overlap)
  }
  return smallest
}

function partsOf(node: ReturnType<typeof rack>, role: RackPartRole) {
  return rackParts(node, 'full').filter((part) => part.role === role)
}

describe('beam to upright fit', () => {
  test('a beam spans the clear width and stops at the upright faces', () => {
    // The defect this pins: beams were built a full bay pitch long and centred
    // on the bay, so each ran from one post's centreline to the next and buried
    // half an upright width in steel at both ends.
    const r = rack()
    const frames = frameCentersX(r)
    for (const beam of partsOf(r, 'beam')) {
      expect(beam.size[0]).toBeCloseTo(r.bayClearWidth, 9)
      const left = beam.center[0] - beam.size[0] / 2
      const right = beam.center[0] + beam.size[0] / 2
      // Both ends land exactly on an upright face.
      const faces = frames.flatMap((x) => [x - r.uprightWidth / 2, x + r.uprightWidth / 2])
      expect(faces.some((face) => Math.abs(face - left) < 1e-9)).toBe(true)
      expect(faces.some((face) => Math.abs(face - right) < 1e-9)).toBe(true)
    }
  })

  test('no beam interpenetrates any upright', () => {
    for (const config of [
      {},
      { bayClearWidth: 3.6 },
      { tunnelLevels: 1 },
      { depthPositions: 2 },
      { hasGroundBeam: true },
      { pickingLevels: 2 },
      { uprightWidth: 0.101, uprightDepth: 0.069 },
      { beamThickness: 0.05, beamHeight: 0.17 },
    ]) {
      const r = rack(config)
      const uprights = partsOf(r, 'upright').map(bounds)
      for (const beam of partsOf(r, 'beam')) {
        const box = bounds(beam)
        for (const upright of uprights) {
          expect({ config, hit: penetration(box, upright) }).toEqual({ config, hit: 0 })
        }
      }
    }
  })

  /**
   * Roles that may share material, and why.
   *
   * Everything else that overlaps is a defect. The check this replaces looked
   * only at beams against uprights, which is exactly why the beam's *end
   * connector* sank three millimetres into the post's flange unnoticed: a
   * different role, wearing a beam-ish colour, sitting where a beam ends — so on
   * screen it read as the beam running into the upright.
   */
  const JOINTS: ReadonlySet<string> = new Set([
    // Diagonals meet the horizontals, and each other, at their end nodes. Real
    // frames bolt or weld there, so the steel genuinely occupies one volume.
    'brace × brace',
    // A folded section's web and flanges share the corner they are folded from.
    'upright × upright',
    // A post is welded to its baseplate and stands in its thickness.
    'footplate × upright',
    // The endplate is welded to the beam's end and wraps it, which is the whole
    // point of moving it inboard: it now occupies the beam rather than the post.
    'beam × connector',
  ])

  test('nothing interpenetrates that is not a joint', () => {
    for (const config of [
      {},
      { levels: 3 },
      { tunnelLevels: 1 },
      { depthPositions: 2 },
      { hasGroundBeam: true, pickingLevels: 1, levels: 2 },
      { bracing: 'x-bracing' },
      { palletOrientation: 'long-side-out' },
      { uprightWidth: 0.101, uprightDepth: 0.069, beamHeight: 0.17 },
    ]) {
      const r = rack(config)
      const parts = rackParts(r, 'full')
      const boxes = parts.map(bounds)
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const pair = [parts[i]?.role, parts[j]?.role].sort().join(' × ')
          if (JOINTS.has(pair)) continue
          const hit = penetration(boxes[i] as Aabb, boxes[j] as Aabb)
          expect({ config, pair, hit }).toEqual({ config, pair, hit: 0 })
        }
      }
    }
  })

  test('the end connector stops at the upright face', () => {
    const r = rack()
    const frames = frameCentersX(r)
    const faces = frames.flatMap((x) => [x - r.uprightWidth / 2, x + r.uprightWidth / 2])
    for (const connector of partsOf(r, 'connector')) {
      const outer = [
        connector.center[0] - connector.size[0] / 2,
        connector.center[0] + connector.size[0] / 2,
      ]
      // One end lands on a post face; the other is inside the bay.
      expect(outer.some((edge) => faces.some((face) => Math.abs(face - edge) < 1e-9))).toBe(true)
    }
  })

  test('a beam sits on the frame face rather than inside the post', () => {
    const r = rack()
    const depth = totalDepth(r)
    for (const beam of partsOf(r, 'beam')) {
      const outer = Math.abs(beam.center[2]) + beam.size[2] / 2
      // Flush with the outer face of the frame, which is where a real beam's
      // connector bolts it.
      expect(outer).toBeCloseTo(depth / 2, 9)
    }
  })
})

describe('nothing escapes the declared envelope', () => {
  test('every part except the footplates fits the collision footprint', () => {
    const r = rack({ depthPositions: 2 })
    const halfWidth = totalWidth(r) / 2
    const halfDepth = totalDepth(r) / 2
    for (const part of rackParts(r, 'full')) {
      if (part.role === 'footplate') continue
      const box = bounds(part)
      expect(box.min[0]).toBeGreaterThanOrEqual(-halfWidth - 1e-9)
      expect(box.max[0]).toBeLessThanOrEqual(halfWidth + 1e-9)
      expect(box.min[2]).toBeGreaterThanOrEqual(-halfDepth - 1e-9)
      expect(box.max[2]).toBeLessThanOrEqual(halfDepth + 1e-9)
    }
  })

  test('nothing is below the floor or above the frame', () => {
    for (const config of [
      {},
      { hasGroundBeam: true },
      { bracing: 'x-bracing' },
      { levels: 6, uprightHeight: 9 },
    ]) {
      const r = rack(config)
      for (const part of rackParts(r, 'full')) {
        const box = bounds(part)
        expect({ config, role: part.role, below: box.min[1] < -1e-9 }).toEqual({
          config,
          role: part.role,
          below: false,
        })
        expect(box.max[1]).toBeLessThanOrEqual(r.uprightHeight + 1e-9)
      }
    }
  })
})

describe('bay width follows the beam and upright dimensions', () => {
  test('total width is one beam between two posts', () => {
    for (const config of [{}, { bayClearWidth: 3.9, uprightWidth: 0.101 }, { depth: 2.4 }]) {
      const r = rack(config)
      expect(totalWidth(r)).toBeCloseTo(r.bayClearWidth + 2 * r.uprightWidth, 9)
      // And the drawn steel actually reaches both ends of that figure.
      const uprights = partsOf(r, 'upright').map(bounds)
      const left = Math.min(...uprights.map((b) => b.min[0]))
      const right = Math.max(...uprights.map((b) => b.max[0]))
      expect(right - left).toBeCloseTo(totalWidth(r), 6)
    }
  })

  test('the bay pitch is one beam plus one post, with no slack', () => {
    // The pitch is the whole shared-frame contract: a sibling laid down exactly
    // this far along lands its left frame where this bay's right frame stands,
    // so the two show one post. Slack here would open a hairline gap in a run
    // and the frames would stop coinciding.
    const r = rack()
    const frames = frameCentersX(r)
    expect((frames[1] ?? 0) - (frames[0] ?? 0)).toBeCloseTo(bayPitch(r), 9)
    expect(bayPitch(r)).toBeCloseTo(r.bayClearWidth + r.uprightWidth, 9)
  })

  test('a bay with a right neighbour drops exactly one frame line', () => {
    const r = rack()
    const alone = rackParts(r, 'full')
    const abutted = rackParts(r, 'full', true)
    const frameRoles = new Set(['upright', 'footplate', 'brace'])
    const framePartsOf = (list: typeof alone) => list.filter((part) => frameRoles.has(part.role))

    // Half the frame steel, and nothing else touched.
    expect(framePartsOf(abutted).length * 2).toBe(framePartsOf(alone).length)
    expect(abutted.filter((part) => !frameRoles.has(part.role)).length).toBe(
      alone.filter((part) => !frameRoles.has(part.role)).length,
    )
    // The one it keeps is the left, so a run's frames come from its bays'
    // left-hand sides and the closing frame from the last bay.
    const kept = framePartsOf(abutted).map((part) => part.center[0])
    expect(Math.max(...kept)).toBeLessThan(0)
  })
})

describe('perforations', () => {
  test('only the upright faces carry the slot pattern', () => {
    const r = rack()
    for (const part of rackParts(r, 'full')) {
      if (part.perforated) expect(part.role).toBe('upright')
    }
    expect(partsOf(r, 'upright').some((part) => part.perforated)).toBe(true)
  })

  test('the far tier drops the pattern along with the section', () => {
    // `simple` uses a solid box for the post, so there is no web face to punch
    // and the texture lookup would land on a face that is not really there.
    const r = rack()
    expect(rackParts(r, 'simple').some((part) => part.perforated)).toBe(false)
  })
})
