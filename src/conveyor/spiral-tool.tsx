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
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { isClearAt } from '../clash'
import {
  clearPlacementPreview,
  electSupportSlab,
  publishPlacementPreview,
  resolveAlignedPlacement,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
} from '../placement'
import { useWarehouseStore } from '../store'
import { placementPose } from './placement-pose'
import { footprintM, overallHeightM } from './spiral-metrics'
import SpiralPreview from './spiral-preview'
import { ConveyorSpiralNode } from './spiral-schema'

/** Sekiz snap açısı — sarmal sabit bir helis, teleskopiğin `[`/`]` uzatma
 *  tuşu yok. */
const ROTATION_STEP = Math.PI / 4

/**
 * Yerleştirme aracı — ailenin deseni. Sarmal bir HAT parçası: `placementPose`
 * port mıknatısını çalıştırıyor, kuyruk/uç bir hattın ucuna oturuyor. Uzatma
 * tuşu yok (helis sabit), gerisi teleskopikle aynı plumbing.
 */
export default function SpiralTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.spiralBrush)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)

  const rotationRef = useRef(0)
  const poseRotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  const cursorPositionRef = useRef<readonly [number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)
  const [placementSerial, setPlacementSerial] = useState(0)

  const previewNode = useMemo(
    () =>
      ConveyorSpiralNode.parse({
        ...brush,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [brush, placementSerial],
  )
  const previewNodeRef = useRef(previewNode)
  previewNodeRef.current = previewNode

  const boxDimensions = useMemo(
    (): [number, number, number] => [
      footprintM(previewNode),
      overallHeightM(previewNode),
      footprintM(previewNode),
    ],
    [previewNode],
  )

  useEffect(() => {
    if (!activeLevelId) return
    setCursorVisible(false)
    lastPositionRef.current = null
    previousSnapRef.current = null
    rotationRef.current = 0
    poseRotationRef.current = 0
    altRef.current = false
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
      const live = previewNodeRef.current
      const size: [number, number, number] = [
        footprintM(live),
        overallHeightM(live),
        footprintM(live),
      ]
      const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
        activeLevelId,
        visual,
        size,
        [0, poseRotationRef.current, 0],
        [],
      )
      const clear = isClearAt({
        node: {
          ...previewNodeRef.current,
          position: visual,
          rotation: [0, poseRotationRef.current, 0],
        },
        position: visual,
        rotationY: poseRotationRef.current,
        nodes: useScene.getState().nodes as Readonly<Record<string, unknown>>,
      })
      validRef.current = placeable && clear
      setValid(placeable && clear)
    }

    const applyCursor = (position: [number, number, number]) => {
      const visual = getFloorStackPreviewPosition({
        node: previewNode as unknown as AnyNode,
        position,
        rotation: [0, poseRotationRef.current, 0],
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visual)
      cursorRef.current?.rotation.set(0, poseRotationRef.current, 0)
      // 2B plan hayaleti: 3B mesh'i plana geçince gizleniyor, planın
      // kendi gölgesi yalnız bu store'dan besleniyor.
      publishPlacementPreview(previewNode, visual, poseRotationRef.current)
      if (!samePlacementPoint(cursorPositionRef.current, visual)) {
        cursorPositionRef.current = visual
        setCursorPosition(visual)
      }
      setCursorRotationY(poseRotationRef.current)
      lastPositionRef.current = position
      recomputeValidity(visual)
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      setCursorVisible(true)
      const aligned = resolveAlignedPlacement({
        candidates: alignmentCandidates,
        node: previewNode as unknown as AnyNode,
        rawX,
        rawZ,
        rotationY: rotationRef.current,
      })
      // Mıknatıs hizalamanın ÜSTÜNDE: sarmalın giriş/çıkış portları bir hattın
      // ucuna oturur (`placementPose` → `snapPlacementToLineEnd`).
      const pose = placementPose(
        previewNodeRef.current,
        aligned.position,
        rotationRef.current,
        useScene.getState().nodes as Readonly<Record<string, unknown>>,
      )
      useAlignmentGuides.getState().set(pose.snapped ? [] : aligned.guides)
      poseRotationRef.current = pose.rotationY
      setCursorRotationY(pose.rotationY)
      applyCursor(pose.position)

      const nextSnapKey = movementSfxStepKey({
        coords: [pose.position[0], pose.position[2]],
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
      const committed = ConveyorSpiralNode.parse({
        ...previewNodeRef.current,
        id: previewNode.id,
        name: 'Spiral Conveyor',
        position,
        rotation: [0, poseRotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })

      useScene.getState().createNode(committed as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [committed.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()

      alignmentCandidates = collectAlignmentAnchors(
        useScene.getState().nodes,
        previewNode.id,
        activeLevelId,
      )
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

      let delta = 0
      if (event.key === 'r' || event.key === 'R') delta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') delta = -ROTATION_STEP
      else return
      event.preventDefault()
      triggerSFX('sfx:item-rotate')
      rotationRef.current += delta
      // Kullanıcı çevirdiği an mıknatısın bıraktığı açı düşer.
      poseRotationRef.current = rotationRef.current
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
      clearPlacementPreview()
      unsubscribeClicks()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      useAlignmentGuides.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <SpiralPreview node={previewNode} />
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
