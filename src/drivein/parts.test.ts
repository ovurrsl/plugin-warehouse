import { describe, expect, test } from 'bun:test'
import { fittedLevelCount, frameCentersX, postCentersZ, railTopY, totalDepth } from './lanes'
import { type DriveInPart, type DriveInPartRole, driveInParts } from './parts'
import { DriveInRackNode } from './schema'

/**
 * Interference discipline, inherited from `rack/parts.test.ts`.
 *
 * The failure this guards against is silent by construction: a beam sized to
 * the post PITCH rather than to the clear span between post faces runs
 * centreline to centreline and buries half an upright at each end. Nothing in
 * the code says so and nothing on screen shows it — you have to fly the camera
 * inside the frame. Writing this file found exactly that in the top beam and
 * the cs3 plane before either had ever been rendered.
 */

const lane = (patch: Partial<DriveInRackNode> = {}) =>
  DriveInRackNode.parse({ id: 'drive-in-rack_probe', ...patch })

type Box = { min: [number, number, number]; max: [number, number, number] }

function boxOf(part: DriveInPart): Box {
  const [cx, cy, cz] = part.center
  const [sx, sy, sz] = part.size
  return {
    min: [cx - sx / 2, cy - sy / 2, cz - sz / 2],
    max: [cx + sx / 2, cy + sy / 2, cz + sz / 2],
  }
}

/** Overlap volume, with a tolerance so parts that merely touch are not faulted. */
function overlapVolume(a: Box, b: Box, tolerance = 1e-6): number {
  let volume = 1
  for (let axis = 0; axis < 3; axis++) {
    const low = Math.max(a.min[axis] ?? 0, b.min[axis] ?? 0)
    const high = Math.min(a.max[axis] ?? 0, b.max[axis] ?? 0)
    const span = high - low - tolerance
    if (span <= 0) return 0
    volume *= span
  }
  return volume
}

/**
 * Role pairs that cannot physically share space.
 *
 * Deliberately not every pair. A bracket is a wedge welded onto the rail–post
 * crossing and is *supposed* to touch both; a footplate sits under its own
 * post. Faulting those would make the test noise, and a noisy test gets its
 * tolerance widened until it stops catching anything.
 */
const EXCLUSIVE: Array<[DriveInPartRole, DriveInPartRole]> = [
  ['upright', 'rail'],
  ['upright', 'top-beam'],
  ['upright', 'guide'],
  ['rail', 'top-beam'],
  ['rail', 'guide'],
]

function interferences(parts: readonly DriveInPart[]): string[] {
  const found: string[] = []
  for (const [roleA, roleB] of EXCLUSIVE) {
    const as = parts.filter((part) => part.role === roleA)
    const bs = parts.filter((part) => part.role === roleB)
    for (const a of as) {
      for (const b of bs) {
        const volume = overlapVolume(boxOf(a), boxOf(b))
        if (volume > 0) {
          found.push(
            `${roleA}@${a.center.map((v) => v.toFixed(3)).join(',')} ↔ ` +
              `${roleB}@${b.center.map((v) => v.toFixed(3)).join(',')} = ${volume.toExponential(2)} m³`,
          )
        }
      }
    }
  }
  return found
}

describe('no exclusive role interpenetrates another', () => {
  const cases: Array<[string, Partial<DriveInRackNode>]> = [
    ['defaults', {}],
    ['C rail', { railType: 'c' }],
    ['guides fitted', { guideRails: true }],
    ['drive-through', { entryMode: 'drive-through' }],
    ['cs1', { constructiveSystem: 'cs1' }],
    ['cs3', { constructiveSystem: 'cs3' }],
    ['single position', { palletsDeep: 1 }],
    ['deep lane', { palletsDeep: 12 }],
    ['wide lane', { laneClearWidth: 1.55 }],
    ['short-side-out', { palletOrientation: 'short-side-out' }],
  ]

  for (const [label, patch] of cases) {
    test(label, () => {
      expect(interferences(driveInParts(lane(patch)))).toEqual([])
    })
  }

  test('far tier too — it drops parts, it does not move them', () => {
    expect(interferences(driveInParts(lane(), 'simple'))).toEqual([])
  })
})

describe('rails', () => {
  test('run the full lane depth and are centred on it', () => {
    const node = lane()
    const rails = driveInParts(node).filter((part) => part.role === 'rail')
    for (const rail of rails) {
      expect(rail.size[2]).toBeCloseTo(totalDepth(node), 9)
      expect(rail.center[2]).toBeCloseTo(0, 9)
    }
  })

  test('two per fitted level, one each side', () => {
    const node = lane()
    const rails = driveInParts(node).filter((part) => part.role === 'rail')
    expect(rails.length).toBe(fittedLevelCount(node) * 2)
    expect(new Set(rails.map((rail) => Math.sign(rail.center[0])))).toEqual(new Set([-1, 1]))
  })

  test('the top face is where the pallet sits', () => {
    const node = lane()
    const first = driveInParts(node).find((part) => part.role === 'rail')
    expect((first?.center[1] ?? 0) + (first?.size[1] ?? 0) / 2).toBeCloseTo(railTopY(node, 1), 9)
  })

  test('a level that does not fit grows no rail', () => {
    const node = lane({ levels: 6, uprightHeight: 4.6 })
    const rails = driveInParts(node).filter((part) => part.role === 'rail')
    expect(rails.length).toBe(3 * 2)
  })
})

describe('top beam spans the clear width, not the pitch', () => {
  test('its ends stop at the post faces', () => {
    const node = lane()
    const beam = driveInParts(node).find((part) => part.role === 'top-beam')
    expect(beam?.size[0]).toBeCloseTo(node.laneClearWidth, 9)

    // And the arithmetic that makes it true, stated rather than implied: the
    // beam's end and the post's inner face are the same plane.
    const [, rightX] = frameCentersX(node)
    const beamEnd = (beam?.center[0] ?? 0) + (beam?.size[0] ?? 0) / 2
    expect(beamEnd).toBeCloseTo(rightX - node.uprightWidth / 2, 9)
  })
})

describe('frame sharing', () => {
  test('a lane with a neighbour builds one frame line, not two', () => {
    const node = lane()
    const alone = driveInParts(node).filter((part) => part.role === 'upright')
    const abutted = driveInParts(node, 'full', { omitRight: true }).filter(
      (part) => part.role === 'upright',
    )
    expect(abutted.length).toBe(alone.length / 2)
    // The one it keeps is the LEFT line — the rule has to be the same on every
    // lane or two neighbours would each omit the other's.
    const [leftX] = frameCentersX(node)
    for (const post of abutted) expect(post.center[0]).toBeCloseTo(leftX, 9)
  })

  test('and its top beams go with it — the neighbour carries them', () => {
    expect(
      driveInParts(lane(), 'full', { omitRight: true }).some((part) => part.role === 'top-beam'),
    ).toBe(false)
  })
})

describe('entry mode', () => {
  test('drive-through never grows the cs3 plane, even when asked', () => {
    // The catalogue forbids the combination (p.13); `lanes.ts` reports it and
    // the geometry simply does not build it, so a scene saved with the invalid
    // pair draws a lane you could drive through rather than a blocked one.
    const node = lane({ entryMode: 'drive-through', constructiveSystem: 'cs3' })
    const posts = postCentersZ(node)
    const back = posts[posts.length - 1] ?? 0
    const acrossTheBack = driveInParts(node).filter(
      (part) =>
        part.role === 'brace' && Math.abs(part.center[2] - back) < 1e-6 && part.size[0] > 0.5,
    )
    expect(acrossTheBack).toEqual([])
  })

  test('single-entry cs3 does build it', () => {
    const node = lane({ constructiveSystem: 'cs3' })
    const posts = postCentersZ(node)
    const back = posts[posts.length - 1] ?? 0
    const acrossTheBack = driveInParts(node).filter(
      (part) =>
        part.role === 'brace' && Math.abs(part.center[2] - back) < 1e-6 && part.size[0] > 0.5,
    )
    expect(acrossTheBack.length).toBe(1)
  })

  test('drive-through reinforces both faces — a fork enters from either end', () => {
    const single = driveInParts(lane()).filter((part) => part.role === 'reinforcer')
    const through = driveInParts(lane({ entryMode: 'drive-through' })).filter(
      (part) => part.role === 'reinforcer',
    )
    expect(through.length).toBe(single.length * 2)
  })
})

describe('tiers', () => {
  test('the far tier drops the fittings and keeps the structure', () => {
    const near = driveInParts(lane())
    const far = driveInParts(lane(), 'simple')
    const roles = (parts: readonly DriveInPart[]) => new Set(parts.map((part) => part.role))

    expect(roles(far).has('upright')).toBe(true)
    expect(roles(far).has('rail')).toBe(true)
    expect(roles(far).has('top-beam')).toBe(true)
    // Brackets, braces and the reinforcer are sub-pixel at the far band and
    // cost one box per post per level.
    expect(roles(far).has('bracket')).toBe(false)
    expect(roles(far).has('brace')).toBe(false)
    expect(far.length).toBeLessThan(near.length)
  })
})

describe('guides', () => {
  test('are absent unless fitted', () => {
    expect(driveInParts(lane()).some((part) => part.role === 'guide')).toBe(false)
  })

  test('leave the catalogue gap of entry width less 110 mm', () => {
    const node = lane({ guideRails: true })
    const guides = driveInParts(node).filter((part) => part.role === 'guide')
    expect(guides.length).toBe(2)
    const inner = guides.map((guide) => Math.abs(guide.center[0]) - guide.size[0] / 2)
    expect((inner[0] ?? 0) * 2).toBeCloseTo(node.laneClearWidth - 0.11, 9)
  })
})
