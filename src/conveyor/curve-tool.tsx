'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
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
import { isClearAt } from '../clash'
import {
  electSupportSlab,
  resolveAlignedPlacement,
  subscribeGridMove,
  subscribePlacementClicks,
} from '../placement'
import { footprintM } from './curve-metrics'
import ConveyorCurvePreview from './curve-preview'
import { ConveyorCurveNode } from './curve-schema'

/** 45° steps, matching the R / T rotation every built-in placement tool uses. */
const ROTATION_STEP = Math.PI / 4

/** The three angles the catalogue builds, in the order `[` and `]` walk them. */
const ANGLES = ['45', '90', '180'] as const

/**
 * Placement for a bend.
 *
 * One at a time, unlike the straight — nobody lays twenty bends in a row, and a
 * run of them would be a circle. What `[` and `]` do here instead is cycle the
 * *angle*, and `H` flips the hand, because those are the two decisions a person
 * is actually making while the ghost is under the cursor: which way the line
 * turns and how far.
 *
 * **Validity is this tool's own, and that is the point.** The host's collision
 * test compares plan rectangles with no height at all, so it cannot tell a
 * conveyor threading the walkway under a racking run from one driven through its
 * uprights. `floorPlaced.collides` is therefore off and the test lives in
 * `../clash`, in three dimensions — and for a bend it is run against the arc
 * rather than the box around it, because a quarter annulus fills under a third
 * of its own square and the corner it curls around is exactly where the racking
 * goes.
 */
export default function ConveyorCurveTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>('90')
  const [handed, setHanded] = useState<'left' | 'right'>('left')

  const rotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)

  const previewNode = useMemo(
    () => ConveyorCurveNode.parse({ angle, handed, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [angle, handed],
  )

  // Read through a ref so cycling the angle re-measures the box in place rather
  // than tearing the tool down and losing the rotation with it — the rack
  // shipped that bug and it is the same effect here.
  const previewRef = useRef(previewNode)
  previewRef.current = previewNode

  const [width, depth] = footprintM(previewNode)

  useEffect(() => {
    if (!activeLevelId) return
    setCursorVisible(false)
    lastPositionRef.current = null
    previousSnapRef.current = null
    rotationRef.current = 0
    altRef.current = false
    validRef.current = true
    setCursorRotationY(0)

    let alignmentCandidates: AlignmentAnchor[] = collectAlignmentAnchors(
      useScene.getState().nodes,
      previewRef.current.id,
      activeLevelId,
    )

    const recomputeValidity = (visual: [number, number, number]) => {
      if (altRef.current) {
        validRef.current = true
        setValid(true)
        return
      }
      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const rotationY = rotationRef.current
      const placed = ConveyorCurveNode.parse({
        ...previewRef.current,
        id: undefined,
        position: visual,
        rotation: [0, rotationY, 0],
      })
      const clear = isClearAt({ node: placed, position: visual, rotationY, nodes })
      validRef.current = clear
      setValid(clear)
    }

    const applyCursor = (position: [number, number, number]) => {
      const visual = getFloorStackPreviewPosition({
        node: previewRef.current as unknown as AnyNode,
        position,
        rotation: [0, rotationRef.current, 0],
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visual)
      cursorRef.current?.rotation.set(0, rotationRef.current, 0)
      // The footprint is centred on the node, so the box and the ghost share a
      // position — unlike a run of straights, where the box spans them all.
      setCursorPosition(visual)
      lastPositionRef.current = position
      recomputeValidity(visual)

      useFacingPose.getState().set({
        position: visual,
        rotationY: rotationRef.current,
        depth: footprintM(previewRef.current)[1],
      })
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      setCursorVisible(true)
      const { position, guides } = resolveAlignedPlacement({
        candidates: alignmentCandidates,
        node: previewRef.current as unknown as AnyNode,
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
        // through and select whatever is underneath.
        event.stopPropagation?.()
        return
      }

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const bend = ConveyorCurveNode.parse({
        ...previewRef.current,
        id: undefined,
        position,
        rotation: [0, rotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })
      // Through `applyNodeChanges` rather than `createNode`, so a bend lands the
      // same way a run of straights does: one store write, one undo step, and
      // the new node selected when it arrives.
      useScene.getState().applyNodeChanges({
        create: [{ node: bend as unknown as AnyNode, parentId: activeLevelId as AnyNodeId }],
      })
      useViewer.getState().setSelection({ selectedIds: [bend.id] as unknown as AnyNodeId[] })

      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()
      alignmentCandidates = collectAlignmentAnchors(
        useScene.getState().nodes,
        previewRef.current.id,
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

      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        setAngle((current) => {
          const index = ANGLES.indexOf(current)
          const next = index + (event.key === ']' ? 1 : -1)
          return ANGLES[Math.max(0, Math.min(ANGLES.length - 1, next))] ?? current
        })
        return
      }

      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault()
        triggerSFX('sfx:item-rotate')
        setHanded((current) => (current === 'left' ? 'right' : 'left'))
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
    // Deliberately not `previewNode`: the angle and the hand are read through a
    // ref, so cycling either does not tear the tool down and reset the rotation.
  }, [activeLevelId])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <ConveyorCurvePreview node={previewNode} />
      </group>
      {cursorVisible && (
        <PlacementBox
          dimensions={[width, previewNode.transportHeight, depth]}
          measurements={{ unit }}
          position={cursorPosition}
          rotationY={cursorRotationY}
          valid={valid}
        />
      )}
    </>
  )
}
