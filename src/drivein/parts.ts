import {
  clearOpening,
  effectivePostPitchZ,
  fittedLevelCount,
  frameCentersX,
  orientedPalletFootprint,
  postCentersZ,
  railHeight,
  railTopY,
  topBeamUndersideY,
  totalDepth,
} from './lanes'
import type { DriveInRackNode } from './schema'
import { GUIDE_GAP_INSET, RAIL_PROFILES, railNoseInset } from './standards'

/**
 * Every piece of steel in a drive-in lane, as a list of boxes.
 *
 * One list, three consumers: the 3D builder extrudes it, the floorplan projects
 * it, and the tests measure it. That is the only way "the plan matches the
 * model" can be a fact rather than a hope — the selective rack's file documents
 * what happens without it, and the failure it documents (beams buried half an
 * upright deep at both ends, invisible unless you fly the camera into the
 * frame) is exactly the trap here: a rail that runs post-centre to post-centre
 * buries itself in the steel.
 */

export type DriveInPartRole =
  | 'upright'
  | 'footplate'
  | 'brace'
  | 'rail'
  | 'bracket'
  | 'top-beam'
  | 'guide'
  | 'reinforcer'

export type DriveInPart = {
  role: DriveInPartRole
  center: [number, number, number]
  size: [number, number, number]
  /** Rotation about X in radians. Only frame bracing uses it. */
  tiltX?: number
  /** Which column of the shared atlas this part reads. See `rack/parts.ts`. */
  pattern?: 'slots'
}

/** Two tiers, exactly as every other kind in this package: the near one carries
 *  the bracing and the fittings, the far one keeps only what reads as a
 *  silhouette at distance. */
export type DriveInDetail = 'full' | 'simple'

/** Baseplate thickness. Chosen default — the catalogue publishes footplate plan
 *  sizes but no plate thickness. */
const FOOTPLATE_THICKNESS = 0.012
/** Bracket wedge at a rail–post crossing. Chosen default, sized to read at
 *  1 : 1 without adding a part per slot. */
const BRACKET_SIZE = 0.06
/** Guide profile section. p.22 names LPN50; the 50 is the leg height. */
const GUIDE_HEIGHT = 0.05
const GUIDE_THICKNESS = 0.04
/** Impact reinforcer, p.25. Height chosen to cover a fork's strike zone. */
const REINFORCER_HEIGHT = 0.4

/**
 * Which frame lines this lane actually builds.
 *
 * A lane always builds its **left** line and builds the right one only when
 * nothing abuts it — the same rule the selective rack uses, and what makes ten
 * lanes stand on eleven frame lines rather than twenty.
 */
export type FrameOmission = { omitRight: boolean }

export function driveInParts(
  lane: DriveInRackNode,
  detail: DriveInDetail = 'full',
  omission: FrameOmission = { omitRight: false },
): DriveInPart[] {
  const parts: DriveInPart[] = []
  const [leftX, rightX] = frameCentersX(lane)
  const lines = omission.omitRight ? [leftX] : [leftX, rightX]
  const posts = postCentersZ(lane)
  const fitted = fittedLevelCount(lane)
  const rail = RAIL_PROFILES[lane.railType]
  const railH = railHeight(lane)
  const depth = totalDepth(lane)

  // ── Uprights and their plates ─────────────────────────────────────────────
  for (const x of lines) {
    for (const z of posts) {
      parts.push({
        role: 'upright',
        center: [x, lane.uprightHeight / 2, z],
        size: [lane.uprightWidth, lane.uprightHeight, lane.uprightDepth],
        // Perforations are texture, not geometry. Drawing each punched slot as
        // a box costs about a thousand extra boxes per lane — more than
        // everything else in the model combined.
        pattern: 'slots',
      })
      parts.push({
        role: 'footplate',
        center: [x, FOOTPLATE_THICKNESS / 2, z],
        size: [lane.uprightWidth * 1.4, FOOTPLATE_THICKNESS, lane.uprightDepth * 1.5],
      })
    }
  }

  // ── Rails ─────────────────────────────────────────────────────────────────
  //
  // Two runs per level per lane, cantilevered inward off the posts so the clear
  // span between their inner noses is the catalogue's D (p.18 table). The rail
  // runs the **full lane depth** and is centred on it — running post-centre to
  // post-centre would bury half a post at each end, which is the bug the
  // selective rack's parts file was written to prevent.
  const [acrossLane] = orientedPalletFootprint(lane)
  const inset = railNoseInset(lane.railType, lane.laneClearWidth, acrossLane)
  const railCentreOffset = lane.laneClearWidth / 2 - inset + rail.width / 2

  for (let level = 1; level <= fitted; level++) {
    const topY = railTopY(lane, level)
    for (const sign of [-1, 1] as const) {
      parts.push({
        role: 'rail',
        center: [sign * railCentreOffset, topY - railH / 2, 0],
        size: [rail.width, railH, depth],
      })
    }

    // Brackets at every rail–post crossing. Full tier only: at distance they
    // are sub-pixel and cost one box per post per level per side.
    if (detail === 'full') {
      for (const z of posts) {
        for (const sign of [-1, 1] as const) {
          parts.push({
            role: 'bracket',
            center: [sign * railCentreOffset, topY - railH - BRACKET_SIZE / 2, z],
            size: [BRACKET_SIZE, BRACKET_SIZE, BRACKET_SIZE],
          })
        }
      }
    }
  }

  // ── Top beams ─────────────────────────────────────────────────────────────
  //
  // Across the lane at every post line, tying the two frame lines together.
  //
  // Length is the **clear width between the post faces**, not the pitch. A beam
  // sized to the pitch runs centreline to centreline and buries half an upright
  // at each end — the exact bug `rack/parts.ts` was written to prevent, and
  // invisible unless you fly the camera into the frame. `parts.test.ts` refuses
  // it now.
  const beamUnderside = topBeamUndersideY(lane)
  if (!omission.omitRight) {
    for (const z of posts) {
      parts.push({
        role: 'top-beam',
        center: [0, beamUnderside + lane.topBeamHeight / 2, z],
        size: [lane.laneClearWidth, lane.topBeamHeight, 0.05],
      })
    }
  }

  // ── Bracing ───────────────────────────────────────────────────────────────
  if (detail === 'full') {
    parts.push(...bracingParts(lane, lines, posts))
  }

  // ── Guides and the impact reinforcer ──────────────────────────────────────
  if (lane.guideRails) {
    const gap = lane.laneClearWidth - GUIDE_GAP_INSET
    for (const sign of [-1, 1] as const) {
      parts.push({
        role: 'guide',
        center: [sign * (gap / 2 + GUIDE_THICKNESS / 2), GUIDE_HEIGHT / 2, 0],
        size: [GUIDE_THICKNESS, GUIDE_HEIGHT, depth],
      })
    }
  }

  if (lane.uprightReinforcer && detail === 'full') {
    // p.25: on the aisle face only. A drive-through lane has two aisle faces,
    // so it gets one at each end — the fork enters from both.
    const front = posts[0]
    const back = posts[posts.length - 1]
    const faces = lane.entryMode === 'drive-through' ? [front, back] : [front]
    for (const z of faces) {
      if (z === undefined) continue
      for (const x of lines) {
        parts.push({
          role: 'reinforcer',
          center: [x, REINFORCER_HEIGHT / 2, z],
          size: [lane.uprightWidth * 1.3, REINFORCER_HEIGHT, lane.uprightDepth * 1.3],
        })
      }
    }
  }

  return parts
}

/**
 * p.12–13. What holds the block up sideways.
 *
 * The three systems are cumulative in the catalogue's own presentation, and the
 * geometry follows: cs2 keeps cs1's base ties and adds upper cross bracing;
 * cs3 keeps both and adds a vertical braced plane at the closed end.
 *
 * That last plane is why `drive-through` forbids cs3 — it would stand across
 * the far entrance. The check lives in `lanes.ts` and the panel reports it;
 * here the plane is simply not emitted, so a scene saved with the invalid
 * combination draws a buildable lane rather than a blocked one.
 */
function bracingParts(
  lane: DriveInRackNode,
  lines: readonly number[],
  posts: readonly number[],
): DriveInPart[] {
  const parts: DriveInPart[] = []
  const pitch = effectivePostPitchZ(lane)
  const braceSection = 0.04

  // cs1 and up: base ties along each frame line, post to post.
  for (const x of lines) {
    for (let index = 0; index < posts.length - 1; index++) {
      const a = posts[index]
      const b = posts[index + 1]
      if (a === undefined || b === undefined) continue
      parts.push({
        role: 'brace',
        center: [x, clearOpening(lane, 0) * 0.15, (a + b) / 2],
        size: [braceSection, braceSection, Math.abs(b - a)],
      })
    }
  }

  if (lane.constructiveSystem === 'cs1') return parts

  // cs2 and up: upper cross braces in the frame plane (Y–Z), diagonals between
  // consecutive posts. `tiltX` leans the box in exactly that plane.
  const upperY = topBeamUndersideY(lane)
  for (const x of lines) {
    for (let index = 0; index < posts.length - 1; index++) {
      const a = posts[index]
      const b = posts[index + 1]
      if (a === undefined || b === undefined) continue
      const rise = Math.min(pitch, upperY * 0.25)
      parts.push({
        role: 'brace',
        center: [x, upperY - rise / 2, (a + b) / 2],
        size: [braceSection, braceSection, Math.hypot(Math.abs(b - a), rise)],
        tiltX: Math.atan2(rise, Math.abs(b - a)),
      })
    }
  }

  if (lane.constructiveSystem !== 'cs3') return parts
  // cs3: a vertical braced plane across the closed end. Never on a
  // drive-through lane — there is no closed end to brace.
  if (lane.entryMode === 'drive-through') return parts

  const back = posts[posts.length - 1]
  if (back === undefined) return parts
  parts.push({
    role: 'brace',
    center: [0, lane.uprightHeight / 2, back],
    // Clear width, for the same reason the top beam uses it: the plane spans
    // between the post faces, it does not run through them.
    size: [lane.laneClearWidth, braceSection, braceSection],
  })
  return parts
}
