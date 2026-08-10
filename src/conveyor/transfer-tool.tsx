'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
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
  useFacingPose,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { isClearAt } from '../clash'
import {
  electSupportSlab,
  resolveAlignedPlacement,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
} from '../placement'
import { placementPose } from './placement-pose'
import { footprintM } from './transfer-metrics'
import ConveyorTransferPreview from './transfer-preview'
import { ConveyorTransferNode } from './transfer-schema'

/** 45° steps, matching the R / T rotation every built-in placement tool uses. */
const ROTATION_STEP = Math.PI / 4

/**
 * Placement for a mixed transfer.
 *
 * One at a time: this is the piece a line crosses at, and there is one of them
 * per crossing. `H` flips which side the box is taken off to — a mirror rather
 * than a rotation, since turning the machine round would also swap which end is
 * the infeed.
 *
 * **Validity is this tool's own, and that is the point.** The host's collision
 * test compares plan rectangles with no height at all, so it cannot tell a
 * conveyor threading the walkway under a racking run from one driven through its
 * uprights. `floorPlaced.collides` is therefore off and the test lives in
 * `../clash`, in three dimensions, against the volume this machine actually
 * occupies from the floor to the top of its guides.
 */
export default function ConveyorTransferTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)

  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([0, 0, 0])
  const [cursorRotationY, setCursorRotationY] = useState(0)
  const [valid, setValid] = useState(true)
  const [dischargeSide, setDischargeSide] = useState<'left' | 'right'>('left')

  const rotationRef = useRef(0)
  /**
   * ÇİZİLEN açı — kullanıcınınki değil.
   *
   * Mıknatıs bir uca oturttuğunda hayalet komşunun istediği açıya döner, ama
   * `rotationRef` kullanıcının R/T ile kurduğu açıyı tutmaya devam eder.
   * Tek ref'te birleştirmek, uçtan uzaklaşınca kullanıcının açısını kalıcı
   * olarak kaybetmek olurdu.
   */
  const poseRotationRef = useRef(0)
  const validRef = useRef(true)
  const altRef = useRef(false)
  const lastPositionRef = useRef<[number, number, number] | null>(null)
  /** Son YAZILAN imleç merkezi. Kapının belleği: kutu gerçekten kımıldamadıysa
   *  `setCursorPosition` hiç çağrılmaz. */
  const cursorPositionRef = useRef<readonly [number, number, number] | null>(null)
  const previousSnapRef = useRef<string | null>(null)

  const previewNode = useMemo(
    () => ConveyorTransferNode.parse({ dischargeSide, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [dischargeSide],
  )

  // Read through a ref so a rebuilt preview does not tear the tool down and lose
  // the rotation with it — the rack shipped that bug and it is the same here.
  const previewRef = useRef(previewNode)
  previewRef.current = previewNode

  const [width, depth] = footprintM(previewNode)

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
      previewRef.current.id,
      activeLevelId,
    )

    const recomputeValidity = (visual: [number, number, number]) => {
      if (altRef.current) {
        validRef.current = true
        setValid(true)
        return
      }
      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const rotationY = poseRotationRef.current
      const placed = ConveyorTransferNode.parse({
        ...previewRef.current,
        id: undefined,
        position: visual,
        rotation: [0, rotationY, 0],
      })
      const clear = isClearAt({ node: placed, position: visual, rotationY, nodes })
      validRef.current = clear
      setValid(clear)
    }

    const applyCursor = (position: [number, number, number]) => {
      const rotationY = poseRotationRef.current
      const visual = getFloorStackPreviewPosition({
        node: previewRef.current as unknown as AnyNode,
        position,
        rotation: [0, rotationY, 0],
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visual)
      cursorRef.current?.rotation.set(0, rotationY, 0)
      // A transfer's body is square and centred on its node, so the box and the
      // ghost share a position.
      // Kutunun merkezi gerçekten kımıldadıysa yaz. Taze dizi kimliği React'e
      // her fare hareketinde kaçamayacağı bir render ettiriyor; ızgaraya
      // oturmuş imleç için o render'ların çoğu birebir aynı kareyi üretiyor.
      if (!samePlacementPoint(cursorPositionRef.current, visual)) {
        cursorPositionRef.current = visual
        setCursorPosition(visual)
      }
      lastPositionRef.current = position
      recomputeValidity(visual)

      useFacingPose.getState().set({
        position: visual,
        rotationY: rotationY,
        depth: footprintM(previewRef.current)[1],
      })
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      setCursorVisible(true)
      const aligned = resolveAlignedPlacement({
        candidates: alignmentCandidates,
        node: previewRef.current as unknown as AnyNode,
        rawX,
        rawZ,
        rotationY: rotationRef.current,
      })
      /**
       * Mıknatıs hizalamanın ÜSTÜNDE: hizalama kılavuzu ayak izi kenarını
       * 8 cm'lik bir pencerede yaklaştırıyor, mıknatıs ise ucu uca TAM
       * oturtuyor ve gerekiyorsa modülü çeviriyor. İkisi aynı anda görünürse
       * kullanıcı hangisinin karar verdiğini bilemez, o yüzden mıknatıs
       * ateşlediğinde kılavuzlar temizleniyor.
       */
      const pose = placementPose(
        previewRef.current as unknown as AnyNode,
        aligned.position,
        rotationRef.current,
        useScene.getState().nodes as Readonly<Record<string, unknown>>,
      )
      useAlignmentGuides.getState().set(pose.snapped ? [] : aligned.guides)
      poseRotationRef.current = pose.rotationY
      setCursorRotationY(pose.rotationY)
      const position = pose.position
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
        // The red box already says why; swallow the click so it does not fall
        // through and select whatever is underneath.
        event.stopPropagation?.()
        return
      }

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const transfer = ConveyorTransferNode.parse({
        ...previewRef.current,
        id: undefined,
        position,
        rotation: [0, poseRotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })
      // Through `applyNodeChanges` rather than `createNode`, so a bend lands the
      // same way a run of straights does: one store write, one undo step, and
      // the new node selected when it arrives.
      useScene.getState().applyNodeChanges({
        create: [{ node: transfer as unknown as AnyNode, parentId: activeLevelId as AnyNodeId }],
      })
      useViewer.getState().setSelection({ selectedIds: [transfer.id] as unknown as AnyNodeId[] })

      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()
      alignmentCandidates = collectAlignmentAnchors(
        useScene.getState().nodes,
        previewRef.current.id,
        activeLevelId,
      )
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

      if (event.key === 'h' || event.key === 'H') {
        event.preventDefault()
        triggerSFX('sfx:item-rotate')
        setDischargeSide((current) => (current === 'left' ? 'right' : 'left'))
        return
      }

      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP
      else return
      event.preventDefault()
      triggerSFX('sfx:item-rotate')
      rotationRef.current += rotationDelta
      // Kullanıcı çevirdiği an mıknatısın bıraktığı açı düşer; bir sonraki
      // fare hareketi hâlâ menzildeyse yeniden ateşler.
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
      unsubscribeClicks()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      // Covers commit, Esc, kind switch and unmount uniformly — a guide or a
      // facing triangle left behind lingers over the canvas with no owner.
      useAlignmentGuides.getState().clear()
      useFacingPose.getState().clear()
    }
    // Deliberately not `previewNode`: it is read through a ref.
  }, [activeLevelId])

  if (!activeLevelId) return null

  return (
    <>
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <ConveyorTransferPreview node={previewNode} />
      </group>
      {cursorVisible && (
        <PlacementBox
          dimensions={[width, previewNode.transportHeight, depth]}
          measurements={{ unit }}
          position={cursorPosition}
          rotationY={cursorRotationY}
          valid={valid}
        />
      )}
    </>
  )
}
