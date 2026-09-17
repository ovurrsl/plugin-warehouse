import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { useWarehouseStore } from '../store'
import { type RackPart, rackParts } from './parts'
import type { PalletRackNode } from './schema'
import {
  bayCenterX,
  depthPositionZ,
  formatIndustrialAddress,
  letterToLevel,
  levelToLetter,
  orientedPalletFootprint,
  palletSlotsOf,
  slotOffsetsX,
  storageLevelsPresent,
  totalDepth,
  totalWidth,
} from './slots'

export interface LevelFilterResult {
  active: boolean
  levelIndex: number
  levelLetter: string
}

export function parseLevelFilter(
  filter: string | number | null | undefined,
): LevelFilterResult {
  if (filter === null || filter === undefined || filter === '') {
    return { active: false, levelIndex: -1, levelLetter: '' }
  }
  if (typeof filter === 'number') {
    return {
      active: true,
      levelIndex: filter,
      levelLetter: levelToLetter(filter),
    }
  }
  const str = String(filter).trim()
  if (!str || str.toLowerCase() === 'all' || str.toLowerCase() === 'none') {
    return { active: false, levelIndex: -1, levelLetter: '' }
  }
  const letterMatch = /^(?:kat|level)?\s*([A-Za-z])$/i.exec(str)
  if (letterMatch && letterMatch[1]) {
    const letter = letterMatch[1].toUpperCase()
    return { active: true, levelIndex: letterToLevel(letter), levelLetter: letter }
  }
  const numberMatch = /^(?:kat|level)?\s*(\d+)$/i.exec(str)
  if (numberMatch && numberMatch[1]) {
    const num = parseInt(numberMatch[1], 10)
    return { active: true, levelIndex: num, levelLetter: levelToLetter(num) }
  }
  return { active: false, levelIndex: -1, levelLetter: '' }
}

export function resolveActiveLevelFilter(ctx?: GeometryContext): LevelFilterResult {
  const storeFilter =
    typeof useWarehouseStore !== 'undefined'
      ? useWarehouseStore.getState?.()?.activeFloorplanLevelFilter
      : null
  const raw =
    (ctx?.extensions as Record<string, unknown> | undefined)?.activeFloorplanLevelFilter ??
    (ctx?.extensions as Record<string, unknown> | undefined)?.activeLevelFilter ??
    (ctx?.extensions as Record<string, unknown> | undefined)?.levelFilter ??
    (ctx?.levelData as Record<string, unknown> | undefined)?.activeFloorplanLevelFilter ??
    (ctx?.levelData as Record<string, unknown> | undefined)?.activeLevelFilter ??
    storeFilter ??
    null
  return parseLevelFilter(raw as string | number | null | undefined)
}

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
  const hasStorage = storageLevelsPresent(node).length > 0
  if (hasStorage) {
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

  // Dynamic Level Filtering: When active, draw industrial address text inside footprints
  const levelFilter = resolveActiveLevelFilter(ctx)
  if (levelFilter.active && hasStorage && storageLevelsPresent(node).includes(levelFilter.levelIndex)) {
    const matchingSlots = palletSlotsOf(node).filter((s) => s.level === levelFilter.levelIndex)
    for (const slot of matchingSlots) {
      const addressText =
        slot.aisle || (slot.id.includes('-') && !slot.id.startsWith('R'))
          ? slot.id
          : formatIndustrialAddress({
              ...slot,
              aisle: node.rowLabel || 'A',
            })
      children.push({
        kind: 'text',
        x: slot.localPosition[0],
        y: slot.localPosition[2],
        text: addressText,
        fontSize: 0.12,
        fontWeight: 'bold',
        fill: '#0f172a',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAnchor: 'middle',
        dominantBaseline: 'central',
        upright: true,
        metadata: { role: 'slot-address', slotId: addressText },
      })
    }
  }

  // Feature 11.1: Aisle Header ("SIRA A") when rowLabel is set
  const showAisleHeader = Boolean(
    node.rowLabel &&
      (node.bayIndex === 1 || (ctx?.extensions as Record<string, unknown> | undefined)?.showAllAisleHeaders),
  )
  if (showAisleHeader) {
    const cleanLabel = node.rowLabel.trim()
    const aisleText = cleanLabel.toUpperCase().startsWith('SIRA') ? cleanLabel : `SIRA ${cleanLabel}`
    children.push({
      kind: 'text',
      x: -width / 2 - 0.4,
      y: 0,
      text: aisleText,
      fontSize: 0.28,
      fontWeight: 'bold',
      fill: '#18181b',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textAnchor: 'end',
      dominantBaseline: 'central',
      upright: true,
      metadata: { role: 'aisle-header', rowLabel: node.rowLabel },
    })
  }

  // Feature 11.2: Bay numbers ("01", "02") displayed along the aisle
  const bayNumberStr = String(node.bayIndex ?? 1).padStart(2, '0')
  children.push({
    kind: 'text',
    x: bayCenterX(),
    y: depth / 2 + 0.25,
    text: bayNumberStr,
    fontSize: 0.18,
    fontWeight: '600',
    fill: '#52525b',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textAnchor: 'middle',
    dominantBaseline: 'hanging',
    upright: true,
    metadata: { role: 'bay-number', bayIndex: node.bayIndex },
  })

  // In dual-facing access mode, also render bay number along rear aisle
  if (node.accessMode === 'dual-facing') {
    children.push({
      kind: 'text',
      x: bayCenterX(),
      y: -depth / 2 - 0.25,
      text: bayNumberStr,
      fontSize: 0.18,
      fontWeight: '600',
      fill: '#52525b',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textAnchor: 'middle',
      dominantBaseline: 'auto',
      upright: true,
      metadata: { role: 'bay-number', bayIndex: node.bayIndex, face: 'rear' },
    })
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
