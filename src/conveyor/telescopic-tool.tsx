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
  electSupportSlab,
  resolveAlignedPlacement,
  subscribeGridMove,
  subscribePlacementClicks,
} from '../placement'
import { useWarehouseStore } from '../store'
import { TELESCOPIC_MODELS } from './telescopic-catalog'
import {
  currentLengthM,
  footprintCenterX,
  frameWidthM,
  telescopicModelOf,
} from './telescopic-metrics'
import TelescopicPreview from './telescopic-preview'
import { ConveyorTelescopicNode } from './telescopic-schema'

const ROTATION_STEP = Math.PI / 4
/** `[` / `]` uzamayı bu adımla değiştirir — koşan bir sürükleme değil,
 *  yerleştirmeden önce alınan bir karar. */
const EXTENSION_STEP = 0.1

/**
 * Yerleştirme aracı — ailenin deseni, iki farkla: port mıknatısı yok (bu bir
 * hat parçası değil) ve `[`/`]` bomu uzatıp kısaltıyor, çünkü makinenin
 * kapladığı zemin uzamayla değişir ve kullanıcı onu YERLEŞTİRİRKEN görmek
 * ister — koyduktan sonra panelde bulmak değil.
 */
export default function TelescopicTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.telescopicBrush)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)
  const [extension, setExtension] = useState(brush.extension)

  const rotationRef = useRef(0)
  const extensionRef = useRef(brush.extension)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)
  const [placementSerial, setPlacementSerial] = useState(0)

  const previewNode = useMemo(
    () =>
      ConveyorTelescopicNode.parse({
        ...brush,
        extension,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [brush, extension, placementSerial],
  )

  const model = telescopicModelOf(previewNode.model)
  const boxDimensions = useMemo(
    (): [number, number, number] => [
      currentLengthM(previewNode),
      model.heightM + 0.12,
      frameWidthM(previewNode),
    ],
    [previewNode, model.heightM],
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
      const clear = isClearAt({
        node: { ...previewNode, position: visual, rotation: [0, rotationRef.current, 0] },
        position: visual,
        rotationY: rotationRef.current,
        nodes: useScene.getState().nodes as Readonly<Record<string, unknown>>,
      })
      validRef.current = placeable && clear
      setValid(placeable && clear)
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
      setCursorRotationY(rotationRef.current)
      lastPositionRef.current = position
      recomputeValidity(visual)
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
        event.stopPropagation?.()
        return
      }

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const committed = ConveyorTelescopicNode.parse({
        ...previewNode,
        id: previewNode.id,
        name: `Telescopic ${TELESCOPIC_MODELS[previewNode.model].label}`,
        position,
        rotation: [0, rotationRef.current, 0],
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

      // Bom: `[` kısaltır, `]` uzatır. Fırçaya da yazılır ki bir sonraki
      // yerleştirme aynı açıklıkta başlasın.
      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        const delta = event.key === ']' ? EXTENSION_STEP : -EXTENSION_STEP
        const next = Math.min(1, Math.max(0, extensionRef.current + delta))
        if (next === extensionRef.current) return
        extensionRef.current = next
        setExtension(next)
        useWarehouseStore.getState().setTelescopicBrush({ extension: next })
        triggerSFX('sfx:item-rotate')
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
      useAlignmentGuides.getState().clear()
    }
  }, [activeLevelId, previewNode, boxDimensions])

  if (!activeLevelId) return null

  // Kutu, uzamayla ÖNE kayan taban izini gösterir — kullanıcı bomun nereye
  // uzanacağını yerleştirmeden önce görür.
  const offset = footprintCenterX(previewNode)
  const boxPosition: [number, number, number] = [
    cursorPosition[0] + Math.cos(cursorRotationY) * offset,
    cursorPosition[1],
    cursorPosition[2] - Math.sin(cursorRotationY) * offset,
  ]

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <TelescopicPreview node={previewNode} />
      </group>
      {cursorVisible && (
        <PlacementBox
          dimensions={boxDimensions}
          measurements={{ unit }}
          position={boxPosition}
          rotationY={cursorRotationY}
          valid={valid}
        />
      )}
    </>
  )
}
