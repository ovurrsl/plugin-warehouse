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
  electSupportSlab,
  publishPlacementPreview,
  resolveAlignedPlacement,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
} from '../placement'
import { useWarehouseStore } from '../store'
import { bayPitch, totalDepth } from './bays'
import { snapToNeighbourSeam } from './magnet'
import M3Preview from './preview'
import { M3ShelvingNode } from './schema'
import { SLOT_PITCH } from './standards'

const ROTATION_STEP = Math.PI / 4

/**
 * Bay placement.
 *
 * `[` / `]` change the **level count** — the one dimension a shelving bay is
 * specified by while it is being placed. Levels are added and removed at the
 * top and spread over the frame, so the gesture reads as "taller / shorter bay"
 * rather than as an edit to a particular shelf.
 *
 * Every key that changes a dimension re-runs `applyCursor`: the conveyor tool
 * shipped the version that did not, so growing a module with a key while the
 * mouse was still left validity computed against the old size — and a bay could
 * be grown into a wall and committed with a green box.
 */
export default function M3Tool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.m3Brush)

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
      M3ShelvingNode.parse({
        shelfLength: brush.shelfLength,
        shelfDepth: brush.shelfDepth,
        frameHeight: brush.frameHeight,
        frameVariant: brush.frameVariant,
        backPanel: brush.backPanel,
        door: brush.door,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [brush, placementSerial],
  )

  const ghostNode = useMemo(() => {
    // Levels spread from the first shelf to just under the frame top, and each
    // one lands on the 25 mm grid — the ghost has to stand where the click will
    // put it, not near it.
    const first = 0.3
    const usable = Math.max(0.2, previewNode.frameHeight - first - 0.2)
    const step = levelCount > 1 ? usable / (levelCount - 1) : 0
    return {
      ...previewNode,
      levels: Array.from({ length: levelCount }, (_, index) => ({
        elevation: Math.round((first + index * step) / SLOT_PITCH) * SLOT_PITCH,
        structure: brush.structure,
        model: brush.model,
        dividers: 0,
        drawerModel: 'MA' as const,
        drawerWidth: 'wide' as const,
      })),
    }
  }, [previewNode, levelCount, brush.structure, brush.model])

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
      // 2B plan hayaleti: 3B mesh'i plana geçince gizleniyor, planın
      // kendi gölgesi yalnız bu store'dan besleniyor.
      publishPlacementPreview(ghostNode, position, rotationRef.current)
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
      /**
       * Üç aşama, ve SIRASI önemli: ızgara → hizalama → komşu ek yeri.
       *
       * Önceki hâl `applyCursor([rawX, 0, rawZ])` yazıyordu; ızgara ayarı
       * yerleştirmeye hiç ulaşmıyordu. Yanıltıcı olan, aracın
       * `isGridSnapActive()`'i zaten OKUYOR olmasıydı — ama okuduğu yer
       * aşağıdaki ses anahtarı.
       *
       * Yalnız `resolveAlignedPlacement` eklemek bu kindʼi BOZARDI. Host'un
       * yapışma kipleri BİRBİRİNİ DIŞLIYOR: `grid` kipinde kuantalama var ve
       * mıknatıslı çekiş YOK. Ek yeri aralığı hiçbir ızgara adımının katı
       * olmadığı için, kuantalanmış imleç ek yerine hiç ulaşamaz; bitişik bay
       * bir kaç santim bindiği için geçerlilik kırmızıya döner ve tıklama
       * yutulur. Izgarayı yok saymak bir hataydı; onu ek yerini ULAŞILMAZ
       * kılacak şekilde eklemek daha büyük bir hata olurdu — kindʼin etrafında
       * kurulduğu hareket tümden kaybolurdu.
       *
       * Bu yüzden kindʼin kendi ek yeri mıknatısı en üste biniyor. Desen
       * uydurma değil: yedi konveyör aracı `placementPose`'u tam bu şekilde
       * `resolveAlignedPlacement`'ın çıktısının üstüne koyuyor. Mıknatıs
       * ateşlerken hizalama kılavuzları susuyor — iki farklı hedefi aynı anda
       * göstermek kullanıcıya hangisinin kazandığını sormak olurdu.
       */
      const aligned = resolveAlignedPlacement({
        candidates: alignmentCandidates,
        node: previewNode as unknown as AnyNode,
        rawX,
        rawZ,
        rotationY: rotationRef.current,
      })
      const ghostNow = { ...ghostRef.current, rotation: [0, rotationRef.current, 0] }
      const seam = snapToNeighbourSeam(
        ghostNow as never,
        aligned.position,
        [previewNode.id],
        useScene.getState().nodes as Readonly<Record<string, unknown>>,
      )
      const position = seam ?? aligned.position
      useAlignmentGuides.getState().set(seam ? [] : aligned.guides)
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
      const committed = M3ShelvingNode.parse({
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
      clearPlacementPreview()
      unsubscribeClicks()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      // Araç bırakılınca kılavuzlar tuvalde asılı kalırdı.
      useAlignmentGuides.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <M3Preview node={ghostNode} />
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
