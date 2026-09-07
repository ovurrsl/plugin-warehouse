'use client'

import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import type { ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ROUTE_ELEVATIONS } from './constants'
import {
  getRouteMidpoints,
  withRouteVertexInserted,
  withRouteVertexMoved,
  withRouteVertexRemoved,
  worldToLocalXZ,
} from './route-controls-math'
import type { RouteNode } from './schema'
import type { Point } from './stripes'

export * from './route-controls-math'

export interface RouteControlsProps {
  node?: RouteNode
  selectedIds?: string[]
  active?: boolean
  readOnly?: boolean
  historyApi?: unknown
  interactionApi?: unknown
  sceneApi?: unknown
  embedded?: boolean
}

const activeAffordanceNodes = new Set<string>()

function swallowNextClick() {
  const handler = (e: MouseEvent) => {
    e.stopPropagation()
    window.removeEventListener('click', handler, true)
  }
  window.addEventListener('click', handler, true)
  setTimeout(() => window.removeEventListener('click', handler, true), 100)
}

export function RouteControls(props?: RouteControlsProps): React.JSX.Element | null {
  const viewerSelectedIds = useViewer((s) => s.selection.selectedIds)
  const isStandaloneAffordance = Boolean(props?.historyApi || props?.sceneApi)

  // Resolve target node: from props or from viewer selection + scene store
  const storeNode = useScene((s) => {
    const ids = props?.selectedIds ?? viewerSelectedIds
    if (ids.length !== 1) return null
    const n = s.nodes[ids[0] as AnyNodeId]
    return (n as { type?: string })?.type === 'warehouse:route' ? (n as unknown as RouteNode) : null
  })

  const node = props?.node ?? storeNode

  const nodeId = node?.id ?? null

  // Manage affordance presence to avoid duplicate handles when both SelectionAffordanceManager
  // and RouteRenderer fallback mount
  useEffect(() => {
    if (!nodeId || !isStandaloneAffordance) return
    activeAffordanceNodes.add(nodeId)
    return () => {
      activeAffordanceNodes.delete(nodeId)
    }
  }, [nodeId, isStandaloneAffordance])

  // If mounted inside renderer as fallback but SelectionAffordanceManager is already handling it
  if (!isStandaloneAffordance && nodeId && activeAffordanceNodes.has(nodeId)) {
    return null
  }

  const [draftPoints, setDraftPoints] = useState<Point[] | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null)

  const dragIndexRef = useRef<number | null>(null)
  const draftRef = useRef<Point[] | null>(null)

  // Clear state when active node changes
  useEffect(() => {
    dragIndexRef.current = null
    draftRef.current = null
    setDraftPoints(null)
    setSelectedIndex(null)
    setHoveredIndex(null)
    setHoveredMidpoint(null)
  }, [nodeId])

  const commit = useCallback(() => {
    const finalPoints = draftRef.current
    dragIndexRef.current = null
    draftRef.current = null
    setDraftPoints(null)
    document.body.style.cursor = ''

    try {
      useViewer.getState().setInputDragging?.(false)
    } catch {}

    try {
      useScene.temporal?.getState()?.resume?.()
    } catch {}

    if (finalPoints && nodeId) {
      try {
        useScene.getState().updateNode(nodeId as AnyNodeId, { points: finalPoints } as never)
        triggerSFX('sfx:item-place')
      } catch {}
    }

    if (nodeId) {
      try {
        useLiveNodeOverrides.getState().clear(nodeId)
        useScene.getState().markDirty?.(nodeId as AnyNodeId)
      } catch {}
    }

    swallowNextClick()
  }, [nodeId])

  const cancelDrag = useCallback(() => {
    dragIndexRef.current = null
    draftRef.current = null
    setDraftPoints(null)
    document.body.style.cursor = ''

    try {
      useViewer.getState().setInputDragging?.(false)
    } catch {}

    try {
      useScene.temporal?.getState()?.resume?.()
    } catch {}

    if (nodeId) {
      try {
        useLiveNodeOverrides.getState().clear(nodeId)
        useScene.getState().markDirty?.(nodeId as AnyNodeId)
      } catch {}
    }
  }, [nodeId])

  const dragging = draftPoints !== null && dragIndexRef.current !== null

  // Fail-safe global pointer listeners during active dragging
  useEffect(() => {
    if (!dragging) return
    const handleWindowPointerUp = () => commit()
    const handleWindowPointerCancel = () => cancelDrag()

    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerCancel)
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerCancel)
    }
  }, [dragging, commit, cancelDrag])

  // Keyboard deletion on Delete or Backspace key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target as HTMLElement)?.isContentEditable
      ) {
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedIndex === null) return
      if (!node || node.points.length <= 2) return

      event.preventDefault()
      const removed = withRouteVertexRemoved(node.points, selectedIndex)
      if (removed) {
        setSelectedIndex(null)
        try {
          useScene.getState().updateNode(node.id as AnyNodeId, { points: removed } as never)
          triggerSFX('sfx:item-delete')
        } catch {}
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [node, selectedIndex])

  if (!node || props?.active === false || props?.readOnly === true) return null

  const points = draftPoints ?? node.points
  const midpoints = getRouteMidpoints(points)

  const beginDrag = (index: number) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    // Alt-click deletes vertex immediately
    if (event.altKey) {
      if (points.length <= 2) return
      const removed = withRouteVertexRemoved(points, index)
      if (removed) {
        setSelectedIndex(null)
        try {
          useScene.getState().updateNode(node.id as AnyNodeId, { points: removed } as never)
          triggerSFX('sfx:item-delete')
        } catch {}
      }
      return
    }

    setSelectedIndex(index)
    dragIndexRef.current = index
    draftRef.current = [...points]
    setDraftPoints([...points])
    document.body.style.cursor = 'grabbing'

    try {
      useViewer.getState().setInputDragging?.(true)
    } catch {}

    try {
      useScene.temporal?.getState()?.pause?.()
    } catch {}

    try {
      triggerSFX('sfx:item-pick')
    } catch {}
  }

  const beginInsert = (segmentIndex: number) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    const inserted = withRouteVertexInserted(points, segmentIndex)
    if (!inserted) return

    const newIndex = segmentIndex + 1
    dragIndexRef.current = newIndex
    draftRef.current = inserted
    setDraftPoints(inserted)
    setSelectedIndex(newIndex)
    document.body.style.cursor = 'grabbing'

    try {
      useViewer.getState().setInputDragging?.(true)
    } catch {}

    try {
      useScene.temporal?.getState()?.pause?.()
    } catch {}

    try {
      useLiveNodeOverrides.getState().set(node.id, { points: inserted })
      useScene.getState().markDirty?.(node.id as AnyNodeId)
    } catch {}

    try {
      triggerSFX('sfx:item-pick')
    } catch {}
  }

  const onPlaneMove = (event: ThreeEvent<PointerEvent>) => {
    const index = dragIndexRef.current
    const basePoints = draftRef.current
    if (index === null || !basePoints) return

    event.stopPropagation()
    const local = worldToLocalXZ(
      [event.point.x, event.point.z],
      node.position ?? [0, 0, 0],
      node.rotation?.[1] ?? 0,
    )
    const moved = withRouteVertexMoved(basePoints, index, local)
    if (moved) {
      draftRef.current = moved
      setDraftPoints(moved)
      try {
        useLiveNodeOverrides.getState().set(node.id, { points: moved })
        useScene.getState().markDirty?.(node.id as AnyNodeId)
      } catch {}
    }
  }

  const content = (
    <group layers={EDITOR_LAYER} position={[0, ROUTE_ELEVATIONS.CONTROLS_GRIPS, 0]}>
      {/* Vertex Grip Handles */}
      {points.map((pt, i) => {
        const isSelected = selectedIndex === i
        const isHovered = hoveredIndex === i
        const color = isSelected ? '#86efac' : isHovered ? '#4ade80' : '#22c55e'

        return (
          <group key={`vertex-${i}-${points.length}`} position={[pt[0], 0, pt[1]]}>
            <mesh
              onPointerDown={beginDrag(i)}
              onPointerEnter={() => setHoveredIndex(i)}
              onPointerLeave={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
              renderOrder={1010}
            >
              <sphereGeometry args={[0.22, 16, 12]} />
              <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
            </mesh>

            {/* Dark green outline ring */}
            <mesh renderOrder={1011} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.245, 0.035, 8, 28]} />
              <meshBasicMaterial color="#14532d" depthTest={false} depthWrite={false} />
            </mesh>

            {/* Invisible pick box for easy cursor grabbing */}
            <mesh
              onPointerDown={beginDrag(i)}
              onPointerEnter={() => setHoveredIndex(i)}
              onPointerLeave={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
              visible={false}
            >
              <boxGeometry args={[0.6, 0.12, 0.6]} />
              <meshBasicMaterial depthWrite={false} />
            </mesh>
          </group>
        )
      })}

      {/* Midpoint Insertion Handles */}
      {midpoints.map((mid, i) => {
        const isHovered = hoveredMidpoint === i
        const color = isHovered ? '#ffffff' : '#8fb5d9'

        return (
          <group key={`mid-${i}-${points.length}`} position={[mid[0], 0, mid[1]]}>
            <mesh
              onPointerDown={beginInsert(i)}
              onPointerEnter={() => setHoveredMidpoint(i)}
              onPointerLeave={() => setHoveredMidpoint((cur) => (cur === i ? null : cur))}
              renderOrder={1010}
            >
              <sphereGeometry args={[0.14, 14, 10]} />
              <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
            </mesh>

            {/* Cross indicator boxes */}
            <mesh position={[0, 0, 0]} renderOrder={1011}>
              <boxGeometry args={[0.16, 0.03, 0.04]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0, 0]} renderOrder={1011}>
              <boxGeometry args={[0.04, 0.03, 0.16]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
            </mesh>

            {/* Pick box for midpoint */}
            <mesh
              onPointerDown={beginInsert(i)}
              onPointerEnter={() => setHoveredMidpoint(i)}
              onPointerLeave={() => setHoveredMidpoint((cur) => (cur === i ? null : cur))}
              visible={false}
            >
              <boxGeometry args={[0.45, 0.12, 0.45]} />
              <meshBasicMaterial depthWrite={false} />
            </mesh>
          </group>
        )
      })}

      {/* Invisible XZ drag interception plane */}
      {dragging && (
        <mesh
          onPointerMove={onPlaneMove}
          onPointerUp={(e) => {
            e.stopPropagation()
            commit()
          }}
          position={[0, 0, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <planeGeometry args={[2000, 2000]} />
          <meshBasicMaterial depthWrite={false} />
        </mesh>
      )}
    </group>
  )

  if (isStandaloneAffordance) {
    return (
      <group position={node.position ?? [0, 0, 0]} rotation={node.rotation ?? [0, 0, 0]}>
        {content}
      </group>
    )
  }

  return content
}

export default RouteControls
