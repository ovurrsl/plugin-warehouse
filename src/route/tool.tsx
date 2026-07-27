'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  snapPointAlongAngleRay,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import {
  isAngleSnapActive,
  isGridSnapActive,
  PlacementBox,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { electSupportSlab, subscribeGridClicks, subscribeGridMove } from '../placement'
import { useWarehouseStore } from '../store'
import { MAX_VERTICES } from './constants'
import RoutePreview from './preview'
import { RouteNode } from './schema'
import type { Point } from './stripes'

/**
 * Drawing a route: click each corner, double-click or Enter to finish.
 *
 * ## What the first version got wrong, and why
 *
 * It was written by copying the pallet's tool, which places one object per
 * click — so it had no notion of a click that ADDS versus a click that ENDS,
 * because a one-shot tool never needs one. Three consequences followed, and all
 * three are fixed here:
 *
 * 1. It subscribed to every click-trigger kind, and a physical click reaches
 *    that list twice (a node synthesizes one on `pointerup`, the canvas emits
 *    another on the browser's `click`). Every corner became two coincident
 *    vertices — which also silently defeated the mitre, since a zero-length leg
 *    has no direction to bisect. It now listens to the canvas alone and reads
 *    the native `detail` to tell the finishing click from an ordinary one, the
 *    way the host's own wall tool does.
 * 2. The angle lock was gated on `isGridSnapActive()`. The modes are mutually
 *    exclusive, so the lock was live in Grid and dead in Angles — exactly
 *    backwards, and the chip labelled "Angles" gave a raw cursor.
 * 3. It rendered nothing until two draft points existed, so arming the tool and
 *    moving the cursor showed no feedback at all.
 */

export default function RouteTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const gridStep = useEditor((s) => s.gridSnapStep)
  const brush = useWarehouseStore((s) => s.routeBrush)

  const [vertices, setVertices] = useState<Point[]>([])
  const [cursor, setCursor] = useState<Point | null>(null)
  const [valid, setValid] = useState(false)

  const verticesRef = useRef<Point[]>([])
  const cursorRef = useRef<Point | null>(null)
  const validRef = useRef(false)
  const brushRef = useRef(brush)
  const gridStepRef = useRef(gridStep)
  brushRef.current = brush
  gridStepRef.current = gridStep

  useEffect(() => {
    if (!activeLevelId) return

    const clearDraft = () => {
      verticesRef.current = []
      setVertices([])
    }

    /**
     * The snap ladder — **one positional constraint, never two.**
     *
     * `resolveSnapFlags` makes the modes exclusive: grid quantises only in
     * Grid, the angle lock engages only in Angles. So there is nothing to
     * reconcile, and the previous version's bug was not bad reconciliation but
     * applying both transforms in sequence off the same flag: it quantised to
     * the lattice and then rotated about the previous corner, which lands the
     * point off the lattice again and leaves the leg length unquantised
     * entirely — the "rubber leg" feel.
     *
     * `snapPointAlongAngleRay` is the host's own primitive and does the right
     * thing: it PROJECTS onto the snapped ray and quantises the distance ALONG
     * it, so the result stays exactly on the ray.
     */
    const snap = (raw: Point): Point => {
      const step = isGridSnapActive() ? gridStepRef.current : 0
      const last = verticesRef.current.at(-1)
      if (isAngleSnapActive() && last) {
        const [x, z] = snapPointAlongAngleRay(
          [last[0], last[1]],
          [raw[0], raw[1]],
          DEFAULT_ANGLE_STEP,
          step,
        )
        return [x, z]
      }
      const [x, z] = snapPointToGrid([raw[0], raw[1]], step)
      return [x, z]
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      const point = snap([rawX, rawZ])
      cursorRef.current = point
      setCursor(point)

      // **You cannot paint on air.** Refused on geometry alone — never on
      // width, because a verdict against an estimated band would launder the
      // estimate into a compliance statement.
      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const onSlab = electSupportSlab(nodes, activeLevelId, point[0], point[1]) !== null
      validRef.current = onSlab
      setValid(onSlab)
    })

    const finish = () => {
      const drawn = verticesRef.current
      const origin = drawn[0]
      // Fewer than two corners is not a route. The draft is dropped and the
      // tool stays armed, which is what both host polyline tools do.
      if (drawn.length < 2 || !origin) {
        clearDraft()
        return
      }

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const node = RouteNode.parse({
        ...brushRef.current,
        position: [origin[0], 0, origin[1]],
        points: drawn.map((p) => [p[0] - origin[0], p[1] - origin[1]]),
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, origin[0], origin[1]),
        name: brushRef.current.role === 'vehicle' ? 'Araç Koridoru' : 'Yaya Yolu',
      })

      useScene.getState().createNode(node as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
      clearDraft()
    }

    const unsubscribeClicks = subscribeGridClicks((_event, detail) => {
      // The second click of a gesture ends the run instead of adding to it.
      // Read from the browser rather than from a `dblclick` listener, so a
      // double-click anywhere off the canvas cannot commit a route.
      if (detail >= 2) {
        finish()
        return
      }

      const point = cursorRef.current
      if (!point || !validRef.current) return

      const last = verticesRef.current.at(-1)
      // Two clicks in one grid cell would place a zero-length leg, which has no
      // direction and so cannot be mitred.
      if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 1e-6) return
      // Refused rather than thrown. `RouteNode.parse` would raise out of an
      // event handler and take every later commit with it.
      if (verticesRef.current.length >= MAX_VERTICES) return

      verticesRef.current = [...verticesRef.current, point]
      setVertices(verticesRef.current)
      triggerSFX('sfx:grid-snap')
    })

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // A panel field is being typed into; every key here belongs to it.
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Escape') {
        event.preventDefault()
        // Drops the draft and stays armed. A second Escape with nothing to
        // cancel reaches the host and puts the tool away — the editor-wide
        // two-stage behaviour a user already knows from walls and slabs.
        if (verticesRef.current.length > 0) event.stopPropagation()
        clearDraft()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        finish()
        return
      }
      if (event.key === 'Backspace' && verticesRef.current.length > 0) {
        event.preventDefault()
        // Stopped as well as prevented: without this the host's own delete
        // handler sees the same key and removes the current selection.
        event.stopPropagation()
        verticesRef.current = verticesRef.current.slice(0, -1)
        setVertices(verticesRef.current)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      unsubscribeMove()
      unsubscribeClicks()
      document.removeEventListener('keydown', onKeyDown, true)
      clearDraft()
      cursorRef.current = null
      setCursor(null)
    }
  }, [activeLevelId])

  const draft: Point[] = cursor ? [...vertices, cursor] : vertices

  return (
    <>
      {/* Mounted from the first cursor move, not from the second vertex. The
          previous version showed nothing at all until a click had landed, so an
          armed tool looked like a broken one. */}
      {cursor && (
        <PlacementBox
          dimensions={[0.35, 0.02, 0.35]}
          position={[cursor[0], 0.01, cursor[1]]}
          rotationY={0}
          valid={valid}
        />
      )}
      {draft.length >= 2 && <RoutePreview brush={brush} points={draft} />}
    </>
  )
}
