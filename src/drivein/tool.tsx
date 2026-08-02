'use client'

import { type AnyNode, type AnyNodeId, spatialGridManager, useScene } from '@pascal-app/core'
import {
  EDITOR_LAYER,
  isGridSnapActive,
  movementSfxStepKey,
  PlacementBox,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { isClearAt } from '../clash'
import { electSupportSlab, subscribeGridMove, subscribePlacementClicks } from '../placement'
import { useWarehouseStore } from '../store'
import { lanePitch, totalDepth } from './lanes'
import DriveInPreview from './preview'
import { DriveInRackNode } from './schema'

const ROTATION_STEP = Math.PI / 4

/**
 * Lane placement.
 *
 * `[` / `]` change the lane's **depth** — the number of pallet positions — which
 * is the one dimension a drive-in lane is specified by at placement time, the
 * way the rack's tool sizes a run and the live channel sizes its depth.
 *
 * Every key that changes a dimension re-runs `applyCursor`, and that is not
 * cosmetic: the conveyor tool shipped the version that did not, so growing a
 * module with a key while the mouse was still left the validity computed
 * against the old length — a lane could be grown into a wall and committed
 * with a green box.
 */
export default function DriveInTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.driveInBrush)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)
  const [placementSerial, setPlacementSerial] = useState(0)
  const [deep, setDeep] = useState(brush.palletsDeep)

  const rotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)
  const deepRef = useRef(deep)
  deepRef.current = deep

  /** A preview node with a STABLE id — depth is applied in `ghostNode`.
   *  Putting depth here would tear down and rebuild the placement effect, and
   *  its subscriptions, on every `[` / `]`. */
  const previewNode = useMemo(
    () => DriveInRackNode.parse({ ...brush, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [brush, placementSerial],
  )
  const ghostNode = useMemo(() => ({ ...previewNode, palletsDeep: deep }), [previewNode, deep])
  const ghostRef = useRef(ghostNode)
  ghostRef.current = ghostNode

  /**
   * The placement box is the **pitch**, not the outer width.
   *
   * Same figure the footprint declares, and for the same reason: a lane brought
   * flush against another overlaps by one upright if the box is the outer
   * width, `spatialGridManager` reads that as a hard conflict, and the click
   * that would have joined the block is swallowed. The selective rack's
   * definition documents the bug; declaring it in two places with two different
   * figures would reintroduce it here.
   */
  const boxDimensions = useMemo(
    (): [number, number, number] => [
      lanePitch(ghostNode),
      ghostNode.uprightHeight,
      totalDepth(ghostNode),
    ],
    [ghostNode],
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

    const recomputeValidity = (position: [number, number, number]) => {
      if (altRef.current) {
        validRef.current = true
        setValid(true)
        return
      }
      const ghost = ghostRef.current
      const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
        activeLevelId,
        position,
        [lanePitch(ghost), ghost.uprightHeight, totalDepth(ghost)],
        [0, rotationRef.current, 0],
        [],
      )
      const clear = isClearAt({
        node: { ...ghost, position, rotation: [0, rotationRef.current, 0] },
        position,
        rotationY: rotationRef.current,
        nodes: useScene.getState().nodes as Readonly<Record<string, unknown>>,
      })
      validRef.current = placeable && clear
      setValid(placeable && clear)
    }

    const applyCursor = (position: [number, number, number]) => {
      cursorRef.current?.position.set(...position)
      cursorRef.current?.rotation.set(0, rotationRef.current, 0)
      setCursorPosition(position)
      setCursorRotationY(rotationRef.current)
      lastPositionRef.current = position
      recomputeValidity(position)
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      setCursorVisible(true)
      applyCursor([rawX, 0, rawZ])

      const nextSnapKey = movementSfxStepKey({
        coords: [rawX, rawZ],
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
        event.stopPropagation?.()
        return
      }

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const committed = DriveInRackNode.parse({
        ...ghostRef.current,
        id: previewNode.id,
        name: 'Drive-in Lane',
        position,
        rotation: [0, rotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })

      useScene.getState().createNode(committed as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [committed.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
      setPlacementSerial((serial) => serial + 1)
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
        const next = Math.max(1, Math.min(16, deepRef.current + (event.key === ']' ? 1 : -1)))
        if (next === deepRef.current) return
        deepRef.current = next
        setDeep(next)
        // The dimension changed, so validity must be recomputed. Skipping this
        // is what let a module be grown into a wall and committed green.
        const position = lastPositionRef.current
        if (position) applyCursor(position)
        return
      }

      let delta = 0
      if (event.key === 'r' || event.key === 'R') delta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') delta = -ROTATION_STEP
      else return
      event.preventDefault()
      triggerSFX('sfx:item-rotate')
      rotationRef.current += delta
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
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <DriveInPreview node={ghostNode} />
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
