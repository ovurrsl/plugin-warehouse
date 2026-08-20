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
  disarmPlacementToolOnCommit,
  electSupportSlab,
  publishPlacementPreview,
  resolveAlignedPlacement,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
  useActiveLevel,
  useActiveLevelId,
} from '../placement'
import { useWarehouseStore } from '../store'
import { PLATFORM_LENGTHS } from './catalog'
import { aboveFloorHeightM, platformLengthM, widthM } from './metrics'
import DockLevellerPreview from './preview'
import { DockLevellerNode } from './schema'

/**
 * Yükleme rampası yerleştirme aracı.
 *
 * Dönüş adımı 90°, ailenin 45°'si DEĞİL: rampa bir kapının içine oturuyor ve
 * kapı duvarda. 45°'lik bir rampa hiçbir yerleşimde yok, ve ara adımlar
 * kullanıcıya dört doğru açıyı bulmak için sekiz tuşa basmak demekti.
 *
 * `[` / `]` TABLA BOYUNU dolaşıyor — çukurun boyu, yani binaya dökülen
 * betonu belirleyen ölçü, ve rampada yerleştirme sırasında gerçekten
 * ayarlanan tek şey o. Genişlik ve dudak panelden.
 */
const ROTATION_STEP = Math.PI / 2

export default function DockLevellerTool() {
  const activeLevelId = useActiveLevelId()
  const activeLevelNode = useActiveLevel()
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.dockLevellerBrush)
  const setBrush = useWarehouseStore((s) => s.setDockLevellerBrush)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)
  const [placementSerial, setPlacementSerial] = useState(0)

  const rotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  /** Son YAZILAN imleç merkezi — kutu kımıldamadıysa React'e render ettirme. */
  const cursorPositionRef = useRef<readonly [number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)

  /**
   * Önizleme düğümü. Hayalet her zaman DİNLENMEDE (`inclination: 0`)
   * gösteriliyor: kullanıcı çukuru yerleştiriyor, rampayı çalıştırmıyor, ve
   * kalkmış bir tabla yerleştirilecek izi olduğundan büyük gösterirdi.
   */
  const previewNode = useMemo(
    () =>
      DockLevellerNode.parse({
        ...brush,
        inclination: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [brush, placementSerial],
  )
  const ghostRef = useRef(previewNode)
  ghostRef.current = previewNode

  const boxDimensions = useMemo(
    (): [number, number, number] => [
      platformLengthM(previewNode),
      aboveFloorHeightM(previewNode),
      widthM(previewNode),
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

    /**
     * Hizalama çıpaları efekt başına BİR kez, `const` olarak.
     *
     * Yerleştirmeden sonra yeniden toplamak akla yakın ve YANLIŞ: bu araç
     * `id: previewNode.id` ile taahhüt ediyor, yani `collectAlignmentAnchors`'ın
     * dışladığı kimlik tam da az önce konan düğümün kimliği. Yeni toplama onu
     * ekleyemez, yalnız her tıklamada bütün sahneyi bir kez daha gezer. Gerek
     * de yok: taahhüt `placementSerial`'ı artırıyor → `previewNode` yenileniyor
     * → bu efekt zaten baştan koşuyor.
     */
    const alignmentCandidates: AlignmentAnchor[] = collectAlignmentAnchors(
      useScene.getState().nodes,
      previewNode.id,
      activeLevelId,
    )

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
        [platformLengthM(ghost), aboveFloorHeightM(ghost), widthM(ghost)],
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
      if (!samePlacementPoint(cursorPositionRef.current, position)) {
        cursorPositionRef.current = position
        setCursorPosition(position)
      }
      setCursorRotationY(rotationRef.current)
      lastPositionRef.current = position
      recomputeValidity(position)

      // Publish 2D floorplan placement preview
      publishPlacementPreview(
        {
          ...(ghostRef.current as unknown as AnyNode),
          position,
          rotation: [0, rotationRef.current, 0],
          parentId: activeLevelId,
        },
        activeLevelNode,
      )
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      setCursorVisible(true)
      /**
       * Ham imleç BURADA çözülüyor; `applyCursor`'a çözülmüş nokta gidiyor.
       *
       * Önceki hâl `applyCursor([rawX, 0, rawZ])` yazıyordu ve ızgara ayarı
       * yerleştirmeye hiç ulaşmıyordu. Yanıltıcı olan, aracın
       * `isGridSnapActive()`'i zaten OKUYOR olmasıydı — ama okuduğu yer
       * aşağıdaki ses anahtarı. Izgaraya oturunca "tık" sesi çıkıyor, nesne
       * oturmuyordu.
       */
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
      const committed = DockLevellerNode.parse({
        ...ghostRef.current,
        id: previewNode.id,
        position,
        rotation: [0, rotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })

      useScene.getState().createNode(committed as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [committed.id as AnyNodeId] })
      triggerSFX('sfx:item-place')

      disarmPlacementToolOnCommit(() => {
        setPlacementSerial((serial) => serial + 1)
      })
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
        const current = PLATFORM_LENGTHS.indexOf(ghostRef.current.length)
        const step = event.key === ']' ? 1 : -1
        const next = PLATFORM_LENGTHS[current + step]
        // Uçlarda sarmıyor: 4500'den 2000'e atlamak, tuşu basılı tutan
        // kullanıcının çukuru sessizce yarıya indirmesi demekti.
        if (!next || next === ghostRef.current.length) return
        setBrush({ length: next })
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
      // Araç bırakılınca kılavuzlar tuvalde asılı kalırdı.
      useAlignmentGuides.getState().clear()
      clearPlacementPreview()
    }
  }, [activeLevelId, previewNode, setBrush])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <DockLevellerPreview node={previewNode} />
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
