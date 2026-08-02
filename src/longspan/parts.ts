import {
  beamOffsetsZ,
  fittedLevels,
  frameCentersX,
  levelElevation,
  levelNeedsZtam,
  panelWidths,
  uprightSection,
} from './levels'
import type { LongspanLevel, LongspanNode } from './schema'
import { BEAM_PROFILES, SAFETY_PINS_PER_BEAM, SHELF_KINDS } from './standards'

/**
 * Every piece of steel and board in an M7 bay, as a list of boxes.
 *
 * One list, three consumers: the 3D builder extrudes it, the floorplan projects
 * it, the tests measure it. The interference discipline from `rack/parts.ts`
 * applies unchanged — and the trap it guards against is live here too, because
 * a beam sized to the bay PITCH would run frame-centre to frame-centre and bury
 * half an upright at each end.
 */

export type LongspanPartRole =
  | 'upright'
  | 'footplate'
  | 'brace'
  | 'beam'
  | 'shelf'
  | 'hm-support'
  | 'safety-pin'
  | 'ztam-clamp'
  | 'hang-rail'

export type LongspanPart = {
  role: LongspanPartRole
  center: [number, number, number]
  size: [number, number, number]
  tiltX?: number
  tiltZ?: number
  pattern?: 'slots' | 'mesh'
  /** Which shelf this is, so the builder can colour board apart from mesh
   *  without asking the node a second time. */
  shelfKind?: LongspanLevel['shelfKind']
}

export type LongspanDetail = 'full' | 'simple'

/** ASSUMPTION. Baseplate thickness — the catalogue publishes plan sizes only. */
const FOOTPLATE_THICKNESS = 0.01
/** ASSUMPTION. A safety pin reads at about this size at 1 : 1. */
const PIN_SIZE = 0.018
/** ASSUMPTION. Z-TAM clamp block. */
const ZTAM_SIZE = 0.04
/** ASSUMPTION. PK support bracket under an HM shelf corner. */
const PK_SUPPORT = 0.05
/** ASSUMPTION. Hanging rail diameter, drawn as a square section. */
const HANG_RAIL = 0.03
/** ASSUMPTION. Cross-brace section. */
const BRACE_SECTION = 0.025

export type FrameOmission = { omitRight: boolean }

export function longspanParts(
  bay: LongspanNode,
  detail: LongspanDetail = 'full',
  omission: FrameOmission = { omitRight: false },
): LongspanPart[] {
  const parts: LongspanPart[] = []
  const [leftX, rightX] = frameCentersX(bay)
  const lines = omission.omitRight ? [leftX] : [leftX, rightX]
  const upright = uprightSection(bay)
  const beam = BEAM_PROFILES[bay.beamProfile]

  // ── Frames ────────────────────────────────────────────────────────────────
  //
  // Two posts per frame line, front and back, at the frame depth. Perforations
  // are texture, not geometry — a 2.5 m frame punched at 50 mm is fifty slots
  // per face and drawing them as boxes would dwarf everything else in the bay.
  const postZ = [-bay.frameDepth / 2 + upright.depth / 2, bay.frameDepth / 2 - upright.depth / 2]
  for (const x of lines) {
    for (const z of postZ) {
      parts.push({
        role: 'upright',
        center: [x, bay.frameHeight / 2, z],
        size: [upright.width, bay.frameHeight, upright.depth],
        pattern: 'slots',
      })
      parts.push({
        role: 'footplate',
        center: [x, FOOTPLATE_THICKNESS / 2, z],
        size: [upright.width * 1.5, FOOTPLATE_THICKNESS, upright.depth * 1.4],
      })
    }
    // The frame's own diagonal, in its Y–Z plane. Always present: a frame
    // without it is two loose posts, which is not a product.
    if (detail === 'full') {
      const rise = Math.min(bay.frameHeight * 0.9, bay.frameDepth * 3)
      parts.push({
        role: 'brace',
        center: [x, bay.frameHeight / 2, 0],
        size: [BRACE_SECTION, BRACE_SECTION, Math.hypot(bay.frameDepth, rise)],
        tiltX: Math.atan2(rise, bay.frameDepth),
      })
    }
  }

  // ── Levels ────────────────────────────────────────────────────────────────
  for (const level of fittedLevels(bay)) {
    const surface = levelElevation(level)

    if (level.structure === 'reinforced-hm') {
      parts.push(...hmLevel(bay, surface, lines))
      continue
    }

    // Beams. Length is the CLEAR bay length: a beam sized to the pitch runs
    // centre to centre and buries half an upright at each end — the bug
    // `rack/parts.ts` documents, invisible without flying the camera inside.
    const beamTop =
      level.structure === 'beam-only' || level.structure === 'hanging'
        ? surface
        : surface - SHELF_KINDS[level.shelfKind].thickness

    for (const z of beamOffsetsZ(bay, level)) {
      parts.push({
        role: 'beam',
        center: [0, beamTop - beam.height / 2, z],
        size: [bay.bayLength, beam.height, beam.depth],
      })

      // CATALOG: two safety pins per beam, one at each connector. Full tier
      // only — at distance they are sub-pixel and there are two per beam per
      // level per run.
      if (detail === 'full') {
        for (const sign of [-1, 1] as const) {
          for (let pin = 0; pin < SAFETY_PINS_PER_BEAM / 2; pin++) {
            parts.push({
              role: 'safety-pin',
              center: [sign * (bay.bayLength / 2 - PIN_SIZE), beamTop - beam.height / 2, z],
              size: [PIN_SIZE, PIN_SIZE, beam.depth * 1.2],
            })
          }
        }
      }
    }

    if (level.structure === 'beam-only') continue

    if (level.structure === 'hanging') {
      // A garment rail spans the bay between the two beams.
      parts.push({
        role: 'hang-rail',
        center: [0, beamTop - beam.height - HANG_RAIL / 2, 0],
        size: [bay.bayLength, HANG_RAIL, HANG_RAIL],
      })
      continue
    }

    // Shelf panels, side by side. A galvanised picking level carries several
    // ~150 / 300 mm modules; chipboard and mesh are normally one panel.
    const shelf = SHELF_KINDS[level.shelfKind]
    const widths = panelWidths(bay, level)
    let cursor = -bay.bayLength / 2
    for (const width of widths) {
      parts.push({
        role: 'shelf',
        center: [cursor + width / 2, surface - shelf.thickness / 2, 0],
        size: [width, shelf.thickness, bay.frameDepth - beam.depth],
        pattern: level.shelfKind === 'mesh' ? 'mesh' : undefined,
        shelfKind: level.shelfKind,
      })
      cursor += width
    }

    // CATALOG: a chipboard shelf of 1.9 m or more takes Z-TAM clamps, which
    // hold the two beams flush against the board. Derived from the length, so
    // a bay widened past the threshold grows them without anyone ticking a box.
    if (detail === 'full' && levelNeedsZtam(bay, level)) {
      for (const z of beamOffsetsZ(bay, level)) {
        for (const sign of [-1, 1] as const) {
          parts.push({
            role: 'ztam-clamp',
            center: [sign * bay.bayLength * 0.25, surface - shelf.thickness - ZTAM_SIZE / 2, z],
            size: [ZTAM_SIZE, ZTAM_SIZE, ZTAM_SIZE],
          })
        }
      }
    }
  }

  // ── Down-aisle cross-bracing ──────────────────────────────────────────────
  //
  // A real X across the rear face, and it took a `tiltZ` on the shared emitter
  // to draw one. The first version leaned it with `tiltX` — the Y–Z lean — at
  // one degree, which drew a HORIZONTAL bar of `hypot(length, rise)`: on a
  // 1.9 m bay that is 2.76 m of steel sticking 40 cm into the neighbour at each
  // end, in two copies a degree apart that z-fight. Invisible without flying
  // the camera in, and measurable from this list, which is why the test
  // measures it.
  if (bay.crossBracing && detail === 'full' && !omission.omitRight) {
    const rise = bay.frameHeight * 0.8
    const angle = Math.atan2(rise, bay.bayLength)
    for (const direction of [1, -1] as const) {
      parts.push({
        role: 'brace',
        center: [0, bay.frameHeight / 2, -bay.frameDepth / 2 + upright.depth],
        size: [Math.hypot(bay.bayLength, rise), BRACE_SECTION, BRACE_SECTION],
        tiltZ: direction * angle,
      })
    }
  }

  return parts
}

/**
 * A reinforced HM level: no beams at all.
 *
 * The panel is one folded sheet carried at its four corners by PK supports that
 * hook into the upright's **side** slots — which is why its elevation snaps to
 * 25 mm rather than 50, and why nothing on this level touches the front face.
 *
 * The level descriptor is deliberately not a parameter: an HM level has no
 * shelf-kind choice (the panel *is* the HM sheet), no panel count (it is one
 * folded piece), and no MS centre beam (there are no beams). Taking the whole
 * descriptor and using none of it would suggest otherwise.
 */
function hmLevel(bay: LongspanNode, surface: number, lines: readonly number[]): LongspanPart[] {
  const parts: LongspanPart[] = []
  const shelf = SHELF_KINDS.hm
  const upright = uprightSection(bay)

  parts.push({
    role: 'shelf',
    center: [0, surface - shelf.thickness / 2, 0],
    size: [bay.bayLength, shelf.thickness, bay.frameDepth - upright.depth],
    shelfKind: 'hm',
  })

  for (const x of lines) {
    for (const sign of [-1, 1] as const) {
      parts.push({
        role: 'hm-support',
        center: [
          x + (x < 0 ? upright.width : -upright.width) / 2,
          surface - shelf.thickness - PK_SUPPORT / 2,
          sign * (bay.frameDepth / 2 - upright.depth),
        ],
        size: [PK_SUPPORT, PK_SUPPORT, PK_SUPPORT],
      })
    }
  }

  return parts
}
