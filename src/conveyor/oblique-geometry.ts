import type * as THREE from 'three'
import {
  emitPart,
  finish,
  getCachedGeometry,
  ROLE_COLORS,
  retainGeometry,
  type Sink,
  toLinear,
} from './geometry-builder'
import {
  branchCentreLocal,
  branchLengthM,
  branchWidthM,
  divergeXM,
  legHeightM,
  mainWidthM,
  moduleLengthM,
  rollerPitchM,
  rollerPitchMm,
} from './oblique-metrics'
import { obliqueParts } from './oblique-parts'
import type { ConveyorObliqueNode } from './oblique-schema'
import type { ConveyorDetail } from './parts'
import { outletPort } from './ports'

/**
 * One merged BufferGeometry per oblique *shape*, out of the straight's pool.
 *
 * The stripe span is read per part, as it is on the launcher: three beds of
 * three different lengths at two different headings, so a single node-level
 * figure would paint the branch's rollers at the main line's spacing.
 */
function buildFrom(
  oblique: ConveyorObliqueNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const frameColor = toLinear(oblique.frameColor)
  const rollerColor = toLinear(oblique.rollerColor)
  const diverterColor = toLinear(oblique.diverterColor)
  const pitch = rollerPitchM(oblique)

  for (const part of obliqueParts(oblique, detail, hasDownstreamNeighbour)) {
    const color =
      part.role === 'frame' || part.role === 'end-plate'
        ? frameColor
        : part.role === 'deck'
          ? rollerColor
          : part.role === 'diverter'
            ? diverterColor
            : toLinear(ROLE_COLORS[part.role])
    emitPart(sink, part, color, part.size[0] / pitch, part.rotationY)
  }

  return finish(sink)
}

/**
 * Identity of an oblique's *shape*.
 *
 * **`divergeXM` and the branch's own geometry, not `angle` alone.** The angle
 * reaches the mesh only through where the branch leaves and how far it runs, and
 * both are derived from it — so listing the derived figures is what the key law
 * asks for. `branchSide` is separate and is genuinely a mirror: turning the
 * module round swaps which end is the infeed, so a left branch is not a right
 * one rotated.
 *
 * `branchMode` is absent on purpose. It decides what the branch port *does*, and
 * a port is not a vertex — two obliques ordered as a divert and as a merge are
 * the same steel.
 */
export function obliqueGeometryKey(
  oblique: ConveyorObliqueNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): string {
  const [branchX, branchZ] = branchCentreLocal(oblique)
  return [
    detail,
    hasDownstreamNeighbour ? `U${outletPort(oblique)}` : 'UD',
    moduleLengthM(oblique).toFixed(5),
    mainWidthM(oblique).toFixed(5),
    branchWidthM(oblique).toFixed(5),
    divergeXM(oblique).toFixed(5),
    branchLengthM(oblique).toFixed(5),
    `${branchX.toFixed(5)},${branchZ.toFixed(5)}`,
    rollerPitchMm(oblique),
    legHeightM(oblique).toFixed(5),
    oblique.frameColor,
    oblique.rollerColor,
    oblique.diverterColor,
  ].join('|')
}

export function getObliqueGeometry(
  oblique: ConveyorObliqueNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): THREE.BufferGeometry {
  return getCachedGeometry(obliqueGeometryKey(oblique, detail, hasDownstreamNeighbour), () =>
    buildFrom(oblique, detail, hasDownstreamNeighbour),
  )
}

export function retainObliqueGeometry(
  oblique: ConveyorObliqueNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): string {
  return retainGeometry(obliqueGeometryKey(oblique, detail, hasDownstreamNeighbour))
}
