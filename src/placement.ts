'use client'

import {
  type AlignmentAnchor,
  type AlignmentGuide,
  type AnyNode,
  emitter,
  type GridEvent,
  movingFootprintAnchors,
  resolveAlignment,
  sceneRegistry,
  snapPointToGrid,
} from '@pascal-app/core'
import {
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  useEditor,
} from '@pascal-app/editor'
import { Vector3 } from 'three'
import { asSlab, type SlabLike, slabAt } from './host-adapter'

/**
 * Placement plumbing, re-derived rather than imported.
 *
 * The host's own `floor-placement` helpers live in `packages/nodes/src/shared/`
 * and are not exported from `@pascal-app/nodes` — its `exports` map only
 * publishes the built bundle. Owning a copy is not a workaround so much as the
 * point: this is the one part of the placement path that cannot break under a
 * host upgrade, because nothing outside this package defines it.
 */

const worldVec = new Vector3()

/**
 * Kinds whose click event must also commit a placement.
 *
 * Listening only to `grid:click` looks correct and quietly loses commits: R3F
 * dispatches a click to the nearest mesh, so a click on what the user reads as
 * "the floor" is usually a slab, and over a placed object it is that object.
 * Mirrors the host's own trigger list, plus this plugin's kinds so a pallet can
 * be placed while the cursor is over another one.
 */
const CLICK_TRIGGER_KINDS = [
  'grid',
  'shelf',
  'item',
  'slab',
  'ceiling',
  'wall',
  'fence',
  'column',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'warehouse:pallet',
  // A placed rack's picking collider swallows the click that lands on it, so
  // without this a second rack cannot be placed against the first — the cursor
  // is over the run you are aligning to, and nothing commits.
  'warehouse:pallet-rack',
] as const

export type PlacementClickEvent = { stopPropagation?: () => void }

export function subscribePlacementClicks(
  handler: (event: PlacementClickEvent) => void,
): () => void {
  const events = CLICK_TRIGGER_KINDS.map((kind) => `${kind}:click`)
  for (const name of events) emitter.on(name as never, handler as never)
  return () => {
    for (const name of events) emitter.off(name as never, handler as never)
  }
}

/**
 * Snap a planar position when grid snapping is the active mode.
 *
 * `isGridSnapActive()` is the host's own choke point: it resolves the snapping
 * mode for whatever context is active, which for an armed tool comes from the
 * kind's `snapProfile`. Reading it rather than the underlying store fields
 * means the four modes (grid / lines / angles / off) keep behaving correctly
 * here even if the host rearranges how they are stored — an earlier version
 * poked at `snappingModeByContext.item` directly and would have silently
 * reverted to always-on grid snap the moment that shape changed.
 */
export function snapXZ(x: number, z: number): readonly [number, number] {
  if (!isGridSnapActive()) return [x, z]
  return snapPointToGrid([x, z], useEditor.getState().gridSnapStep)
}

/**
 * Figma-style alignment threshold in metres, matching the host's own move tool.
 * 8 cm pulls without fighting grid snap.
 */
export const ALIGNMENT_THRESHOLD_M = 0.08

export type AlignedPlacement = {
  position: [number, number, number]
  guides: AlignmentGuide[]
}

/**
 * Grid snap, then alignment against every other object on the level.
 *
 * The host has this exact routine — `resolveAlignedFloorPlacement` in
 * `packages/nodes/src/shared/floor-placement` — but that module is internal to
 * `@pascal-app/nodes` and not published, so the composition is re-derived here
 * from the three primitives that *are* public. Those primitives are the load
 * bearing part: `movingFootprintAnchors` reads this kind's declared footprint
 * through the registry, so the guides stay correct for every pallet preset
 * without listing dimensions twice.
 *
 * Display and pull are deliberately separate, matching the host: guides are
 * drawn in every mode except when no snap context is active, but the magnetic
 * delta is applied only in `lines` mode. So the user always sees what the
 * pallet lines up with, and only gets pulled onto it when they asked for it.
 */
export function resolveAlignedPlacement({
  candidates,
  centerOffset,
  node,
  rawX,
  rawZ,
  rotationY,
}: {
  candidates: readonly AlignmentAnchor[]
  /**
   * World-space vector from the cursor to the node's centre.
   *
   * For a kind that grows from an edge rather than about its middle. Applied
   * after the grid quantize and before alignment, which is the only order that
   * behaves: the cursor is what the user is aiming, so that is what lands on the
   * grid line, while alignment compares the footprint — which is centred — with
   * its neighbours.
   */
  centerOffset?: readonly [number, number]
  node: AnyNode
  rawX: number
  rawZ: number
  rotationY: number
}): AlignedPlacement {
  const [snappedX, snappedZ] = snapXZ(rawX, rawZ)
  const x = snappedX + (centerOffset?.[0] ?? 0)
  const z = snappedZ + (centerOffset?.[1] ?? 0)
  if (!isAlignmentGuideActive() || candidates.length === 0) {
    return { position: [x, 0, z], guides: [] }
  }

  const moving = movingFootprintAnchors(node, x, z, rotationY)
  if (moving.length === 0) return { position: [x, 0, z], guides: [] }

  const result = resolveAlignment({
    moving,
    candidates: candidates as AlignmentAnchor[],
    threshold: ALIGNMENT_THRESHOLD_M,
  })
  if (result.snap && isMagneticSnapActive()) {
    return {
      position: [x + result.snap.dx, 0, z + result.snap.dz],
      guides: result.guides,
    }
  }
  return { position: [x, 0, z], guides: result.guides }
}

/** Convert a world-space grid hit into the active level's local frame, which is
 * how the host stores node positions. */
export function toLevelLocal(
  levelId: string,
  world: [number, number, number],
): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) return [world[0], 0, world[2]]
  worldVec.set(world[0], world[1], world[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVec)
  return [worldVec.x, 0, worldVec.z]
}

/**
 * Elect the slab a level-local point stands on, so the node can persist it.
 *
 * Storing the answer at commit time turns "which racks are on this slab" into a
 * field comparison for the stats panel. The alternative — testing polygons on
 * every recompute — is both slower and less stable, since a node nudged a
 * centimetre past a slab edge would silently leave the count.
 *
 * Reads host slabs through the adapter, so a change to the slab schema costs
 * the node its `supportSlabId` and nothing more.
 */
export function electSupportSlab(
  nodes: Readonly<Record<string, unknown>>,
  levelId: string,
  x: number,
  z: number,
): string | null {
  return slabAt(collectSlabs(nodes, levelId), x, z)?.id ?? null
}

/**
 * The level's slabs, once.
 *
 * Split out of `electSupportSlab` because that function walks **every child of
 * the level** to find them, and a level's children are mostly not slabs — in a
 * finished warehouse they are the two thousand racks. Electing per node
 * therefore costs placed × children, which is quadratic in exactly the thing
 * this kind is built to have a lot of: laying a 2,000-bay run into a level that
 * already holds 2,000 racks is four million lookups inside one click.
 *
 * Anything placing more than one node collects once and calls `slabAt` per
 * position, which is placed + children.
 */
export function collectSlabs(
  nodes: Readonly<Record<string, unknown>>,
  levelId: string,
): SlabLike[] {
  const level = nodes[levelId] as { children?: unknown } | undefined
  const childIds = Array.isArray(level?.children) ? level.children : []
  const slabs: SlabLike[] = []
  for (const id of childIds) {
    if (typeof id !== 'string') continue
    const slab = asSlab(nodes[id])
    if (slab) slabs.push(slab)
  }
  return slabs
}

export type GridMoveHandler = (rawLevelLocal: [number, number, number], event: GridEvent) => void

/**
 * Subscribe to cursor movement over the grid, **unsnapped**.
 *
 * Snapping is left to the caller because grid quantize and alignment have to be
 * applied in that order against the same point — snapping here would hand the
 * alignment resolver an already-quantized cursor and the two would fight,
 * showing a guide the pallet never actually reaches.
 *
 * Commits elsewhere use the position from the last move rather than the click
 * event's own: a click reports the ray's hit point, which on a vertical face is
 * somewhere up a wall rather than on the floor the user was aiming at.
 */
export function subscribeGridMove(handler: GridMoveHandler): () => void {
  const onMove = (event: GridEvent) => {
    const [lx, , lz] = event.localPosition
    handler([lx, 0, lz], event)
  }
  emitter.on('grid:move', onMove)
  return () => emitter.off('grid:move', onMove)
}
