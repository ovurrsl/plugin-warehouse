'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { isGridSnapActive, PlacementBox, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { electSupportSlab, snapXZ, subscribeGridMove, subscribePlacementClicks } from '../placement'
import { useWarehouseStore } from '../store'
import RoutePreview from './preview'
import { RouteNode } from './schema'
import type { Point } from './stripes'

/**
 * Drawing a route: click for each corner, double-click or Enter to finish.
 *
 * ## The angle lock, and why it binds no key
 *
 * A route is set out along a building, so its legs are almost always square or
 * at 45°, and a leg that is 1.7° off looks identical on screen while making a
 * 3.20 m aisle 3.17 m at the far end of a sixty-metre run. The lock is
 * therefore on by default — but it follows `isGridSnapActive()`, the host's own
 * choke point for the active snapping mode, rather than binding a modifier.
 *
 * The host owns Shift for cycling that mode, and a tool that grabbed it would
 * fight the editor everywhere else. Turning snapping off turns the angle lock
 * off with it, which is the behaviour a user who reached for that switch wants.
 */

const ANGLE_STEP = Math.PI / 12

function snapToAngle(from: Point, to: Point): Point {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return to
  const snapped = Math.round(Math.atan2(dz, dx) / ANGLE_STEP) * ANGLE_STEP
  return [from[0] + Math.cos(snapped) * length, from[1] + Math.sin(snapped) * length]
}

export default function RouteTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const brush = useWarehouseStore((s) => s.routeBrush)

  const [vertices, setVertices] = useState<Point[]>([])
  const [cursor, setCursor] = useState<Point | null>(null)
  const [valid, setValid] = useState(true)

  const verticesRef = useRef<Point[]>([])
  const cursorRef = useRef<Point | null>(null)
  const validRef = useRef(true)
  const brushRef = useRef(brush)
  brushRef.current = brush

  useEffect(() => {
    if (!activeLevelId) return

    const reset = () => {
      verticesRef.current = []
      cursorRef.current = null
      setVertices([])
      setCursor(null)
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      const snappedToGrid = isGridSnapActive() ? snapXZ(rawX, rawZ) : ([rawX, rawZ] as const)
      let point: Point = [snappedToGrid[0], snappedToGrid[1]]

      const previous = verticesRef.current.at(-1)
      if (previous && isGridSnapActive()) point = snapToAngle(previous, point)

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

    const commit = () => {
      const drawn = verticesRef.current
      if (drawn.length < 2) return
      const origin = drawn[0]
      if (!origin) return

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const node = RouteNode.parse({
        ...brushRef.current,
        position: [origin[0], 0, origin[1]],
        // Relative to the first vertex, so the node's position is its start and
        // the geometry key is translation-invariant.
        points: drawn.map((p) => [p[0] - origin[0], p[1] - origin[1]]),
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, origin[0], origin[1]),
        name: brushRef.current.role === 'vehicle' ? 'Araç Koridoru' : 'Yaya Yolu',
      })

      useScene.getState().createNode(node as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
      reset()
    }

    const unsubscribeClicks = subscribePlacementClicks((event) => {
      const point = cursorRef.current
      if (!point) return
      if (!validRef.current) {
        // The red box already says why. Swallow the click so it does not fall
        // through and select the floor instead.
        event.stopPropagation?.()
        return
      }
      verticesRef.current = [...verticesRef.current, point]
      setVertices(verticesRef.current)
      triggerSFX('sfx:grid-snap')
      event.stopPropagation?.()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        event.preventDefault()
        reset()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        commit()
        return
      }
      // Backspace walks the run back a corner at a time, which is what a user
      // reaches for after one misplaced click — the alternative is starting the
      // whole route again.
      if (event.key === 'Backspace' && verticesRef.current.length > 0) {
        event.preventDefault()
        verticesRef.current = verticesRef.current.slice(0, -1)
        setVertices(verticesRef.current)
      }
    }

    const onDoubleClick = () => commit()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('dblclick', onDoubleClick)
    return () => {
      unsubscribeMove()
      unsubscribeClicks()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('dblclick', onDoubleClick)
      reset()
    }
  }, [activeLevelId])

  // Disarm when the tool is put away mid-draw, so a half-drawn route does not
  // reappear the next time the tool is picked up.
  const tool = useEditor((s) => s.tool)
  useEffect(() => {
    if (tool !== 'warehouse:route') {
      verticesRef.current = []
      setVertices([])
    }
  }, [tool])

  const draft: Point[] = cursor ? [...vertices, cursor] : vertices
  if (draft.length < 2) return null

  return (
    <>
      <RoutePreview brush={brush} points={draft} />
      {cursor && !valid && (
        <PlacementBox
          dimensions={[0.6, 0.05, 0.6]}
          position={[cursor[0], 0, cursor[1]]}
          rotationY={0}
          valid={false}
        />
      )}
    </>
  )
}
