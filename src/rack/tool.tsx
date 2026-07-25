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
import PalletRackPreview from './preview'
import { PalletRackNode } from './schema'
import { totalDepth, totalWidth } from './slots'

/** 45° steps, matching the R / T rotation every built-in placement tool uses. */
const ROTATION_STEP = Math.PI / 4

/**
 * Placement for a racking run.
 *
 * Composed from the same published host primitives the pallet tool uses, so a
 * rack snaps, aligns, measures and refuses overlaps exactly like a built-in
 * kind rather than approximately like one.
 *
 * The one addition is Shift-click, which places a row of parallel runs in a
 * single gesture. That exists because of a design decision this node made
 * deliberately: one node is one run, rather than one node holding N parallel
 * rows. Separate nodes are what let identical racks share a mesh, keep aisles
 * genuinely empty for collision, and let runs differ in length around columns —
 * but they cost the convenience of typing "5 rows". This gesture buys it back
 * without giving up any of that.
 */
export default function PalletRackTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.rackBrush)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)

  const rotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const shiftRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)

  const previewNode = useMemo(
    () => PalletRackNode.parse({ ...brush, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [brush],
  )

  const boxDimensions = useMemo(
    (): [number, number, number] => [
      totalWidth(previewNode),
      previewNode.uprightHeight,
      totalDepth(previewNode),
    ],
    [previewNode],
  )

  useEffect(() => {
    if (!activeLevelId) return
    setCursorVisible(false)
    lastPositionRef.current = null
    previousSnapRef.current = null
    rotationRef.current = 0
    altRef.current = false
    shiftRef.current = false
    validRef.current = true
    setCursorRotationY(0)

    let alignmentCandidates: AlignmentAnchor[] = collectAlignmentAnchors(
      useScene.getState().nodes,
      previewNode.id,
      activeLevelId,
    )

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
        [],
      )
      validRef.current = placeable
      setValid(placeable)
    }

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

    const commitAt = (position: [number, number, number]): string | null => {
      const current = useWarehouseStore.getState().rackBrush
      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const committed = PalletRackNode.parse({
        ...current,
        position,
        rotation: [0, rotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })
      useScene.getState().createNode(committed as unknown as AnyNode, activeLevelId as AnyNodeId)
      return committed.id
    }

    const unsubscribeClicks = subscribePlacementClicks((event) => {
      const position = lastPositionRef.current
      if (!position) return
      if (!validRef.current) {
        // The red box already says why; swallow the click so it does not fall
        // through and select whatever is underneath.
        event.stopPropagation?.()
        return
      }

      const placed: string[] = []
      const first = commitAt(position)
      if (first) placed.push(first)

      if (shiftRef.current) {
        // A row of parallel runs, marching away from the aisle face. Each is a
        // separate node, so they still share one mesh and each aisle between
        // them stays free for anything else to be placed in.
        const store = useWarehouseStore.getState()
        const stride = totalDepth(previewNode) + store.rackAisleGap
        const forward: [number, number] = [
          -Math.sin(rotationRef.current),
          -Math.cos(rotationRef.current),
        ]
        for (let index = 1; index < store.rackRowRepeat; index++) {
          const next: [number, number, number] = [
            position[0] + forward[0] * stride * index,
            position[1],
            position[2] + forward[1] * stride * index,
          ]
          const visual = getFloorStackPreviewPosition({
            node: previewNode as unknown as AnyNode,
            position: next,
            rotation: [0, rotationRef.current, 0],
            levelId: activeLevelId,
          })
          // Stop at the first blocked position rather than skipping it and
          // carrying on — a row with a hole in it is never what was meant.
          const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
            activeLevelId,
            visual,
            boxDimensions,
            [0, rotationRef.current, 0],
            [],
          )
          if (!placeable) break
          const id = commitAt(next)
          if (id) placed.push(id)
        }
      }

      useViewer.getState().setSelection({ selectedIds: placed as AnyNodeId[] })
      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()

      // The racks just placed are alignment targets for the next one.
      alignmentCandidates = collectAlignmentAnchors(
        useScene.getState().nodes,
        previewNode.id,
        activeLevelId,
      )
      event.stopPropagation?.()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || event.key === 'Shift') {
        if (event.key === 'Alt') altRef.current = true
        else shiftRef.current = true
        const position = lastPositionRef.current
        if (position) applyCursor(position)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const store = useWarehouseStore.getState()
      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        const delta = event.key === ']' ? 1 : -1
        store.setRackBrush({ bayCount: Math.max(1, Math.min(40, brush.bayCount + delta)) })
        return
      }

      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP
      else return
      event.preventDefault()
      triggerSFX('sfx:item-rotate')
      rotationRef.current += rotationDelta
      setCursorRotationY(rotationRef.current)
      // Rotation changes the footprint's collision span and its alignment
      // anchors, so re-resolve rather than only spinning the ghost.
      const position = lastPositionRef.current
      if (position) applyCursor(position)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') altRef.current = false
      else if (event.key === 'Shift') shiftRef.current = false
      else return
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
  }, [activeLevelId, previewNode, boxDimensions, brush.bayCount])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <PalletRackPreview node={previewNode} />
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
