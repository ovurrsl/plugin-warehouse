import * as THREE from 'three'
import { getCachedGeometry, releaseGeometry, retainGeometry } from '../conveyor/geometry-builder'
import { memoiseGeometryKey } from '../geometry-key-memo'
import { emitRackPart, type Sink, toLinear } from '../rack/geometry-builder'
import { beamOffsetsZ, fittedLevels, levelElevation, levelNeedsZtam } from './levels'
import {
  type FrameOmission,
  type LongspanDetail,
  type LongspanPartRole,
  longspanParts,
} from './parts'
import type { LongspanNode, ShelfKind } from './schema'

/**
 * One merged `BufferGeometry` per M7 *shape*.
 *
 * Same architecture as every other kind here, and the emitter, atlas, colour
 * conversion and cache all come from the same two shared modules the drive-in
 * lane uses. Nothing about M7 needs its own copy of any of that.
 */

/** Shelf colours are per finish, not per role — the fix the selective rack's
 *  decking needed, applied from the start here. */
const SHELF_COLORS: Record<ShelfKind, string> = {
  /** Chipboard. Unmistakable, which is the point. */
  chipboard: '#b08a55',
  /** Galvanised wire, bright — the atlas's mesh column darkens the openings. */
  mesh: '#ced7e2',
  /** Folded galvanised sheet. */
  'galvanised-picking': '#a9b2bd',
  /** HM is the same sheet in a heavier gauge; a touch darker so a mixed bay
   *  reads as two different products rather than one badly lit one. */
  hm: '#98a2ae',
}

const ROLE_COLORS: Record<Exclude<LongspanPartRole, 'upright' | 'beam' | 'shelf'>, string> = {
  footplate: '#334155',
  brace: '#94a3b8',
  /** The PK bracket under an HM corner — galvanised, like the shelf it holds. */
  'hm-support': '#8b9299',
  /** A safety pin is meant to be noticed during assembly. */
  'safety-pin': '#eab308',
  'ztam-clamp': '#475569',
  /** A chromed garment rail. */
  'hang-rail': '#c9ced6',
}

function buildFrom(
  bay: LongspanNode,
  detail: LongspanDetail,
  omission: FrameOmission,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const uprightColor = toLinear(bay.uprightColor)
  const beamColor = toLinear(bay.beamColor)

  for (const part of longspanParts(bay, detail, omission)) {
    const color =
      part.role === 'upright'
        ? uprightColor
        : part.role === 'beam'
          ? beamColor
          : part.role === 'shelf'
            ? toLinear(SHELF_COLORS[part.shelfKind ?? 'chipboard'])
            : toLinear(ROLE_COLORS[part.role])
    emitRackPart(sink, part, color)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sink.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(sink.normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(sink.colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(sink.uvs, 2))
  geometry.setIndex(sink.indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Identity of a bay's *shape*.
 *
 * The level list is encoded as what each **fitted** level actually builds — its
 * snapped elevation, its structure, its panel, its panel count, whether it took
 * an MS centre beam and whether it took Z-TAM clamps. That is what keeps the key
 * honest in both directions: a level above the frame reaches nothing and must
 * not split the cache, and a derived fitting (the clamps, the centre beam)
 * changes the mesh without being a field anyone could remember to list.
 */
function buildLongspanGeometryKey(
  bay: LongspanNode,
  detail: LongspanDetail,
  omission: FrameOmission = { omitRight: false },
): string {
  const levels = fittedLevels(bay).map((level) =>
    [
      levelElevation(level).toFixed(4),
      level.structure,
      level.structure === 'beam-only' || level.structure === 'hanging' ? '-' : level.shelfKind,
      level.panels,
      beamOffsetsZ(bay, level).length,
      levelNeedsZtam(bay, level) ? 'z' : '-',
    ].join(':'),
  )

  return [
    detail,
    omission.omitRight ? 'L' : 'LR',
    bay.bayLength.toFixed(5),
    bay.frameDepth.toFixed(5),
    bay.frameHeight.toFixed(5),
    bay.uprightProfile,
    bay.beamProfile,
    bay.crossBracing ? 'x' : '-',
    bay.uprightColor,
    bay.beamColor,
    levels.join('|'),
  ].join('#')
}

export function getLongspanGeometry(
  bay: LongspanNode,
  detail: LongspanDetail,
  omission: FrameOmission = { omitRight: false },
): THREE.BufferGeometry {
  return getCachedGeometry(longspanGeometryKey(bay, detail, omission), () =>
    buildFrom(bay, detail, omission),
  )
}

export function retainLongspanGeometry(
  bay: LongspanNode,
  detail: LongspanDetail,
  omission: FrameOmission = { omitRight: false },
): string {
  return retainGeometry(longspanGeometryKey(bay, detail, omission))
}

export { releaseGeometry as releaseLongspanGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`; çıplak üretici: `buildLongspanGeometryKey`. */
export const longspanGeometryKey = memoiseGeometryKey(
  buildLongspanGeometryKey,
  (detail, omission) => `${detail}:${omission?.omitRight ? 'L' : 'LR'}`,
)
