'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
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
  useFacingPose,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { areClearAt } from '../clash'
import {
  electSupportSlab,
  resolveAlignedPlacement,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
} from '../placement'
import { useWarehouseStore } from '../store'
import { multiplyPlacements, runExtent } from './multiply'
import { placeRun } from './multiply-command'
import PalletRackPreview from './preview'
import { PalletRackNode } from './schema'
import { totalDepth } from './slots'

/** 45° steps, matching the R / T rotation every built-in placement tool uses. */
const ROTATION_STEP = Math.PI / 4

/** Ghost bays drawn at the cursor before the box stands in for the rest. */
const GHOST_LIMIT = 200

/**
 * Placement for a racking run.
 *
 * Composed from the same published host primitives the pallet tool uses, so a
 * rack snaps, aligns, measures and refuses overlaps exactly like a built-in
 * kind rather than approximately like one.
 *
 * `[` and `]` change how many bays a click lays down, which is the dimension you
 * actually adjust against a wall you can see. A bay is a node, so what the click
 * commits is a whole run through `placeRun` — the same arithmetic and the same
 * single undo step as the panel's Multiply button, so a run laid down with `]`
 * and a run grown from the panel are indistinguishable afterwards.
 *
 * There is deliberately no Shift gesture here. The host binds Shift to cycling
 * the snapping mode whenever a snap context is active, and this kind declares
 * `snapProfile: 'item'`, so a tool-local Shift would fire both at once — the
 * user reaching for one behaviour and silently getting the other as well.
 */
export default function PalletRackTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const brush = useWarehouseStore((s) => s.rackBrush)

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
  /** En son React'e bildirilen kutu merkezi — tekrarını yazmamak için. */
  const cursorPositionRef = useRef<[number, number, number] | null>(null)

  const spec = useWarehouseStore((s) => s.multiply)

  const previewNode = useMemo(
    () => PalletRackNode.parse({ ...brush, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [brush],
  )

  /**
   * The whole run's footprint, not one bay's.
   *
   * What the click commits is a run, so what the box collides and draws has to
   * be the run — a box the size of the first bay would happily report a fit for
   * twenty bays laid through a wall. `centerLocal` carries the offset, because
   * the bay under the cursor is an *end* of the run rather than its middle.
   */
  const extent = useMemo(() => runExtent(previewNode, spec), [previewNode, spec])
  // `collisionWidth`, not `width`: the box is a validity indicator, so it has to
  // draw exactly what is being tested. The steel overhangs it by half an upright
  // at each end, which is what lets the next run sit against this one.
  const boxDimensions = useMemo(
    (): [number, number, number] => [
      extent.collisionWidth,
      previewNode.uprightHeight,
      extent.depth,
    ],
    [extent, previewNode.uprightHeight],
  )

  /**
   * The rest of the run as a ghost, already in the cursor group's local frame —
   * `previewNode` sits at the origin unrotated, so the placements come out local
   * and the group's own transform carries them.
   *
   * Capped, and said out loud rather than left to be noticed: the placement box
   * always shows the run's true extent, but past a couple of hundred ghost bays
   * the cursor costs more per frame than the scene being placed into.
   */
  const ghosts = useMemo(
    () => multiplyPlacements(previewNode, spec).slice(0, GHOST_LIMIT),
    [previewNode, spec],
  )

  /**
   * Hayalet ağacı ELEMAN olarak önbelleklenir, veri olarak değil.
   *
   * İmleç her kımıldadığında bu bileşen yeniden render oluyor (yerleştirme
   * kutusunun konumu state'te), ve `ghosts.map(...)` her seferinde iki yüz
   * yeni React elemanı üretiyordu — iki yüz `<group>` artı iki yüz
   * `PalletRackPreview`, hepsi de bir öncekiyle aynı. React bir elemanı bir
   * öncekiyle REFERANSTAN eşit görürse o alt ağacı hiç uzlaştırmıyor; dizi
   * `useMemo` ile sabitlenince kutu hareket ederken hayaletler tamamen atlanır.
   *
   * Bağımlılıklar, ağacın gerçekten değişebileceği iki şey: koşunun uzunluğu
   * (`ghosts`) ve gözün şekli (`previewNode`).
   */
  const ghostTree = useMemo(
    () =>
      ghosts.map((ghost) => (
        <group
          key={`${ghost.position[0]}:${ghost.position[2]}`}
          position={ghost.position}
          rotation={ghost.rotation}
        >
          <PalletRackPreview node={previewNode} />
        </group>
      )),
    [ghosts, previewNode],
  )

  /**
   * The run's shape, read through a ref rather than a dependency.
   *
   * The subscription effect below resets the rotation and hides the cursor when
   * it re-runs, which is right for a level change and wrong for everything else.
   * With `extent` in its deps, pressing `]` — which only grows the run — tore the
   * whole thing down: the rotation the user had set with R/T snapped back to 0
   * and the ghost vanished until the mouse moved again. Adjusting the run length
   * against a wall is exactly when the rotation matters most.
   */
  const extentRef = useRef(extent)
  extentRef.current = extent
  const boxRef = useRef(boxDimensions)
  boxRef.current = boxDimensions

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

    /** The run's middle, from the first bay's position. The bay is what the
     *  cursor carries; the box has to cover everything behind it. */
    const runCenter = (
      origin: [number, number, number],
      rotationY: number,
    ): [number, number, number] => {
      const [localX, localZ] = extentRef.current.centerLocal
      const cos = Math.cos(rotationY)
      const sin = Math.sin(rotationY)
      return [
        origin[0] + localX * cos + localZ * sin,
        origin[1],
        origin[2] - localX * sin + localZ * cos,
      ]
    }

    const recomputeValidity = (visual: [number, number, number]) => {
      if (altRef.current) {
        validRef.current = true
        setValid(true)
        return
      }
      const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
        activeLevelId,
        runCenter(visual, rotationRef.current),
        boxRef.current,
        [0, rotationRef.current, 0],
        [],
      )
      // And the package's own three-dimensional test, per bay of the run. The
      // host's is plan-only and blind to anything declaring `collides: false`,
      // which is how a bay could be dropped straight through a conveyor.
      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const rotationY = rotationRef.current
      const bay = { ...previewNode, rotation: [0, rotationY, 0] }
      const positions = [
        visual,
        ...multiplyPlacements(
          { ...bay, position: visual } as typeof previewNode,
          useWarehouseStore.getState().multiply,
        ).map((placement) => placement.position),
      ]
      /**
       * Tek çağrı, tek parça listesi.
       *
       * Göz başına `isClearAt` çağırmak, gözün `rackParts('full')` listesini
       * ve ondan türeyen dünya kutularını FARE OLAYI BAŞINA göz sayısı kadar
       * yeniden kuruyordu — iki yüz gözlük bir koşuda iki yüz özdeş liste,
       * saniyede yüzlerce kez. `areClearAt` listeyi bir kez kurup her göz için
       * öteliyor ve ilk engelde duruyor.
       */
      const clear = areClearAt({ node: bay, positions, rotationY, nodes })
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
      // Kutunun merkezi gerçekten kımıldadıysa yaz. Taze dizi kimliği React'e
      // her harekette kaçamayacağı bir render ettiriyordu; ızgaraya oturmuş
      // imleç için o render'ların çoğu birebir aynı kareyi üretiyor.
      const center = runCenter(visual, rotationRef.current)
      if (!samePlacementPoint(cursorPositionRef.current, center)) {
        cursorPositionRef.current = center
        setCursorPosition(center)
      }
      lastPositionRef.current = position
      recomputeValidity(visual)

      useFacingPose.getState().set({
        position: visual,
        rotationY: rotationRef.current,
        depth: totalDepth(previewNode),
      })
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      setCursorVisible(true)
      // No centre offset: the cursor carries the *first bay*, and a bay is
      // centred on its own node. Aligning that one footprint rather than the
      // run's is what makes a bay snap flush against an existing one — which is
      // the gesture that puts two bays on a shared post.
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

    const commitAt = (position: [number, number, number]): void => {
      const current = useWarehouseStore.getState().rackBrush
      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const first = PalletRackNode.parse({
        ...current,
        position,
        rotation: [0, rotationRef.current, 0],
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
      })
      // The bay under the cursor and everything behind it in one write, so the
      // click is one undo step however long the run is.
      placeRun(first, useWarehouseStore.getState().multiply, activeLevelId)
    }

    const unsubscribeClicks = subscribePlacementClicks((event) => {
      const position = lastPositionRef.current
      if (!position) return
      if (!validRef.current) {
        // The red box already says why; swallow the click so it does not fall
        // through and select whatever is underneath.
        event.stopPropagation?.()
        return
      }

      commitAt(position)
      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()

      // The racks just placed are alignment targets for the next one.
      alignmentCandidates = collectAlignmentAnchors(
        useScene.getState().nodes,
        previewNode.id,
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

      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        const delta = event.key === ']' ? 1 : -1
        const store = useWarehouseStore.getState()
        store.setMultiply({ bays: Math.max(1, Math.min(200, store.multiply.bays + delta)) })
        return
      }

      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP
      else return
      event.preventDefault()
      triggerSFX('sfx:item-rotate')
      rotationRef.current += rotationDelta
      setCursorRotationY(rotationRef.current)
      // Rotation changes the footprint's collision span and its alignment
      // anchors, so re-resolve rather than only spinning the ghost.
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
    // Deliberately not `extent` or `boxDimensions`: both are read through refs
    // above, so growing the run with `[` / `]` adjusts the box in place instead
    // of tearing the tool down and losing the rotation with it.
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <>
      {/* The whole run as a ghost, laid out in the cursor group's local frame so
          the group's own rotation carries it. The bays share one cached
          geometry, so a twenty-bay ghost is twenty draws of a buffer that is
          already built rather than twenty builds. */}
      <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
        <PalletRackPreview node={previewNode} />
        {ghostTree}
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
