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
import { bayWidthM, channelDepthM, frameHeightM } from './metrics'
import LiveRackingPreview from './preview'
import { LiveRackingNode } from './schema'

const ROTATION_STEP = Math.PI / 4

/**
 * Kanal yerleştirme aracı.
 *
 * `[` / `]` kanal DERİNLİĞİNİ değiştirir (palet adedi) — rafın gözü, aracın
 * mast'ı ve teleskopiğin uzaması gibi, yerleştirme sırasında ayarlanan tek
 * ölçü budur. Her basıştan sonra `applyCursor` yeniden çağrılır: konveyörün
 * bu turda düzeltilen hatası, tuşla ölçü değişince geçerliliğin eski boyla
 * hesaplanmış kalmasıydı.
 */
export default function LiveRackingTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.liveRackingBrush)

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

  /** Kimliği SABİT önizleme düğümü — derinlik `ghostNode`'da uygulanır.
   *  Derinliği buraya koymak, her `[`/`]` basışında yerleştirme
   *  `useEffect`'inin (abonelikler dahil) yeniden kurulmasına yol açardı;
   *  teleskopik araçta tam bu hata vardı ve bu turda düzeltildi. */
  const previewNode = useMemo(
    () => LiveRackingNode.parse({ ...brush, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [brush, placementSerial],
  )
  const ghostNode = useMemo(() => ({ ...previewNode, palletsDeep: deep }), [previewNode, deep])
  const ghostRef = useRef(ghostNode)
  ghostRef.current = ghostNode

  const boxDimensions = useMemo(
    (): [number, number, number] => [
      bayWidthM(ghostNode),
      frameHeightM(ghostNode),
      channelDepthM(ghostNode),
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
        [bayWidthM(ghost), frameHeightM(ghost), channelDepthM(ghost)],
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
      const committed = LiveRackingNode.parse({
        ...ghostRef.current,
        id: previewNode.id,
        name: 'Live Racking',
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
        const next = Math.max(1, Math.min(30, deepRef.current + (event.key === ']' ? 1 : -1)))
        if (next === deepRef.current) return
        deepRef.current = next
        setDeep(next)
        // Ölçü değişti — geçerlilik YENİDEN hesaplanmalı. Bunu atlamak,
        // fare durduğunda kanalın duvarın içine büyütülüp yeşil kutuyla
        // taahhüt edilebilmesi demekti.
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
        <LiveRackingPreview node={ghostNode} />
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
