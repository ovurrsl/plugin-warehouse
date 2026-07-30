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
import { closeEnough, finishOutline, type Point2 } from './draw-shape'
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
  /**
   * Çizim kipi ve taslak köşeler.
   *
   * Hem ref hem state: olay dinleyicileri efektin kapanışında yaşıyor ve
   * state'in eski değerini görürdü (araçtaki `rotationRef`in aynı gerekçesi);
   * state yalnız önizlemeyi yeniden çizdirmek için.
   */
  const drawingRef = useRef(false)
  const draftRef = useRef<Point2[]>([])
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState<Point2[]>([])
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

    /**
     * Çizilmiş şekli düğüme çevir ve sahneye koy.
     *
     * Dikdörtgen yerleştirmeyle aynı commit yolu — tek fark `polygon` ve
     * konumun ağırlık merkezinden gelmesi. Dönüş SIFIR: kullanıcı şekli
     * zaten istediği yönde çizdi, üstüne bir de araç dönüşü uygulamak onu
     * çizdiği yerden kaydırırdı.
     */
    const commitOutline = (): boolean => {
      const finished = finishOutline(draftRef.current)
      if (!finished) return false

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const committed = MezzanineNode.parse({
        ...previewNode,
        id: previewNode.id,
        name: 'Mezzanine',
        position: finished.position,
        rotation: [0, 0, 0],
        polygon: finished.polygon,
        parentId: activeLevelId,
        supportSlabId:
          electSupportSlab(nodes, activeLevelId, finished.position[0], finished.position[2]) ??
          GROUND_SUPPORT_ID,
      })

      useScene.getState().createNode(committed as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [committed.id as AnyNodeId] })
      triggerSFX('sfx:item-place')

      draftRef.current = []
      setDraft([])
      setDrawing(false)
      setPlacementSerial((serial) => serial + 1)
      return true
    }

    const unsubscribeClicks = subscribePlacementClicks((event) => {
      const position = lastPositionRef.current
      if (!position) return

      // ── Çizim kipi: tıklama köşe ekler, ilk köşeye dönmek kapatır ──────
      if (drawingRef.current) {
        const point: Point2 = [position[0], position[2]]
        const first = draftRef.current[0]
        if (first && draftRef.current.length >= 3 && closeEnough(point, first)) {
          commitOutline()
        } else {
          draftRef.current = [...draftRef.current, point]
          setDraft(draftRef.current)
          triggerSFX('sfx:grid-snap')
        }
        event.stopPropagation?.()
        return
      }

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

      // ── Çizim kipi ────────────────────────────────────────────────────
      if (event.key === 'd' || event.key === 'D') {
        event.preventDefault()
        draftRef.current = []
        setDraft([])
        drawingRef.current = !drawingRef.current
        setDrawing(drawingRef.current)
        return
      }
      if (drawingRef.current) {
        if (event.key === 'Enter') {
          event.preventDefault()
          commitOutline()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          // Bir köşe geri al; boşta ise çizim kipinden çık.
          if (draftRef.current.length > 0) {
            draftRef.current = draftRef.current.slice(0, -1)
            setDraft(draftRef.current)
          } else {
            drawingRef.current = false
            setDrawing(false)
          }
          return
        }
        // Çizerken döndürme yok: şekil zaten istenen yönde çiziliyor.
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
  }, [activeLevelId, previewNode, boxDimensions])

  if (!activeLevelId) return null

  /**
   * Çizim önizlemesi — köşe işaretleri ve aralarındaki kenarlar.
   *
   * Kutu primitifleriyle: bu paketin bütün geometrisi kutu ve çizgi için
   * ayrı bir malzeme yolu açmak, önizleme uğruna render yoluna yeni bir
   * kavram sokmak olurdu. Son kenar imlece kadar uzuyor, yani kullanıcı
   * kapanışı tıklamadan önce görüyor.
   */
  const draftEdges = drawing
    ? draft.map((point, i) => {
        const next = draft[i + 1] ?? [cursorPosition[0], cursorPosition[2]]
        const dx = next[0] - point[0]
        const dz = next[1] - point[1]
        const length = Math.hypot(dx, dz)
        return {
          key: `${point[0]},${point[1]}`,
          center: [point[0] + dx / 2, 0.02, point[1] + dz / 2] as [number, number, number],
          length,
          angle: Math.atan2(dz, dx),
        }
      })
    : []

  return (
    <>
      {/* Çizerken dikdörtgen hayalet gizli — iki şekil aynı anda yanıltır. */}
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible && !drawing}>
        <MezzaninePreview node={previewNode} />
      </group>
      {cursorVisible && !drawing && (
        <PlacementBox
          dimensions={boxDimensions}
          measurements={{ unit }}
          position={cursorPosition}
          rotationY={cursorRotationY}
          valid={valid}
        />
      )}

      {drawing && (
        <group layers={EDITOR_LAYER}>
          {draft.map((point) => (
            <mesh key={`v-${point[0]},${point[1]}`} position={[point[0], 0.03, point[1]]}>
              <boxGeometry args={[0.22, 0.06, 0.22]} />
              <meshBasicMaterial color="#e69a47" depthTest={false} />
            </mesh>
          ))}
          {draftEdges.map((edge) => (
            <mesh key={`e-${edge.key}`} position={edge.center} rotation={[0, -edge.angle, 0]}>
              <boxGeometry args={[edge.length, 0.03, 0.06]} />
              <meshBasicMaterial color="#e69a47" depthTest={false} />
            </mesh>
          ))}
        </group>
      )}
    </>
  )
}
