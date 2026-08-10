import * as THREE from 'three'
import { getCachedGeometry, releaseGeometry, retainGeometry } from '../conveyor/geometry-builder'
import { memoiseGeometryKey } from '../geometry-key-memo'
import { emitRackPart, type Sink, toLinear } from '../rack/geometry-builder'
import {
  crossBraceSets,
  crossTieCount,
  dividerHeightAt,
  doorHeight,
  drawerCount,
  fittedLevels,
  levelElevation,
} from './bays'
import { type FrameOmission, type M3Detail, type M3PartRole, m3Parts } from './parts'
import type { M3ShelvingNode } from './schema'

/**
 * One merged `BufferGeometry` per M3 *shape*.
 *
 * The emitter, the atlas, the colour conversion and the cache all come from the
 * two shared modules the drive-in lane and the M7 bay already use. Nothing
 * about M3 needs its own copy of any of that — the only thing this file owns is
 * which colour each role takes and what counts as the same shape.
 */

/**
 * Roles that are neither the upright nor a shelf.
 *
 * The two colours a user can set are the catalogue's own split — RAL 5014 on
 * the uprights, RAL 7035 on "other components" — so most of these read the
 * node's `componentColor` and only the few that are genuinely a different
 * material are listed here.
 */
const ROLE_COLORS: Partial<Record<M3PartRole, string>> = {
  footplate: '#3f4750',
  /** Polypropylene, and the catalogue's own blue. Plastic next to painted
   *  steel should not read as more steel. */
  drawer: '#2a6fb0',
  /** A slotted divider is thin bright sheet; darker than the shelf would make
   *  it disappear against it. */
  divider: '#dfe3e6',
  /** A brace is the one part users look for when checking stability, so it is
   *  a shade off the shelves rather than lost among them. */
  brace: '#9aa3ab',
}

/** HM is the same sheet in a heavier gauge with a reinforcer under it; a touch
 *  darker so a mixed bay reads as two products rather than one badly lit one. */
const HM_SHELF_TINT = '#adb2b0'

function buildFrom(
  bay: M3ShelvingNode,
  detail: M3Detail,
  omission: FrameOmission,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const uprightColor = toLinear(bay.uprightColor)
  const componentColor = toLinear(bay.componentColor)

  for (const part of m3Parts(bay, detail, omission)) {
    let color = componentColor
    if (part.role === 'upright') color = uprightColor
    else if (part.role === 'shelf' && part.shelfModel === 'HM') color = toLinear(HM_SHELF_TINT)
    else {
      const override = ROLE_COLORS[part.role]
      if (override) color = toLinear(override)
    }
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
 * Every **derived** fitting is in it as well as every stored field, and that is
 * the part worth stating: the brace-set count, the cross-tie count, the drawer
 * count and the divider height are all computed rather than typed, and each of
 * them changes the mesh. A key listing only the schema's own keys would let two
 * bays of different heights — one braced once, one twice — share a geometry.
 *
 * The mirror of that discipline is that a level above the frame reaches nothing
 * and must not split the cache, which is why the loop walks `fittedLevels`.
 */
function buildM3GeometryKey(
  bay: M3ShelvingNode,
  detail: M3Detail,
  omission: FrameOmission = { omitRight: false },
): string {
  const levels = fittedLevels(bay).map((level, index) => {
    // Emisyon koşulunun BİREBİR aynısı (`parts.ts`: `dividerHeight !== null &&
    // detail === 'full'`). Sayıyı koşulsuz yazmak, hiç bölücü kurulmayan iki
    // hâlde — sade katman, ve üstteki açıklığa yayımlanmış hiçbir serinin
    // sığmaması — aynı mesh'i sayı başına bir kez daha kurduruyordu.
    const dividerHeight = detail === 'full' ? dividerHeightAt(bay, index) : null
    return [
      levelElevation(level).toFixed(4),
      level.structure,
      level.model,
      level.structure === 'drawers'
        ? `${level.drawerModel}${level.drawerWidth}x${drawerCount(bay, level)}`
        : dividerHeight === null
          ? 'd-'
          : `d${level.dividers}@${dividerHeight.toFixed(3)}`,
    ].join(':')
  })

  return [
    detail,
    omission.omitRight ? 'L' : 'LR',
    bay.shelfLength.toFixed(5),
    bay.shelfDepth.toFixed(5),
    bay.frameHeight.toFixed(5),
    bay.frameVariant,
    bay.backPanel,
    bay.door,
    `b${crossBraceSets(bay)}`,
    `t${crossTieCount(bay)}`,
    `h${(doorHeight(bay) ?? 0).toFixed(3)}`,
    bay.uprightColor,
    bay.componentColor,
    levels.join('|'),
  ].join('#')
}

export function getM3Geometry(
  bay: M3ShelvingNode,
  detail: M3Detail,
  omission: FrameOmission = { omitRight: false },
): THREE.BufferGeometry {
  return getCachedGeometry(m3GeometryKey(bay, detail, omission), () =>
    buildFrom(bay, detail, omission),
  )
}

export function retainM3Geometry(
  bay: M3ShelvingNode,
  detail: M3Detail,
  omission: FrameOmission = { omitRight: false },
): string {
  return retainGeometry(m3GeometryKey(bay, detail, omission))
}

export { releaseGeometry as releaseM3Geometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`; çıplak üretici: `buildM3GeometryKey`. */
export const m3GeometryKey = memoiseGeometryKey(
  buildM3GeometryKey,
  (detail, omission) => `${detail}:${omission?.omitRight ? 'L' : 'LR'}`,
)
