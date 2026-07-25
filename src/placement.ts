'use client'

import { emitter, type GridEvent, sceneRegistry, snapPointToGrid } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
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

/** Snap a planar position when grid snapping is the active mode, reading the
 * same toggle and step the built-in item tools use so plugin nodes snap like
 * every other item rather than inventing their own behaviour. */
export function snapXZ(x: number, z: number): readonly [number, number] {
  const editor = useEditor.getState() as ReturnType<typeof useEditor.getState> & {
    snappingModeByContext?: { item?: string }
  }
  const gridActive = editor.snappingModeByContext
    ? editor.snappingModeByContext.item === 'grid'
    : editor.magneticSnap
  if (!gridActive) return [x, z]
  return snapPointToGrid([x, z], editor.gridSnapStep)
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
  const level = nodes[levelId] as { children?: unknown } | undefined
  const childIds = Array.isArray(level?.children) ? level.children : []
  const slabs: SlabLike[] = []
  for (const id of childIds) {
    if (typeof id !== 'string') continue
    const slab = asSlab(nodes[id])
    if (slab) slabs.push(slab)
  }
  return slabAt(slabs, x, z)?.id ?? null
}

export type GridMoveHandler = (levelLocal: [number, number, number], event: GridEvent) => void

/**
 * Subscribe to cursor movement over the grid, snapped.
 *
 * Commits elsewhere use the position from the last move rather than the click
 * event's own: a click reports the ray's hit point, which on a vertical face is
 * somewhere up a wall rather than on the floor the user was aiming at.
 */
export function subscribeGridMove(handler: GridMoveHandler): () => void {
  const onMove = (event: GridEvent) => {
    const [lx, , lz] = event.localPosition
    const [sx, sz] = snapXZ(lx, lz)
    handler([sx, 0, sz], event)
  }
  emitter.on('grid:move', onMove)
  return () => emitter.off('grid:move', onMove)
}
