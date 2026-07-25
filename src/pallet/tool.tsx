'use client'

import { type AnyNode, type AnyNodeId, spatialGridManager, useScene } from '@pascal-app/core'
import {
  EDITOR_LAYER,
  getFloorStackPreviewPosition,
  PlacementBox,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { electSupportSlab, subscribeGridMove, subscribePlacementClicks } from '../placement'
import { useWarehouseStore } from '../store'
import { specOf, unitLoadHeight } from './presets'
import PalletPreview from './preview'
import { PalletNode } from './schema'

/**
 * Mounted by the host's registry-driven tool manager whenever
 * `tool === 'warehouse:pallet'` — no host edit per kind. The catalog panel arms
 * it by setting that tool id.
 *
 * Three behaviours here exist because a plain "ghost follows cursor, click
 * commits" tool is not what the rest of the editor does, and a plugin node that
 * behaves differently from a built-in one reads as broken:
 *
 *   - `getFloorStackPreviewPosition` resolves the Y. Placing at y=0 puts the
 *     pallet at the *level* origin, which is under the slab — the pallet has to
 *     sit on whatever surface is beneath the cursor, including another pallet.
 *   - `spatialGridManager.canPlaceOnFloor` drives a green/red `PlacementBox`
 *     and blocks the commit, so pallets cannot be dropped inside each other.
 *     Declaring `floorPlaced.collides` only tells the host the footprint exists;
 *     the tool still has to ask.
 *   - Clicks are taken from every floor-placement trigger kind, not just
 *     `grid:click`.
 */
export default function PalletTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const preset = useWarehouseStore((s) => s.palletPreset)
  const loadHeight = useWarehouseStore((s) => s.palletLoadHeight)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [valid, setValid] = useState(true)
  const validRef = useRef(true)
  const lastPositionRef = useRef<[number, number, number] | null>(null)

  const previewNode = useMemo(
    () => PalletNode.parse({ preset, loadHeight, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [preset, loadHeight],
  )

  const spec = specOf(preset)
  const boxDimensions: [number, number, number] = [
    spec.length,
    unitLoadHeight(preset, loadHeight),
    spec.width,
  ]

  useEffect(() => {
    if (!activeLevelId) return
    setCursorVisible(false)
    lastPositionRef.current = null

    const unsubscribeMove = subscribeGridMove((position) => {
      setCursorVisible(true)

      // Lifts the ghost onto whatever it is standing on — the slab, or another
      // pallet. Without it the preview sits at the level origin and the placed
      // node looks like it is hovering.
      const visual = getFloorStackPreviewPosition({
        node: previewNode as unknown as AnyNode,
        position,
        rotation: previewNode.rotation,
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visual)
      setCursorPosition(visual)
      lastPositionRef.current = position

      const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
        activeLevelId,
        visual,
        boxDimensions,
        [0, 0, 0],
        // Nothing to exclude: the ghost is not in the scene graph yet.
        [],
      )
      validRef.current = placeable
      setValid(placeable)
    })

    const unsubscribeClicks = subscribePlacementClicks((event) => {
      const position = lastPositionRef.current
      if (!position) return
      if (!validRef.current) {
        // The red box already says why; swallow the click so it does not fall
        // through and select whatever is underneath instead.
        event.stopPropagation?.()
        return
      }

      const brush = useWarehouseStore.getState()
      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>

      // The host has its own `resolveSupportSlabPatch`, but it is absent from
      // the published @pascal-app/core — it exists only in the monorepo source.
      // Depending on it would bind this package to an unshipped symbol, which
      // is exactly the coupling `host-adapter` exists to avoid.
      const committed = PalletNode.parse({
        preset: brush.palletPreset,
        loadHeight: brush.palletLoadHeight,
        position,
        rotation: [0, 0, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })

      useScene.getState().createNode(committed as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [committed.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
      event.stopPropagation?.()
    })

    return () => {
      unsubscribeMove()
      unsubscribeClicks()
    }
    // `boxDimensions` is derived from the two brush values already listed.
  }, [activeLevelId, previewNode, preset, loadHeight])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <PalletPreview node={previewNode} />
      </group>
      {cursorVisible && (
        <PlacementBox dimensions={boxDimensions} position={cursorPosition} valid={valid} />
      )}
    </>
  )
}
