/**
 * Teleskopik geometri — ailenin ORTAK havuzunda (`getCachedGeometry`).
 *
 * Curve'ün gerekçesinin aynısı: ikinci bir havuz, tahliye kuralının ve
 * retain sayaçlarının ikinci bir kopyası demek. Anahtarda uzama YOKTUR —
 * bölümler dinlenme çerçevesinde inşa edilir ve uzama renderer'da grup
 * ötelemesidir; bir uzama sürüklemesi cache'e tek buffer bastırmaz.
 */

import type * as THREE from 'three'
import { PALETTE } from './constants'
import {
  emitPart,
  finish,
  getCachedGeometry,
  releaseGeometry,
  retainGeometry,
  type Sink,
  toLinear,
} from './geometry-builder'
import type { ConveyorDetail } from './parts'
import {
  type TelescopicPart,
  telescopicBaseParts,
  telescopicSectionParts,
} from './telescopic-parts'
import type { ConveyorTelescopicNode } from './telescopic-schema'

/** Rol renkleri: gövde/deste düğümün boyası, donanım ailenin sabitleri. */
function colorOf(node: ConveyorTelescopicNode, role: TelescopicPart['role']): string {
  switch (role) {
    case 'frame':
      return node.frameColor
    case 'deck':
      return node.beltColor
    case 'guide':
      return PALETTE.profileGrey
    case 'leg':
      return node.frameColor
    case 'footplate':
      return PALETTE.feetGrey
    case 'motor':
      return PALETTE.boxWhite
    case 'rail':
      return PALETTE.profileGrey
    case 'console':
      return PALETTE.boxWhite
    // Endüstriyel kırmızı ve sarı — güvenlik donanımının rengi keyfî
    // değildir, standardın kendisidir.
    case 'estop':
      return '#c62828'
    case 'hazard':
      return '#f2c200'
    case 'lamp-housing':
      return '#3a4048'
    case 'sensor':
      return '#20242a'
    case 'platform':
      return PALETTE.feetGrey
  }
}

function buildParts(
  node: ConveyorTelescopicNode,
  parts: readonly TelescopicPart[],
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    emitPart(sink, part, toLinear(colorOf(node, part.role)), 0)
  }
  return finish(sink)
}

export function telescopicBaseKey(node: ConveyorTelescopicNode, detail: ConveyorDetail): string {
  return ['tele-base', node.model, node.beltWidth, detail, node.frameColor, node.beltColor].join(
    '|',
  )
}

export function telescopicSectionKey(
  node: ConveyorTelescopicNode,
  sectionIndex: number,
  detail: ConveyorDetail,
): string {
  return [
    'tele-sec',
    node.model,
    node.beltWidth,
    sectionIndex,
    detail,
    node.frameColor,
    node.beltColor,
    node.hasSensor,
    node.hasPlatform,
  ].join('|')
}

export function getTelescopicBaseGeometry(
  node: ConveyorTelescopicNode,
  detail: ConveyorDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(telescopicBaseKey(node, detail), () =>
    buildParts(node, telescopicBaseParts(node, detail)),
  )
}

export function getTelescopicSectionGeometry(
  node: ConveyorTelescopicNode,
  sectionIndex: number,
  detail: ConveyorDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(telescopicSectionKey(node, sectionIndex, detail), () =>
    buildParts(node, telescopicSectionParts(node, sectionIndex, detail)),
  )
}

export { releaseGeometry, retainGeometry }
