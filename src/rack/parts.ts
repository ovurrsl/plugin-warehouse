import type { PalletRackNode } from './schema'
import {
  bayCenterX,
  beamedLevels,
  depthPositionZ,
  frameCentersX,
  levelBeamHeight,
  levelHasShelf,
  levelSurfaceY,
  palletSupportBarCount,
  slotOffsetsX,
  storageLevelsPresent,
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
/**
 * Baseplate thickness.
 *
 * Named because the ground beam has to clear it: the plate is wider than the
 * post it carries, so it reaches into the bay exactly where a ground beam's end
 * connector comes down.
 */
const FOOTPLATE_HEIGHT = 0.02
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
export function rackParts(
  rack: PalletRackNode,
  detail: RackDetail,
  /**
   * Leave the right frame to the bay standing against it.
   *
   * Bays share their frames, so a run of them must not each build both: at one
   * bay pitch the right frame of one lands exactly on the left frame of the
   * next, and building both puts two posts in the same place — doubled steel,
   * doubled perforation texture, z-fighting on every coincident face. Building
   * the left always and the right only when nothing abuts gives a run of N bays
   * N+1 frames, which is how racking is really built. See `./neighbours`.
   */
  hasRightNeighbour = false,
): RackPart[] {
  const parts: RackPart[] = []
  const full = detail === 'full'
  const frames = hasRightNeighbour ? [frameCentersX(rack)[0]] : frameCentersX(rack)
  const levels = beamedLevels(rack)
  const present = new Set(storageLevelsPresent(rack))
  const { uprightWidth, uprightDepth, depth, uprightHeight, beamThickness } = rack
  const postOffset = depth / 2 - uprightDepth / 2

  for (let position = 1; position <= rack.depthPositions; position++) {
    const centerZ = depthPositionZ(rack, position)
    const postZ = [centerZ + postOffset, centerZ - postOffset]

    frames.forEach((x) => {
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
            center: [x, FOOTPLATE_HEIGHT / 2, z],
            size: [uprightWidth + 0.053, FOOTPLATE_HEIGHT, uprightDepth + 0.039],
          })
        }
      })

      if (full && rack.bracing !== 'open') {
        pushFrameBracing(parts, x, centerZ, rack)
      }
    })

    const centerX = bayCenterX()
    for (const level of levels) {
      // A tunnel omits the lowest levels. Intersected with the beamed levels
      // so the bay can never gain one the frame does not carry.
      if (!present.has(level)) continue
      const beamHeight = levelBeamHeight(rack, level)
      const surface = levelSurfaceY(rack, level)
      // Every other level hangs its beam under the load surface; a ground
      // beam has no surface above it to hang from. It stands on its own
      // connectors, clear of the baseplate — the hooks reach below the
      // section, and the plate is wider than the post, so a ground beam set
      // from the floor buried its connectors in both.
      const beamY =
        level === 0 ? FOOTPLATE_HEIGHT + CONNECTOR_REACH + beamHeight / 2 : surface - beamHeight / 2
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
          // The endplate welded to the beam's end, whose hooks engage the
          // upright's punched face.
          //
          // It occupies the beam's own last stretch rather than reaching
          // past it. Lapping outward — which is what "the plate sits against
          // the post" suggests — drove it three millimetres into the post's
          // near flange, the full thickness of the folded section. Nothing
          // in the model said so, and because the plate carries a beam-ish
          // colour and sits exactly where a beam ends, what it looked like
          // on screen was the beam itself running into the upright.
          for (const end of [-1, 1]) {
            parts.push({
              role: 'connector',
              center: [
                centerX + (end * (rack.bayClearWidth - CONNECTOR_LAP)) / 2,
                beamY,
                // Exactly the beam's thickness and exactly its Z. What makes
                // the plate legible is its height — the hooks reach above
                // and below the section, which is what you actually see on a
                // real beam end. Standing it proud instead put it 4 mm into
                // the decking, which begins at the beams' inner faces.
                beamZ,
              ],
              size: [CONNECTOR_LAP, beamHeight + 2 * CONNECTOR_REACH, beamThickness],
            })
          }
        }
      }

      const decked = levelHasShelf(rack, level) && rack.decking !== 'open'

      if (full && decked) {
        const thickness = shelfThickness(rack, level, rack.decking)
        // Flush-mounted: the panel drops between the beams and its top
        // finishes level with them, so the load surface stays exactly where
        // `levelSurfaceY` says it is and pallets do not float on a lip.
        parts.push({
          role: 'shelf',
          center: [centerX, beamTop - thickness / 2, centerZ],
          size: [rack.bayClearWidth, thickness, depth - 2 * beamThickness],
        })
      }

      // Bars and decking are alternatives, not layers. Both mount on top of
      // the beams, so a decked level fitted with bars had the two occupying
      // the same six millimetres — and the reason it is a real rule rather
      // than a drawing tidy-up is that a deck already carries the pallet
      // whichever way round it sits, which is the entire job of the bars.
      if (full && !decked) {
        const bars = palletSupportBarCount(rack)
        if (bars > 0) {
          const barHeight = 0.03
          for (const offset of slotOffsetsX(rack)) {
            const spread = ((bars - 1) / 2) * 0.25
            for (let bar = 0; bar < bars; bar++) {
              parts.push({
                role: 'support-bar',
                center: [centerX + offset - spread + bar * 0.25, beamTop - barHeight / 2, centerZ],
                size: [0.04, barHeight, depth - 2 * beamThickness],
              })
            }
          }
        }
      }
    }
  }

  // Row spacers are gone with rows. They were real hardware — a tie between two
  // bays standing spine to spine — but they cannot be expressed by either bay
  // alone, and a bay is a node now. Modelling them would need a kind of their
  // own rather than a part one node guesses at.

  return parts
}

/**
 * There is no part budget any more, and that is worth saying out loud.
 *
 * A block used to be able to ask for 40 bays × 20 rows × 4 levels — about 39 000
 * boxes and 41 MB in one buffer — so the full tier fell back to the silhouette
 * past 12 000 parts and the inspector warned about it. A bay is a node now, and
 * the worst a single one can emit is a few hundred boxes: fifteen levels,
 * double-deep, fully braced and decked. The ceiling cannot be reached, so the
 * fallback and its warning are gone rather than kept as reassurance.
 *
 * The cost moved, it did not vanish. It is draw calls now, and `renderer.tsx`
 * pays it with LOD.
 */

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
