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
import { footprintCentreZM, footprintM } from './launcher-metrics'
import ConveyorLauncherPreview from './launcher-preview'
import { ConveyorLauncherNode } from './launcher-schema'

/** 45° steps, matching the R / T rotation every built-in placement tool uses. */
const ROTATION_STEP = Math.PI / 4

/**
 * Placement for a launcher.
 *
 * One at a time, like a bend: this is the piece a line branches at, and there is
 * one of them per branch. `H` flips which side the box is launched to, because
 * that is the decision a person is making while the ghost is under the cursor —
 * and it is a mirror rather than a rotation, since turning the machine round
 * would also swap which end is the infeed.
 *
 * **Validity is this tool's own, and that is the point.** The host's collision
 * test compares plan rectangles with no height at all, so it cannot tell a
 * conveyor threading the walkway under a racking run from one driven through its
 * uprights. `floorPlaced.collides` is therefore off and the test lives in
 * `../clash`, in three dimensions — and for a launcher it is run against the two
 * boxes the steel actually occupies, because the rectangle round an L is a third
 * empty and that corner is where the branch's own line goes.
 */
export default function ConveyorLauncherTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)
  const [launchSide, setLaunchSide] = useState<'left' | 'right'>('left')

  const rotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)

  const previewNode = useMemo(
    () => ConveyorLauncherNode.parse({ launchSide, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [launchSide],
  )

  // Read through a ref so flipping the launch side re-measures the box in place
  // rather than tearing the tool down and losing the rotation with it — the rack
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
      const placed = ConveyorLauncherNode.parse({
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
      // The steel is not centred on the node — the arm sticks out one side — so
      // the measuring box sits off the ghost by however far the two differ,
      // carried into world space by the module's own rotation.
      const offset = footprintCentreZM(previewRef.current)
      setCursorPosition([
        visual[0] + offset * Math.sin(rotationRef.current),
        visual[1],
        visual[2] + offset * Math.cos(rotationRef.current),
      ])
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
      const bend = ConveyorLauncherNode.parse({
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

      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault()
        triggerSFX('sfx:item-rotate')
        setLaunchSide((current) => (current === 'left' ? 'right' : 'left'))
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
    // Deliberately not `previewNode`: the launch side is read through a ref, so
    // flipping it does not tear the tool down and reset the rotation.
  }, [activeLevelId])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <ConveyorLauncherPreview node={previewNode} />
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
