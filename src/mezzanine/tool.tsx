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
import { electSupportSlab, subscribeGridMove, subscribePlacementClicks } from '../placement'
import { useWarehouseStore } from '../store'
import { GROUND_SUPPORT_ID } from './deck-slabs'
import { footprintDepthM, footprintWidthM, totalHeightM } from './metrics'
import MezzaninePreview from './preview'
import { MezzanineNode } from './schema'

const ROTATION_STEP = Math.PI / 4

/**
 * Mezzanine yerleştirme aracı — rafın/aracın deseninin sadeleştirilmiş hâli:
 * tek tık yerleştirme + R/T döndürme. Hizalama kılavuzları YOK (Faz 1'de
 * komşu-mıknatıs kavramı yok — bir sonraki fazın konusu değil bile, bu
 * kind'ın komşu paylaşımı hiç olmayacak); `floorPlaced.collides: true`
 * geçerlilik kutusunu `spatialGridManager.canPlaceOnFloor` sürüyor.
 */
export default function MezzanineTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.mezzanineBrush)

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
  const [placementSerial, setPlacementSerial] = useState(0)

  const previewNode = useMemo(
    () => MezzanineNode.parse({ ...brush, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [brush, placementSerial],
  )

  const boxDimensions = useMemo(
    (): [number, number, number] => [
      footprintWidthM(previewNode),
      totalHeightM(previewNode),
      footprintDepthM(previewNode),
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
    validRef.current = true
    setCursorRotationY(0)

    const recomputeValidity = (position: [number, number, number]) => {
      if (altRef.current) {
        validRef.current = true
        setValid(true)
        return
      }
      const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
        activeLevelId,
        position,
        boxDimensions,
        [0, rotationRef.current, 0],
        [],
      )
      validRef.current = placeable
      setValid(placeable)
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
      const position: [number, number, number] = [rawX, 0, rawZ]
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
      const committed = MezzanineNode.parse({
        ...previewNode,
        id: previewNode.id,
        name: 'Mezzanine',
        position,
        rotation: [0, rotationRef.current, 0],
        parentId: activeLevelId,
        // Zemine ya da gerçek bir slab'a ÇİVİLENİR — asla boş bırakılmaz.
        // Boş bırakılsaydı `getFloorPlacedElevation` her karede seçim
        // yapardı ve adaylar arasında mezzanine'in KENDİ güverte slab'ları
        // da olurdu: mezzanine kendi üstüne çıkar, güverte bir üst kota
        // taşınır, sonraki karede yine... Düz zeminde bu kenar durum değil
        // varsayılan durumdur, çünkü `resolveSupportSlabPatch` tek slablı
        // katta hiçbir şey kalıcılaştırmaz.
        supportSlabId:
          electSupportSlab(nodes, activeLevelId, position[0], position[2]) ?? GROUND_SUPPORT_ID,
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
  }, [activeLevelId, previewNode, boxDimensions])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <MezzaninePreview node={previewNode} />
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
