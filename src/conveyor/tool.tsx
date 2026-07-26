'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
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
import { frameWidthM, moduleLengthM } from './metrics'
import { extendConveyorRun, moduleOffsets } from './multiply'
import ConveyorRollerPreview from './preview'
import { ConveyorRollerNode } from './schema'

/** 45° steps, matching the R / T rotation every built-in placement tool uses. */
const ROTATION_STEP = Math.PI / 4

/** Ghost modules drawn at the cursor before the box stands in for the rest. */
const GHOST_LIMIT = 60

/**
 * Placement for a conveyor run.
 *
 * Composed from the same published host primitives the rack tool uses, so a
 * conveyor snaps, aligns, measures and lifts onto slabs exactly like a built-in
 * kind. `[` and `]` set how many modules a click lays down; the click commits
 * the whole run in one write, so it is one undo step however long the line is.
 *
 * **Validity is this tool's own, and that is the point.** The host's collision
 * test compares plan rectangles with no height at all, so it cannot tell a
 * conveyor threading the walkway under a racking run from one driven through
 * its uprights. `floorPlaced.collides` is therefore off and the test lives in
 * `./clash`, in three dimensions, against the rack's actual steel — a tunnelled
 * level emits no beams, so the pass-through is clear by construction and what
 * is left to hit is the legs.
 */
export default function ConveyorRollerTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)
  const [modules, setModules] = useState(1)

  const rotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)

  const previewNode = useMemo(
    () => ConveyorRollerNode.parse({ position: [0, 0, 0], rotation: [0, 0, 0] }),
    [],
  )

  /**
   * The run's extent and where its middle sits relative to the first module.
   *
   * Modules butt end to end, so N of them occupy exactly N bed lengths and the
   * centre is half a run along local +X from the module under the cursor.
   */
  const extent = useMemo(() => {
    const length = moduleLengthM(previewNode)
    return {
      width: length * modules,
      depth: frameWidthM(previewNode),
      centerLocalX: ((modules - 1) * length) / 2,
    }
  }, [previewNode, modules])

  const ghosts = useMemo(
    () => moduleOffsets(previewNode, Math.min(modules, GHOST_LIMIT)),
    [previewNode, modules],
  )

  // Read through refs so growing the run with `[` / `]` adjusts the box in
  // place instead of tearing the tool down and losing the rotation with it —
  // the rack shipped that bug and it is the same effect here.
  const extentRef = useRef(extent)
  extentRef.current = extent
  const modulesRef = useRef(modules)
  modulesRef.current = modules

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
      previewNode.id,
      activeLevelId,
    )

    /** The run's middle, from the first module's position. */
    const runCenter = (
      origin: [number, number, number],
      rotationY: number,
    ): [number, number, number] => {
      const localX = extentRef.current.centerLocalX
      return [
        origin[0] + localX * Math.cos(rotationY),
        origin[1],
        origin[2] - localX * Math.sin(rotationY),
      ]
    }

    const recomputeValidity = (visual: [number, number, number]) => {
      if (altRef.current) {
        validRef.current = true
        setValid(true)
        return
      }
      // Every module of the run, against everything else in the scene. Not the
      // host's plan test: it has no height at all, and height is the whole
      // question — under a rack's tunnel is fine, through its legs is not.
      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const rotationY = rotationRef.current
      const placed = ConveyorRollerNode.parse({
        ...previewNode,
        id: undefined,
        position: visual,
        rotation: [0, rotationY, 0],
      })
      const positions = [visual, ...moduleOffsets(placed, modulesRef.current)]
      const clear = positions.every((position) =>
        isClearAt({ node: placed, position, rotationY, nodes }),
      )
      validRef.current = clear
      setValid(clear)
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
      setCursorPosition(runCenter(visual, rotationRef.current))
      lastPositionRef.current = position
      recomputeValidity(visual)

      useFacingPose.getState().set({
        position: visual,
        rotationY: rotationRef.current,
        depth: frameWidthM(previewNode),
      })
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      setCursorVisible(true)
      // No centre offset: the cursor carries the *first module*, and a module is
      // centred on its own node. Aligning that one footprint is what makes a
      // module land flush against an existing one.
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
        // through and select whatever is underneath.
        event.stopPropagation?.()
        return
      }

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const first = ConveyorRollerNode.parse({
        ...previewNode,
        id: undefined,
        position,
        rotation: [0, rotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })
      // The module under the cursor and every one behind it in one write, so
      // the click is one undo step however long the run is.
      extendConveyorRun(first, modulesRef.current, activeLevelId, { createSource: true })

      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()
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

      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        setModules((count) => Math.max(1, Math.min(60, count + (event.key === ']' ? 1 : -1))))
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
    // Deliberately not `extent` or `modules`: both are read through refs, so
    // growing the run does not tear the tool down and reset the rotation.
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <ConveyorRollerPreview node={previewNode} />
        {ghosts.map((offset) => (
          <group key={`${offset[0]}:${offset[2]}`} position={offset}>
            <ConveyorRollerPreview node={previewNode} />
          </group>
        ))}
      </group>
      {cursorVisible && (
        <PlacementBox
          dimensions={[extent.width, previewNode.transportHeight, extent.depth]}
          measurements={{ unit }}
          position={cursorPosition}
          rotationY={cursorRotationY}
          valid={valid}
        />
      )}
    </>
  )
}
