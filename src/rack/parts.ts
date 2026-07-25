import type { PalletRackNode } from './schema'
import {
  bayCenterX,
  bayDecking,
  bayStorageLevels,
  beamedLevels,
  depthPositionZ,
  frameCentersX,
  isBaySkipped,
  isFramePresent,
  levelBeamHeight,
  levelHasShelf,
  levelSurfaceY,
  palletSupportBarCount,
  slotOffsetsX,
} from './slots'

/**
 * Every piece of steel in a rack, as a list of boxes.
 *
 * One list, three consumers: the 3D builder extrudes it, the floorplan projects
 * it, and the tests measure it. That is the only way "the plan matches the
 * model" can be a fact rather than a hope — before this the two files each
 * computed their own frame positions from the same inputs, which agrees right
 * up until one of them is edited.
 *
 * It is also what makes interference testable. The version this replaces gave
 * every beam a length of `bayClearWidth + uprightWidth` centred on its bay, so
 * each beam ran from the centreline of one post to the centreline of the next
 * and buried half an upright width in the steel at both ends. Nothing in the
 * code said so; you had to fly the camera into the frame to see it. Now the
 * parts are inspectable and a test refuses any overlap between roles that
 * cannot physically share space.
 */

export type RackPartRole =
  | 'upright'
  | 'footplate'
  | 'brace'
  | 'beam'
  | 'connector'
  | 'shelf'
  | 'support-bar'
  | 'row-spacer'

export type RackPart = {
  role: RackPartRole
  center: [number, number, number]
  size: [number, number, number]
  /** Rotation about X in radians. Only frame bracing uses it. */
  tiltX?: number
  /**
   * Carries the punched slot pattern.
   *
   * Set on the web and flanges of an upright, which is where the perforations
   * actually are. The pattern is a texture rather than geometry: the old
   * renderer drew each slot as an instanced box, which on a 5 m post is 65
   * slots x 2 columns x 8 posts — about a thousand extra boxes per rack, and at
   * warehouse scale that alone costs more than everything else in the model
   * combined.
   */
  perforated?: boolean
}

/** Wall thickness of the upright's cold-formed section. */
const SECTION_WALL = 0.003
/** Width a beam's end connector laps onto the upright face. */
const CONNECTOR_LAP = 0.02
/** How far the connector's hooks reach past the beam, above and below. */
const CONNECTOR_REACH = 0.015

export type RackDetail = 'full' | 'simple'

/**
 * `simple` keeps posts and beams and drops everything else. Those are the parts
 * that stop reading past a few tens of metres, and in a warehouse almost every
 * rack is always at that distance.
 */
export function rackParts(rack: PalletRackNode, detail: RackDetail): RackPart[] {
  const parts: RackPart[] = []
  const full = detail === 'full'
  const frames = frameCentersX(rack)
  const levels = beamedLevels(rack)
  const { uprightWidth, uprightDepth, depth, uprightHeight, beamThickness } = rack
  const postOffset = depth / 2 - uprightDepth / 2

  for (let row = 1; row <= rack.rowCount; row++) {
    for (let position = 1; position <= rack.depthPositions; position++) {
      const centerZ = depthPositionZ(rack, row, position)
      const postZ = [centerZ + postOffset, centerZ - postOffset]

      frames.forEach((x, frameIndex) => {
        // A frame only stands where a bay needs it. Erecting all of them
        // regardless leaves a post in the gap a skip was cut for.
        if (!isFramePresent(rack, row, frameIndex)) return
        postZ.forEach((z, side) => {
          if (full) {
            pushUprightSection(parts, x, z, rack, side === 0 ? 1 : -1)
          } else {
            parts.push({
              role: 'upright',
              center: [x, uprightHeight / 2, z],
              size: [uprightWidth, uprightHeight, uprightDepth],
            })
          }

          if (full) {
            // Catalogue footplates are wider than the post they carry — 175 x
            // 119 mm under a 122 x 80 upright — so they overhang it by about
            // 26 mm a side. Real, and the reason the built mesh is slightly
            // wider at the floor than the declared footprint.
            parts.push({
              role: 'footplate',
              center: [x, 0.01, z],
              size: [uprightWidth + 0.053, 0.02, uprightDepth + 0.039],
            })
          }
        })

        if (full && rack.bracing !== 'open') {
          pushFrameBracing(parts, x, centerZ, rack)
        }
      })

      for (let bay = 1; bay <= rack.bayCount; bay++) {
        if (isBaySkipped(rack, row, bay)) continue
        const centerX = bayCenterX(rack, bay)
        // Per-bay levels: a tunnel omits the lowest ones, an override can stop
        // the bay short. Intersected with the run's beamed levels so a bay can
        // never gain a level the frame does not carry.
        const bayLevels = new Set(bayStorageLevels(rack, row, bay))
        for (const level of levels) {
          if (!bayLevels.has(level)) continue
          const beamHeight = levelBeamHeight(rack, level)
          const surface = levelSurfaceY(rack, level)
          // Every other level hangs its beam under the load surface; a ground
          // beam has no surface above it to hang from. It sits on its own
          // connectors rather than on the floor, because the hooks reach below
          // the beam and would otherwise be buried in the slab.
          const beamY = level === 0 ? beamHeight / 2 + CONNECTOR_REACH : surface - beamHeight / 2
          const beamTop = beamY + beamHeight / 2

          for (const sign of [1, -1]) {
            // Outer face flush with the frame's outer face, which is where a
            // beam actually sits — its connector bolts to the post's front.
            const beamZ = centerZ + sign * (depth / 2 - beamThickness / 2)
            parts.push({
              role: 'beam',
              // Spans the clear width exactly, so its ends meet the upright
              // faces instead of running through them.
              center: [centerX, beamY, beamZ],
              size: [rack.bayClearWidth, beamHeight, beamThickness],
            })

            if (full) {
              // End connectors lap the post face, the way the real endplate
              // does. Sized so they stop at the post centreline rather than
              // passing through to the far side.
              const proud = 0.004
              for (const end of [-1, 1]) {
                parts.push({
                  role: 'connector',
                  center: [
                    centerX + (end * (rack.bayClearWidth + CONNECTOR_LAP)) / 2,
                    beamY,
                    // Thicker than the beam it wraps, but grown inward only:
                    // the beam is already flush with the frame's outer face, so
                    // a symmetric endplate would stand proud of the declared
                    // footprint and let two runs touch while the editor still
                    // called the placement clear.
                    beamZ - (sign * proud) / 2,
                  ],
                  size: [CONNECTOR_LAP, beamHeight + 2 * CONNECTOR_REACH, beamThickness + proud],
                })
              }
            }
          }

          if (full && levelHasShelf(rack, level) && bayDecking(rack, row, bay) !== 'open') {
            const thickness = shelfThickness(rack, level, bayDecking(rack, row, bay))
            // Flush-mounted: the panel drops between the beams and its top
            // finishes level with them, so the load surface stays exactly where
            // `levelSurfaceY` says it is and pallets do not float on a lip.
            parts.push({
              role: 'shelf',
              center: [centerX, beamTop - thickness / 2, centerZ],
              size: [rack.bayClearWidth, thickness, depth - 2 * beamThickness],
            })
          }

          if (full) {
            const bars = palletSupportBarCount(rack)
            if (bars > 0) {
              const barHeight = 0.03
              for (const offset of slotOffsetsX(rack)) {
                const spread = ((bars - 1) / 2) * 0.25
                for (let bar = 0; bar < bars; bar++) {
                  parts.push({
                    role: 'support-bar',
                    center: [
                      centerX + offset - spread + bar * 0.25,
                      beamTop - barHeight / 2,
                      centerZ,
                    ],
                    size: [0.04, barHeight, depth - 2 * beamThickness],
                  })
                }
              }
            }
          }
        }
      }
    }
  }

  // Spacers tie the two runs of a back-to-back pair together across the spine.
  // Only *within* a pair: rows either side of a working aisle are separate
  // structures, and a tie spanning an aisle would be a bar through the traffic.
  if (full && rack.rowPattern === 'back-to-back') {
    for (let row = 2; row <= rack.rowCount; row += 2) {
      const innerFront = depthPositionZ(rack, row - 1, rack.depthPositions) - depth / 2
      const innerBack = depthPositionZ(rack, row, rack.depthPositions) + depth / 2
      const spanZ = innerFront - innerBack
      const midZ = (innerFront + innerBack) / 2
      frames.forEach((x, frameIndex) => {
        // Needs a post at both ends. A skip that removed one row's end frame
        // would otherwise leave a spacer reaching out to nothing.
        if (!isFramePresent(rack, row - 1, frameIndex)) return
        if (!isFramePresent(rack, row, frameIndex)) return
        for (const y of [uprightHeight * 0.15, uprightHeight * 0.85]) {
          parts.push({
            role: 'row-spacer',
            center: [x, y, midZ],
            size: [uprightWidth * 0.6, 0.05, spanZ],
          })
        }
      })
    }
  }

  return parts
}

/**
 * Boxes a single merged geometry is allowed to hold.
 *
 * Each box costs 24 vertices × 11 floats, so 12 000 of them is about 12 MB of
 * buffer and 144 000 triangles — already a large single mesh, and the point at
 * which one block starts to cost more than the draw calls merging it saved.
 *
 * A block can ask for far more than that: 40 bays × 20 rows × 4 levels comes to
 * roughly 39 000 boxes and 41 MB. Rather than build that, the full tier falls
 * back to the silhouette — one box per post instead of five, and no footplates,
 * bracing, connectors or decking. The block still draws, still in one call; it
 * just stops carrying detail nobody can resolve from where a block that size is
 * looked at. `exceedsPartBudget` reports it so the inspector can say so instead
 * of leaving the user to notice the bracing went missing.
 */
export const PART_BUDGET = 12_000

/**
 * Boxes the full tier would emit.
 *
 * Memoised on the node object, because building the list in order to count it is
 * exactly the work the budget exists to avoid and the inspector asks on every
 * render. The store replaces nodes rather than mutating them, so the key is
 * exact: a stale count is not reachable.
 */
const partCounts = new WeakMap<PalletRackNode, number>()

export function fullPartCount(rack: PalletRackNode): number {
  const cached = partCounts.get(rack)
  if (cached !== undefined) return cached
  const count = rackParts(rack, 'full').length
  partCounts.set(rack, count)
  return count
}

export function exceedsPartBudget(rack: PalletRackNode): boolean {
  return fullPartCount(rack) > PART_BUDGET
}

/** Chipboard is three times a steel or mesh panel and it shows at the edge. */
function shelfThickness(
  rack: PalletRackNode,
  level: number,
  decking: PalletRackNode['decking'],
): number {
  if (levelBeamHeight(rack, level) === rack.pickingBeamHeight) return rack.pickingShelfThickness
  return decking === 'timber' ? 0.018 : 0.006
}

/**
 * A lipped C-section post, the shape racking uprights actually are: web on the
 * closed outer face, two flanges reaching inward, and the return lips that
 * stiffen them. Close up you can see through the frame between the lips.
 *
 * `facing` is +1 when the open side looks toward −Z and −1 when it looks toward
 * +Z, so the two posts of a frame mirror each other and both open inward.
 */
function pushUprightSection(
  parts: RackPart[],
  x: number,
  z: number,
  rack: PalletRackNode,
  facing: number,
): void {
  const { uprightWidth: width, uprightDepth: depth, uprightHeight: height } = rack
  const lip = Math.min(0.02, width / 4)
  const midY = height / 2

  // The web is the face the beam connectors hook into, so it carries the slots.
  parts.push({
    role: 'upright',
    center: [x, midY, z + facing * (depth / 2 - SECTION_WALL / 2)],
    size: [width, height, SECTION_WALL],
    perforated: true,
  })

  for (const side of [-1, 1]) {
    parts.push({
      role: 'upright',
      center: [x + (side * (width - SECTION_WALL)) / 2, midY, z],
      size: [SECTION_WALL, height, depth - SECTION_WALL],
      perforated: true,
    })
    parts.push({
      role: 'upright',
      center: [x + side * (width / 2 - lip / 2), midY, z - facing * (depth / 2 - SECTION_WALL / 2)],
      size: [lip, height, SECTION_WALL],
    })
  }
}

/**
 * Frame bracing, between nodes clear of both ends of the post — the lowest
 * above the footplate, the highest below the top of the frame. That is how a
 * frame is built, and it also keeps the diagonals, whose rotated cross-section
 * reaches past their end nodes, from poking through the floor.
 */
function pushFrameBracing(
  parts: RackPart[],
  x: number,
  centerZ: number,
  rack: PalletRackNode,
): void {
  const braceBottom = 0.15
  const braceTop = Math.max(braceBottom + 0.3, rack.uprightHeight - 0.1)
  const bracedHeight = braceTop - braceBottom
  const panels = Math.max(3, Math.round(bracedHeight / 0.9))
  const step = bracedHeight / panels
  const span = rack.depth - rack.uprightDepth
  const length = Math.hypot(step, span)
  // The brace's local +Y must land on the (step, span) diagonal, so the angle
  // is atan2(span, step). Its complement — the easy slip — swaps the two
  // projections and drives the bottom brace through the floor.
  const angle = Math.atan2(span, step)

  for (const y of [braceBottom, braceTop]) {
    parts.push({ role: 'brace', center: [x, y, centerZ], size: [0.03, 0.03, span] })
  }

  for (let panel = 0; panel < panels; panel++) {
    const midY = braceBottom + (panel + 0.5) * step
    const sign = panel % 2 === 0 ? 1 : -1
    parts.push({
      role: 'brace',
      center: [x, midY, centerZ],
      size: [0.03, length, 0.03],
      tiltX: sign * angle,
    })
    if (rack.bracing === 'x-bracing') {
      parts.push({
        role: 'brace',
        center: [x, midY, centerZ],
        size: [0.03, length, 0.03],
        tiltX: -sign * angle,
      })
    }
  }
}
