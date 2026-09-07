'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { PlacementBox, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { slabAt } from '../host-adapter'
import {
  clearPlacementPreview,
  collectSlabs,
  disarmPlacementToolOnCommit,
  electSupportSlab,
  resolveAlignedPlacement,
  subscribeGridClicks,
  subscribeGridMove,
  useActiveLevelId,
} from '../placement'
import type { RouteNode } from '../route/schema'
import { CrosswalkNode } from './schema'

/**
 * Finds the nearest point and heading on a route polyline to a world point [wx, wz].
 */
function snapToNearestRoute(
  worldX: number,
  worldZ: number,
  routes: RouteNode[],
): {
  snappedPos: [number, number, number]
  rotationY: number
  width: number
  routeId: string
  t: number
} | null {
  let bestDist = Infinity
  let bestResult: {
    snappedPos: [number, number, number]
    rotationY: number
    width: number
    routeId: string
    t: number
  } | null = null

  for (const route of routes) {
    const rx = route.position[0]
    const rz = route.position[2]
    const pts = route.points
    if (pts.length < 2) continue

    let totalLength = 0
    const legLengths: number[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!
      const p2 = pts[i + 1]!
      const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
      legLengths.push(d)
      totalLength += d
    }
    if (totalLength <= 1e-6) continue

    let distAccum = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!
      const p2 = pts[i + 1]!
      const legLen = legLengths[i]!
      if (legLen <= 1e-6) continue

      const ax = rx + p1[0]
      const az = rz + p1[1]
      const bx = rx + p2[0]
      const bz = rz + p2[1]

      const dx = bx - ax
      const dz = bz - az
      const legDistSq = dx * dx + dz * dz

      // Projection parameter u clamped to [0, 1]
      const u = Math.max(0, Math.min(1, ((worldX - ax) * dx + (worldZ - az) * dz) / legDistSq))
      const projX = ax + u * dx
      const projZ = az + u * dz
      const dist = Math.hypot(worldX - projX, worldZ - projZ)

      // Only snap if within reasonable snapping distance (e.g. within route width + 2m)
      const maxSnapDist = (route.width ?? 3.5) / 2 + 2.0
      if (dist < maxSnapDist && dist < bestDist) {
        bestDist = dist
        const heading = Math.atan2(dx, dz)
        const currentDist = distAccum + u * legLen
        bestResult = {
          snappedPos: [projX, route.position[1], projZ],
          rotationY: heading,
          width: route.width ?? 3.5,
          routeId: route.id,
          t: currentDist / totalLength,
        }
      }
      distAccum += legLen
    }
  }

  return bestResult
}

export default function CrosswalkTool() {
  const activeLevelId = useActiveLevelId()
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)
  const [rotationY, setRotationY] = useState(0)
  const [activeWidth, setActiveWidth] = useState(3.5)
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null)
  const [activeT, setActiveT] = useState(0.5)
  const [valid, setValid] = useState(false)

  const cursorRef = useRef(cursor)
  cursorRef.current = cursor

  useEffect(() => {
    if (!activeLevelId) return

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      const nodes = useScene.getState().nodes as Record<string, unknown>
      const routes: RouteNode[] = []
      for (const n of Object.values(nodes)) {
        if ((n as { type?: string })?.type === 'warehouse:route') {
          routes.push(n as unknown as RouteNode)
        }
      }

      const snap = snapToNearestRoute(rawX, rawZ, routes)
      if (snap) {
        setCursor(snap.snappedPos)
        setRotationY(snap.rotationY)
        setActiveWidth(snap.width)
        setActiveRouteId(snap.routeId)
        setActiveT(snap.t)
        setValid(true)
      } else {
        // Honour grid-snap by resolving through the aligned placement ladder
        // (empty candidates = no alignment guides, but grid quantize is applied).
        const placeholder = CrosswalkNode.parse({}) as unknown as AnyNode
        const { position } = resolveAlignedPlacement({
          candidates: [],
          node: placeholder,
          rawX,
          rawZ,
          rotationY: 0,
        })
        const slab = slabAt(collectSlabs(nodes, activeLevelId), position[0], position[2])
        setCursor([position[0], slab?.elevation ?? 0, position[2]])
        setRotationY(0)
        setActiveWidth(3.5)
        setActiveRouteId(null)
        setActiveT(0.5)
        setValid(slab !== null)
      }
    })

    const unsubscribeClicks = subscribeGridClicks(() => {
      const point = cursorRef.current
      if (!point || !valid) return

      const nodes = useScene.getState().nodes as Record<string, unknown>
      const crosswalk = CrosswalkNode.parse({
        position: [point[0], point[1], point[2]],
        rotation: [0, rotationY, 0],
        width: activeWidth,
        length: 2.5,
        stripeCount: 6,
        routeId: activeRouteId,
        t: activeT,
        parentId: activeLevelId,
        supportSlabId: electSupportSlab(nodes, activeLevelId, point[0], point[2]),
      })

      useScene.getState().createNode(crosswalk as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [crosswalk.id as AnyNodeId] })
      triggerSFX('sfx:item-place')

      disarmPlacementToolOnCommit(() => {
        setCursor(null)
      })
    })

    return () => {
      unsubscribeMove()
      unsubscribeClicks()
      setCursor(null)
      clearPlacementPreview()
    }
  }, [activeLevelId, valid, rotationY, activeWidth, activeRouteId, activeT])

  return (
    <>
      {cursor && (
        <PlacementBox
          dimensions={[activeWidth, 0.05, 2.5]}
          position={[cursor[0], cursor[1] + 0.02, cursor[2]]}
          rotationY={rotationY}
          valid={valid}
        />
      )}
    </>
  )
}
