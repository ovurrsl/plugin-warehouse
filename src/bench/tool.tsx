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
import { BENCH_VARIANT_IDS } from './catalog'
import { depthM, overallHeightM, widthM } from './metrics'
import BenchPreview from './preview'
import { BenchNode } from './schema'

const ROTATION_STEP = Math.PI / 4

/**
 * Tezgâh yerleştirme aracı.
 *
 * `[` / `]` VARYANT değiştirir, ölçü değil — ailenin öteki araçlarında o
 * tuşlar yerleştirme sırasında ayarlanan tek ölçüyü sürüyor (kanal derinliği,
 * mast, bom uzaması), burada ise ayarlanabilir ölçü ÜÇ tane ve hangisinin
 * tuşa bağlanacağının doğru cevabı yok. Varyant tek tuşla dolaşılabilen
 * anlamlı eksen: kullanıcı altı masayı görüp birini seçiyor.
 *
 * Varyant değiştikten sonra `applyCursor` yeniden çağrılıyor: zarf değişti,
 * geçerlilik eski ölçüyle hesaplanmış kalırsa masa duvarın içine
 * büyütülüp yeşil kutuyla taahhüt edilebilir.
 */
export default function BenchTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.benchBrush)
  const setBrush = useWarehouseStore((s) => s.setBenchBrush)

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
  /** Son YAZILAN imleç merkezi. Kapının belleği: kutu gerçekten kımıldamadıysa
   *  `setCursorPosition` hiç çağrılmaz. */
  const cursorPositionRef = useRef<readonly [number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)

  /** Kimliği SABİT önizleme düğümü. Fırça değişince yenileniyor; kimliğin
   *  yerleştirme `useEffect`'inin bağımlılığı olması, her varyant değişiminde
   *  aboneliklerin sökülüp kurulmasına yol açardı. */
  const previewNode = useMemo(
    () => BenchNode.parse({ ...brush, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [brush, placementSerial],
  )
  const ghostRef = useRef(previewNode)
  ghostRef.current = previewNode

  const boxDimensions = useMemo(
    (): [number, number, number] => [
      widthM(previewNode),
      overallHeightM(previewNode),
      depthM(previewNode),
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
      const ghost = ghostRef.current
      const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
        activeLevelId,
        position,
        [widthM(ghost), overallHeightM(ghost), depthM(ghost)],
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
      const committed = BenchNode.parse({
        ...ghostRef.current,
        id: previewNode.id,
        name: 'Bench',
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
        const current = BENCH_VARIANT_IDS.indexOf(ghostRef.current.variant)
        const step = event.key === ']' ? 1 : -1
        const next =
          BENCH_VARIANT_IDS[(current + step + BENCH_VARIANT_IDS.length) % BENCH_VARIANT_IDS.length]
        if (!next || next === ghostRef.current.variant) return
        // Varyantla birlikte ELLE girilmiş ölçüler de temizleniyor: kullanıcı
        // başka bir masaya geçiyor, öncekinin ölçüsünü taşımak yenisini
        // katalog dışı bir zarfla koyardı ve sebebi görünmezdi.
        setBrush({ variant: next, width: undefined, height: undefined, depth: undefined })
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
  }, [activeLevelId, previewNode, setBrush])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <BenchPreview node={previewNode} />
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
