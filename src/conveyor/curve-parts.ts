import {
  CROSSBAR_CLEARANCE_M,
  CROSSBAR_SECTION_M,
  FOOTPLATE_OVERHANG_M,
  FOOTPLATE_THICKNESS_M,
  LEG_SECTION_M,
  SIDE_GUIDE_SECTION_M,
  SIDE_GUIDE_THICKNESS_M,
  SIDE_PROFILE_DEPTH_M,
} from './constants'
import {
  angleRad,
  arcPointLocal,
  frameBottomY,
  legHeightM,
  outerRadiusM,
  rollerStepRad,
  supportAngles,
  zoneCount,
} from './curve-metrics'
import type { ConveyorCurveNode } from './curve-schema'
import type { ConveyorDetail, ConveyorPartRole } from './parts'

/**
 * Every piece of a curve module, as boxes that may be turned about Y.
 *
 * The straight's parts are axis-aligned and its emitter has no rotation, which
 * is correct for a bed that runs in a straight line and useless for one that
 * bends. So a curve part carries its own heading, and the kerbs following the
 * arc are short straight lengths at increasing angles — which is also how a
 * curve is really made: rolled sections are approximated by segments, not bent
 * from one piece.
 *
 * **The deck is not in this list.** An annular sector is not a box, and drawing
 * it as one would either square off the bend or bury it in the kerbs. It is
 * emitted directly into the same sink by `./curve-geometry`, as a strip of
 * quads carrying the roller stripe — one tile per angular step, which is what
 * makes the painted rollers land where tapered ones would.
 */

export type CurvePart = {
  /** No `deck`: a curve's bed is an annular sector rather than a box, so it is
   *  not in this list at all and the type says so. */
  role: Exclude<ConveyorPartRole, 'deck'>
  center: [number, number, number]
  size: [number, number, number]
  /** Heading in the node's local plan frame. A kerb segment follows the arc. */
  rotationY: number
}

export function curveParts(
  curve: ConveyorCurveNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): CurvePart[] {
  const parts: CurvePart[] = []
  const full = detail === 'full'
  const sweep = angleRad(curve)
  const step = rollerStepRad(curve)
  const bottom = frameBottomY(curve)
  const top = curve.transportHeight
  const inner = curve.innerRadius
  const outer = outerRadiusM(curve)
  const handSign = curve.handed === 'left' ? 1 : -1

  /**
   * A segment lying along the arc at a given radius, spanning one angular step.
   *
   * Slightly over-long, by the chord-to-arc shortfall, so consecutive segments
   * meet at their corners rather than leaving a visible notch on the outside of
   * every bend. The overlap is inside the steel and costs nothing.
   */
  const arcSegment = (
    role: CurvePart['role'],
    radius: number,
    theta: number,
    thickness: number,
    height: number,
    centreY: number,
  ): CurvePart => {
    const mid = theta + step / 2
    const [x, z] = arcPointLocal(curve, radius, mid)
    // The chord across one step, plus enough to close the corner.
    const chord = 2 * radius * Math.sin(step / 2)
    return {
      role,
      center: [x, centreY, z],
      size: [chord * 1.02, height, thickness],
      // The tangent at the midpoint, turned by the hand of the bend.
      rotationY: handSign * mid,
    }
  }

  // ── Kerbs ─────────────────────────────────────────────────────────────────
  // The formed inner and outer sides. Their top edge is flush with the roller
  // top, so a box crosses from a straight onto the bend without meeting a lip.
  const kerbCentreY = bottom + SIDE_PROFILE_DEPTH_M / 2
  for (let index = 0; index < Math.round(sweep / step); index++) {
    const theta = index * step
    parts.push(
      arcSegment(
        'frame',
        inner + SIDE_GUIDE_THICKNESS_M / 2,
        theta,
        SIDE_GUIDE_THICKNESS_M,
        SIDE_PROFILE_DEPTH_M,
        kerbCentreY,
      ),
    )
    parts.push(
      arcSegment(
        'frame',
        outer - SIDE_GUIDE_THICKNESS_M / 2,
        theta,
        SIDE_GUIDE_THICKNESS_M,
        SIDE_PROFILE_DEPTH_M,
        kerbCentreY,
      ),
    )
  }

  // ── End plates ────────────────────────────────────────────────────────────
  // What the bend is bolted to its neighbours through, at both ends whatever
  // abuts — unlike the support, there really are two.
  if (full) {
    for (const theta of [0, sweep]) {
      const radius = (inner + outer) / 2
      const [x, z] = arcPointLocal(curve, radius, theta)
      parts.push({
        role: 'end-plate',
        center: [x, kerbCentreY, z],
        size: [SIDE_GUIDE_THICKNESS_M, SIDE_PROFILE_DEPTH_M * 0.8, (outer - inner) * 0.9],
        rotationY: handSign * theta,
      })
    }
  }

  // ── Supports ──────────────────────────────────────────────────────────────
  // A bend is held from its outer edge, where the load goes: a box on a curve
  // is thrown outward, and a support under the inner kerb carries almost none
  // of it.
  const legHeight = legHeightM(curve)
  const stations = supportAngles(curve)
  const lastStation = stations.length - 1

  stations.forEach((theta, index) => {
    if (hasDownstreamNeighbour && index === lastStation) return
    if (legHeight <= 0) return

    for (const radius of [inner + LEG_SECTION_M, outer - LEG_SECTION_M]) {
      const [x, z] = arcPointLocal(curve, radius, theta)
      parts.push({
        role: 'leg',
        center: [x, legHeight / 2, z],
        size: [LEG_SECTION_M, legHeight, LEG_SECTION_M],
        rotationY: handSign * theta,
      })
      if (full) {
        parts.push({
          role: 'footplate',
          center: [x, FOOTPLATE_THICKNESS_M / 2, z],
          size: [
            LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
            FOOTPLATE_THICKNESS_M,
            LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
          ],
          rotationY: handSign * theta,
        })
      }
    }

    if (legHeight > CROSSBAR_CLEARANCE_M + 0.1) {
      const [x, z] = arcPointLocal(curve, (inner + outer) / 2, theta)
      parts.push({
        role: 'crossbar',
        center: [x, CROSSBAR_CLEARANCE_M, z],
        size: [CROSSBAR_SECTION_M, CROSSBAR_SECTION_M, outer - inner - LEG_SECTION_M * 2],
        rotationY: handSign * theta,
      })
    }
  })

  // ── Guides ────────────────────────────────────────────────────────────────
  // The outer one earns its keep on a bend in a way it does not on a straight:
  // a box leaving a curve is travelling outward, and the rail is what turns it.
  if (full && curve.sideGuide !== 'none') {
    const radii: number[] = []
    if (curve.sideGuide === 'inner' || curve.sideGuide === 'both') {
      radii.push(inner + SIDE_GUIDE_THICKNESS_M / 2)
    }
    if (curve.sideGuide === 'outer' || curve.sideGuide === 'both') {
      radii.push(outer - SIDE_GUIDE_THICKNESS_M / 2)
    }
    const guideY = top + curve.sideGuideHeight - SIDE_GUIDE_SECTION_M / 2

    for (const radius of radii) {
      for (let index = 0; index < Math.round(sweep / step); index++) {
        parts.push(
          arcSegment(
            'guide',
            radius,
            index * step,
            SIDE_GUIDE_THICKNESS_M,
            SIDE_GUIDE_SECTION_M,
            guideY,
          ),
        )
      }
      for (const theta of stations) {
        const [x, z] = arcPointLocal(curve, radius, theta)
        parts.push({
          role: 'guide-bracket',
          center: [x, top + curve.sideGuideHeight / 2 - SIDE_GUIDE_SECTION_M / 4, z],
          size: [SIDE_GUIDE_THICKNESS_M, curve.sideGuideHeight, SIDE_GUIDE_THICKNESS_M],
          rotationY: handSign * theta,
        })
      }
    }
  }

  // ── Drive ─────────────────────────────────────────────────────────────────
  // Zoned rather than one motor for the line: a bend that accumulates does it
  // in zones, and each carries its own drive under the outer kerb.
  if (full && zoneCount(curve) > 0) {
    for (let zone = 0; zone < zoneCount(curve); zone++) {
      const theta = ((zone + 0.5) / zoneCount(curve)) * sweep
      const [x, z] = arcPointLocal(curve, outer + 0.09, theta)
      parts.push({
        role: 'motor',
        center: [x, bottom - 0.05, z],
        size: [0.26, 0.18, 0.16],
        rotationY: handSign * theta,
      })
    }
  }

  return parts
}
