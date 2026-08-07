import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { type RackPart, rackParts } from './parts'
import type { PalletRackNode } from './schema'
import {
  bayCenterX,
  depthPositionZ,
  orientedPalletFootprint,
  slotOffsetsX,
  storageLevelsPresent,
  totalDepth,
  totalWidth,
} from './slots'

/**
 * The plan symbol, projected from the same part list the 3D model is built
 * from.
 *
 * That is the point of it. "The plan matches the model" is only a fact if there
 * is one description of where the steel is. The earlier version recomputed
 * frame positions here from the same inputs, which agrees exactly until one of
 * the two files is edited — and then disagrees silently, because nothing
 * compares them. A test now asserts every part drawn in plan sits where its 3D
 * box does.
 *
 * SVG `rotate()` is clockwise with y pointing down while three.js rotates
 * counter-clockwise about +Y, so the plan rotation negates the node's.
 * Invisible at 0° and obvious at 90°.
 */

/**
 * Roles worth drawing in plan.
 *
 * A brace is a diagonal in the frame's vertical plane, so seen from above it is
 * a line the posts already cover; footplates hide under them. Drawing either
 * only thickens the symbol without adding information.
 */
export const PLAN_ROLES: ReadonlySet<RackPart['role']> = new Set<RackPart['role']>([
  'upright',
  'beam',
])

export function buildPalletRackFloorplan(
  node: PalletRackNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = totalWidth(node)
  const depth = totalDepth(node)
  const view = ctx.viewState
  /**
   * `selected || highlighted` — cabinet paritesi. `highlighted` marquee ve
   * programatik vurgunun bayrağı (`core/registry/types.ts`: "shows selected
   * chrome without keyboard focus"); yalnız `selected` okumak, kutu seçimin
   * rafın üstünden vurgusuz geçmesi demekti. Host yerleşiklerinin 29/31'i
   * bu çifti okuyor.
   */
  const selected = (view?.selected || view?.highlighted) ?? false

  /**
   * Mimar mürekkebi — host yerleşiklerinin plan dili, kendi dilimiz değil.
   *
   * Eski palet doymuş maviydi (#dbeafe/#1e40af gövde, #1e3a8a ayak, #c2410c
   * kiriş): paftada ev dilinde çizilmemiş tek nesne raftı. Değerler cabinet
   * ve column'un kendi sabitlerinden (host'ta paylaşılan bir palet modülü
   * yok, her kind dosya-yerel literal taşıyor — kopyalamak sözleşmenin
   * kendisi): gövde `cabinet/floorplan.ts` BODY_FILL/BODY_STROKE
   * (#ffffff/#7c7468), semboller SYMBOL_STROKE (#6f675b), kesilen çelik
   * column'un kesit mürekkebi (#374151). Kalınlık da cabinet'in gövde
   * ağırlığı: seçiliyken 0.03, değilken 0.022. Seçim kroması zaten
   * `viewState.palette`'ten geliyor — tema-duyarlı ve host'la aynı.
   */
  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#7c7468'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#ffffff'
  const palletStroke = selected ? stroke : '#6f675b'
  const steelFill = selected ? stroke : '#374151'
  const beamFill = selected ? stroke : '#6f675b'

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -width / 2,
      y: -depth / 2,
      width,
      height: depth,
      fill,
      // 'transparent' rather than 'none' — `none` is not paint, so
      // `pointer-events: visiblePainted` never hit-tests it and the rack
      // becomes unselectable in plan.
      stroke,
      strokeWidth: selected ? 0.03 : 0.022,
    },
  ]

  // Steel, straight off the 3D part list. Always full detail: the plan shows
  // the frames whatever tier the 3D viewport happens to be drawing.
  //
  // Deliberately without the neighbour flag. In 3D a shared frame must be built
  // once or the two posts z-fight; in plan the two rects are the same rectangle
  // in the same fill, so a run reads as N+1 posts either way — and asking each
  // bay to consult its neighbours to draw a plan would cost a scene scan per
  // symbol per redraw.
  for (const part of rackParts(node, 'full')) {
    if (!PLAN_ROLES.has(part.role)) continue
    const partFill = part.role === 'beam' ? beamFill : steelFill
    children.push({
      kind: 'rect',
      x: part.center[0] - part.size[0] / 2,
      y: part.center[2] - part.size[2] / 2,
      width: part.size[0],
      height: part.size[2],
      fill: partFill,
      stroke: partFill,
      strokeWidth: 0.004,
    })
  }

  // Pallet positions. Outline-only: a plan is read for how the positions divide
  // the bay, and filling them buries the frames at the zoom a layout is
  // actually worked at.
  // A bay tunnelled all the way up holds nothing, and drawing its positions
  // anyway is exactly the plan-against-model disagreement this file exists to
  // stop.
  if (storageLevelsPresent(node).length > 0) {
    const offsets = slotOffsetsX(node)
    const [alongRun, intoDepth] = orientedPalletFootprint(node)
    const centerX = bayCenterX()
    for (let position = 1; position <= node.depthPositions; position++) {
      const centerZ = depthPositionZ(node, position)
      for (const offset of offsets) {
        children.push({
          kind: 'rect',
          x: centerX + offset - alongRun / 2,
          y: centerZ - intoDepth / 2,
          width: alongRun,
          height: intoDepth,
          fill: 'transparent',
          stroke: palletStroke,
          strokeWidth: 0.015,
        })
      }
    }
  }

  const rotation = Array.isArray(node.rotation) ? (node.rotation[1] ?? 0) : 0

  return {
    kind: 'group',
    children,
    transform: {
      translate: [node.position?.[0] ?? 0, node.position?.[2] ?? 0],
      rotate: -rotation,
    },
  }
}
