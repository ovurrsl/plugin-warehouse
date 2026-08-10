import * as THREE from 'three'
import { getCachedGeometry, releaseGeometry, retainGeometry } from '../conveyor/geometry-builder'
import { memoiseGeometryKey } from '../geometry-key-memo'
import { emitRackPart, type Sink, toLinear } from '../rack/geometry-builder'
import {
  clearOpening,
  effectivePostPitchZ,
  fittedLevelCount,
  railTopY,
  topBeamUndersideY,
  totalDepth,
} from './lanes'
import { type DriveInDetail, type DriveInPartRole, driveInParts, type FrameOmission } from './parts'
import type { DriveInRackNode } from './schema'

/**
 * One merged `BufferGeometry` per drive-in *shape*.
 *
 * The same architecture every other kind in this package uses, and the same
 * reason: a four-deep three-level lane is roughly eighty separate boxes, so
 * drawing them as meshes would cost eighty draw calls per lane and a block of
 * ten lanes eight hundred. Merged, a lane costs one — and because the key is
 * the *shape* rather than the node, a block of ten identical lanes resolves to
 * one geometry that all ten share.
 *
 * The emitter, the atlas and the colour conversion come from `rack/`: drive-in
 * is steel of the same family, drawn with the same material and reading the
 * same punched-slot column. The cache comes from `conveyor/`, which is
 * kind-agnostic by design and already holds the shapes of eleven kinds — a
 * second pool would mean a second copy of the eviction rule and a limit that
 * meant half of what it said.
 */

/**
 * Role colours.
 *
 * `upright`, `top-beam` and `rail` are absent because they read their colour
 * from the node — the schema exposes all three, and a lane painted to match a
 * neighbouring selective run must be able to say so.
 */
const ROLE_COLORS: Record<Exclude<DriveInPartRole, 'upright' | 'top-beam' | 'rail'>, string> = {
  footplate: '#334155',
  brace: '#94a3b8',
  /** The welded wedge at a rail–post crossing — beam-orange family, darker so
   *  it reads as a separate fitting rather than as part of the rail. */
  bracket: '#c2410c',
  /** Floor guides are galvanised angle, like the rails but duller — they are
   *  walked on and scuffed. */
  guide: '#8b9299',
  /** The impact reinforcer is the one part a driver is meant to notice. */
  reinforcer: '#eab308',
  /** Giriş ortalayıcısı: sürücünün nişan aldığı ağız, uyarı sarısı ailesinden
   *  ama takviyeden sönük — ikisi yan yana duruyor ve karışmamalılar. */
  centraliser: '#ca8a04',
}

function buildFrom(
  lane: DriveInRackNode,
  detail: DriveInDetail,
  omission: FrameOmission,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const uprightColor = toLinear(lane.uprightColor)
  const beamColor = toLinear(lane.beamColor)
  const railColor = toLinear(lane.railColor)

  for (const part of driveInParts(lane, detail, omission)) {
    const color =
      part.role === 'upright'
        ? uprightColor
        : part.role === 'top-beam'
          ? beamColor
          : part.role === 'rail'
            ? railColor
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
 * Identity of a lane's *shape*.
 *
 * Built from the values the builder actually consumes rather than from the raw
 * schema fields, which is what keeps it honest in both directions.
 *
 * It cannot over-report: `centralisers` is a GP fitting, so on a C-rail lane it
 * moves no vertex and listing it raw would split the cache between byte-
 * identical meshes. Passing it through the same condition the parts list uses
 * collapses those back together.
 *
 * And it cannot under-report as easily: the level structure is encoded as the
 * elevation of each rail that is *actually drawn*, so a field that changes the
 * stack — `levelClears`, `topClear`, `railType` — reaches the key through
 * `railTopY` without anyone remembering to list it.
 *
 * Id, name, position, rotation, `supportSlabId` and `ghostFill` are absent on
 * purpose: two lanes that look the same must share one geometry.
 *
 * Çıplak üretici — dışarıya çıkan `driveInGeometryKey` bunun düğüm nesnesine
 * memoize edilmiş hâli (dosyanın sonunda).
 */
function buildDriveInGeometryKey(
  lane: DriveInRackNode,
  detail: DriveInDetail,
  omission: FrameOmission = { omitRight: false },
): string {
  const fitted = fittedLevelCount(lane)
  const rails = Array.from({ length: fitted }, (_, index) => railTopY(lane, index + 1).toFixed(5))

  return [
    detail,
    omission.omitRight ? 'L' : 'LR',
    lane.laneClearWidth.toFixed(5),
    lane.palletsDeep,
    totalDepth(lane).toFixed(5),
    effectivePostPitchZ(lane).toFixed(5),
    rails.join('/'),
    topBeamUndersideY(lane).toFixed(5),
    // The floor opening reaches the base ties and nothing else reaches it.
    clearOpening(lane, 0).toFixed(5),
    lane.uprightHeight.toFixed(5),
    lane.uprightWidth.toFixed(5),
    lane.uprightDepth.toFixed(5),
    lane.railType,
    lane.topBeamHeight.toFixed(5),
    lane.constructiveSystem,
    lane.entryMode,
    lane.guideRails ? lane.guideVariant : '-',
    // Only the near tier builds it, and only a GP rail has anything to centre.
    detail === 'full' && lane.centralisers && lane.railType === 'gp' ? 'c' : '-',
    detail === 'full' && lane.uprightReinforcer ? 'r' : '-',
    lane.uprightColor,
    lane.beamColor,
    lane.railColor,
    // Both reach the mesh only through the load footprint, which sets the lane
    // depth and the rail positions.
    lane.palletPreset,
    lane.palletOrientation,
  ].join('|')
}

export function getDriveInGeometry(
  lane: DriveInRackNode,
  detail: DriveInDetail,
  omission: FrameOmission = { omitRight: false },
): THREE.BufferGeometry {
  return getCachedGeometry(driveInGeometryKey(lane, detail, omission), () =>
    buildFrom(lane, detail, omission),
  )
}

export function retainDriveInGeometry(
  lane: DriveInRackNode,
  detail: DriveInDetail,
  omission: FrameOmission = { omitRight: false },
): string {
  return retainGeometry(driveInGeometryKey(lane, detail, omission))
}

export type { DriveInDetail }
export { releaseGeometry as releaseDriveInGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`; çıplak üretici: `buildDriveInGeometryKey`. */
export const driveInGeometryKey = memoiseGeometryKey(
  buildDriveInGeometryKey,
  (detail, omission) => `${detail}:${omission?.omitRight ? 'L' : 'LR'}`,
)
