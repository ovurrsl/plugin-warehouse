'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import {
  EDITOR_LAYER,
  getFloorStackPreviewPosition,
  isGridSnapActive,
  movementSfxStepKey,
  PlacementBox,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFacingPose,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import {
  electSupportSlab,
  resolveAlignedPlacement,
  subscribeGridMove,
  subscribePlacementClicks,
} from '../placement'
import { useWarehouseStore } from '../store'
import { specOf, unitLoadHeight } from './presets'
import PalletPreview from './preview'
import { PalletNode } from './schema'

/** 45° steps, matching the R / T rotation every built-in placement tool uses. */
const ROTATION_STEP = Math.PI / 4

/**
 * Mounted by the host's registry-driven tool manager whenever
 * `tool === 'warehouse:pallet'` — no host edit per kind. The catalog panel arms
 * it by setting that tool id.
 *
 * The behaviours below exist because a plain "ghost follows cursor, click
 * commits" tool is not what the rest of the editor does, and a plugin node that
 * behaves differently from a built-in one reads as broken. Each one is composed
 * from a published host primitive rather than reimplemented, so it tracks the
 * host's behaviour instead of drifting from it:
 *
 *   - `getFloorStackPreviewPosition` resolves the Y. Placing at y=0 puts the
 *     pallet at the *level* origin, which is under the slab — the pallet has to
 *     sit on whatever surface is beneath the cursor, including another pallet.
 *   - `resolveAlignedPlacement` publishes the alignment guides that show what
 *     the pallet lines up with, and applies the magnetic pull in `lines` mode.
 *     This is the parity gap that made first placement feel unlike moving:
 *     the move path gets guides from `MoveRegistryNodeTool` for free, so
 *     without them here the same pallet measured against its neighbours while
 *     being dragged but not while being placed.
 *   - `spatialGridManager.canPlaceOnFloor` drives a green/red `PlacementBox`
 *     and blocks the commit, so pallets cannot be dropped inside each other.
 *     Declaring `floorPlaced.collides` only tells the host the footprint exists;
 *     the tool still has to ask. Alt forces past it, matching the move tool.
 *   - `measurements` on the box draws the width / depth / height pills in the
 *     viewer's own unit.
 *   - Clicks are taken from every floor-placement trigger kind, not just
 *     `grid:click`.
 */
export default function PalletTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const preset = useWarehouseStore((s) => s.palletPreset)
  const loadHeight = useWarehouseStore((s) => s.palletLoadHeight)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)

  const rotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)

  const previewNode = useMemo(
    () => PalletNode.parse({ preset, loadHeight, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [preset, loadHeight],
  )

  const spec = specOf(preset)
  const boxHeight = unitLoadHeight(preset, loadHeight)
  const boxDimensions = useMemo(
    (): [number, number, number] => [spec.length, boxHeight, spec.width],
    [spec.length, spec.width, boxHeight],
  )

  useEffect(() => {
    if (!activeLevelId) return
    setCursorVisible(false)
    lastPositionRef.current = null
    previousSnapRef.current = null
    rotationRef.current = 0
    altRef.current = false
    validRef.current = true
    setCursorRotationY(0)

    /**
     * Anchors of every other alignable object on this level, gathered once —
     * the scene is stable while the tool is armed — and refreshed after each
     * placement so a just-placed pallet becomes a target for the next one.
     * `previewNode.id` never collides with a scene node, so nothing real is
     * excluded from the pool.
     */
    let alignmentCandidates: AlignmentAnchor[] = collectAlignmentAnchors(
      useScene.getState().nodes,
      previewNode.id,
      activeLevelId,
    )

    /** Re-run the floor-collision check at the live cursor + rotation and push
     *  the result to the box colour. Alt forces green so a pallet can be
     *  deliberately stacked onto an occupied footprint. */
    const recomputeValidity = (visual: [number, number, number]) => {
      if (altRef.current) {
        validRef.current = true
        setValid(true)
        return
      }
      const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
        activeLevelId,
        visual,
        boxDimensions,
        [0, rotationRef.current, 0],
        // Nothing to exclude: the ghost is not in the scene graph yet.
        [],
      )
      validRef.current = placeable
      setValid(placeable)
    }

    /** Move the ghost, the box, the guides and the facing triangle to a
     *  resolved plan position. Shared by cursor movement and R / T, so a
     *  rotation with the cursor held still updates everything a move would. */
    const applyCursor = (position: [number, number, number]) => {
      const visual = getFloorStackPreviewPosition({
        node: previewNode as unknown as AnyNode,
        position,
        rotation: [0, rotationRef.current, 0],
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visual)
      cursorRef.current?.rotation.set(0, rotationRef.current, 0)
      setCursorPosition(visual)
      lastPositionRef.current = position
      recomputeValidity(visual)

      // A pallet has a front — fork entry is across the 1200 mm faces — and the
      // kind declares `facingIndicator`, so publish the pose the host's single
      // overlay renders. Drawing our own triangle inside the ghost is what the
      // host explicitly warns against: it comes out invisible.
      useFacingPose.getState().set({
        position: visual,
        rotationY: rotationRef.current,
        depth: boxDimensions[2],
      })
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      setCursorVisible(true)

      const { position, guides } = resolveAlignedPlacement({
        candidates: alignmentCandidates,
        node: previewNode as unknown as AnyNode,
        rawX,
        rawZ,
        rotationY: rotationRef.current,
      })
      useAlignmentGuides.getState().set(guides)
      applyCursor(position)

      const nextSnapKey = movementSfxStepKey({
        coords: [position[0], position[2]],
        gridSnapActive: isGridSnapActive(),
        gridStep: useEditor.getState().gridSnapStep,
      })
      if (previousSnapRef.current !== nextSnapKey) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = nextSnapKey
      }
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
        rotation: [0, rotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })

      useScene.getState().createNode(committed as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [committed.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()

      // The pallet just placed is a valid alignment target for the next one.
      //
      // The tool stays armed rather than reading `getContinuation('point')`
      // like the built-in point tools: `continuationContextOf` matches a
      // hardcoded kind set that a plugin kind can never join, so the
      // once/repeat chip is not rendered while this tool is active. Honouring a
      // setting the user cannot see or change would disarm the tool after one
      // pallet with nothing on screen explaining why.
      alignmentCandidates = collectAlignmentAnchors(
        useScene.getState().nodes,
        previewNode.id,
        activeLevelId,
      )
      event.stopPropagation?.()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        altRef.current = true
        const position = lastPositionRef.current
        if (position) applyCursor(position)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      let delta = 0
      if (event.key === 'r' || event.key === 'R') delta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') delta = -ROTATION_STEP
      else return
      event.preventDefault()
      triggerSFX('sfx:item-rotate')
      rotationRef.current += delta
      setCursorRotationY(rotationRef.current)
      // Rotation changes both the footprint's collision span and its alignment
      // anchors, so re-resolve rather than just spinning the ghost.
      const position = lastPositionRef.current
      if (position) applyCursor(position)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Alt') return
      altRef.current = false
      const position = lastPositionRef.current
      if (position) applyCursor(position)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      unsubscribeMove()
      unsubscribeClicks()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      // Covers commit, Esc, kind switch and unmount uniformly — a guide or a
      // facing triangle left behind lingers over the canvas with no owner.
      useAlignmentGuides.getState().clear()
      useFacingPose.getState().clear()
    }
  }, [activeLevelId, previewNode, boxDimensions])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <PalletPreview node={previewNode} />
      </group>
      {cursorVisible && (
        <PlacementBox
          dimensions={boxDimensions}
          measurements={{ unit }}
          position={cursorPosition}
          rotationY={cursorRotationY}
          valid={valid}
        />
      )}
    </>
  )
}
