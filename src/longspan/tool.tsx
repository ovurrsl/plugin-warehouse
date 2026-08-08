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
import {
  electSupportSlab,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
} from '../placement'
import { useWarehouseStore } from '../store'
import { bayPitch, totalDepth } from './levels'
import LongspanPreview from './preview'
import { LongspanNode } from './schema'

const ROTATION_STEP = Math.PI / 4

/**
 * Bay placement.
 *
 * `[` / `]` change the **level count** — the one dimension a shelving bay is
 * specified by while it is being placed. Levels are added and removed at the
 * top and spaced by the brush's own pitch, so the gesture reads as "taller /
 * shorter bay" rather than as an edit to a particular shelf.
 *
 * Every key that changes a dimension re-runs `applyCursor`: the conveyor tool
 * shipped the version that did not, so growing a module with a key while the
 * mouse was still left validity computed against the old size — and a bay could
 * be grown into a wall and committed with a green box.
 */
export default function LongspanTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.longspanBrush)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)
  const [placementSerial, setPlacementSerial] = useState(0)
  const [levelCount, setLevelCount] = useState(brush.levelCount)

  const rotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  /** Son YAZILAN imleç merkezi. Kapının belleği: kutu gerçekten kımıldamadıysa
   *  `setCursorPosition` hiç çağrılmaz. */
  const cursorPositionRef = useRef<readonly [number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)
  const levelCountRef = useRef(levelCount)
  levelCountRef.current = levelCount

  /** A preview node with a STABLE id — the level count is applied in
   *  `ghostNode`, so `[` / `]` does not tear down the placement effect and its
   *  subscriptions on every press. */
  const previewNode = useMemo(
    () =>
      LongspanNode.parse({
        bayLength: brush.bayLength,
        frameDepth: brush.frameDepth,
        frameHeight: brush.frameHeight,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [brush, placementSerial],
  )

  const ghostNode = useMemo(() => {
    // Levels spread evenly from the first shelf to just under the frame top.
    const first = 0.3
    const usable = Math.max(0.2, previewNode.frameHeight - first - 0.2)
    const step = levelCount > 1 ? usable / (levelCount - 1) : 0
    return {
      ...previewNode,
      levels: Array.from({ length: levelCount }, (_, index) => ({
        elevation: first + index * step,
        structure: brush.structure,
        shelfKind: brush.shelfKind,
        panels: 1,
      })),
    }
  }, [previewNode, levelCount, brush.structure, brush.shelfKind])

  const ghostRef = useRef(ghostNode)
  ghostRef.current = ghostNode

  /** The pitch, not the outer width — the same figure the footprint declares.
   *  Two different numbers here and there is the red-box bug. */
  const boxDimensions = useMemo(
    (): [number, number, number] => [
      bayPitch(ghostNode),
      ghostNode.frameHeight,
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
        [bayPitch(ghost), ghost.frameHeight, totalDepth(ghost)],
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
      // Kutunun merkezi gerçekten kımıldadıysa yaz. Taze dizi kimliği React'e
      // her fare hareketinde kaçamayacağı bir render ettiriyor; ızgaraya
      // oturmuş imleç için o render'ların çoğu birebir aynı kareyi üretiyor.
      if (!samePlacementPoint(cursorPositionRef.current, position)) {
        cursorPositionRef.current = position
        setCursorPosition(position)
      }
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
      const committed = LongspanNode.parse({
        ...ghostRef.current,
        id: previewNode.id,
        name: 'Longspan Bay',
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
        const next = Math.max(1, Math.min(12, levelCountRef.current + (event.key === ']' ? 1 : -1)))
        if (next === levelCountRef.current) return
        levelCountRef.current = next
        setLevelCount(next)
        // The dimension changed, so validity must be recomputed.
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
        <LongspanPreview node={ghostNode} />
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
