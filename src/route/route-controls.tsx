'use client'

import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import type { ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_VERTICES, ROUTE_ELEVATIONS } from './constants'
import {
  getRouteMidpoints,
  withRouteVertexAppended,
  withRouteVertexInserted,
  withRouteVertexMoved,
  withRouteVertexPrepended,
  withRouteVertexRemoved,
  worldToLocalXZ,
} from './route-controls-math'
import type { RouteNode } from './schema'
import type { Point } from './stripes'

export * from './route-controls-math'

const NO_RAYCAST = () => null

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

const activeAffordanceListeners = new Set<() => void>()
export const activeAffordanceNodes = new Set<string>()

function notifyAffordanceChange() {
  for (const listener of activeAffordanceListeners) {
    listener()
  }
}

export function registerAffordanceNode(nodeId: string): () => void {
  activeAffordanceNodes.add(nodeId)
  notifyAffordanceChange()
  return () => {
    activeAffordanceNodes.delete(nodeId)
    notifyAffordanceChange()
  }
}

export function useIsAffordanceActive(nodeId: string | null): boolean {
  return useSyncExternalStore(
    (callback) => {
      activeAffordanceListeners.add(callback)
      return () => activeAffordanceListeners.delete(callback)
    },
    () => (nodeId ? activeAffordanceNodes.has(nodeId) : false),
  )
}

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
  const isAffordanceActive = useIsAffordanceActive(nodeId)

  // Manage affordance presence to avoid duplicate handles when both SelectionAffordanceManager
  // and RouteRenderer fallback mount
  useEffect(() => {
    if (!nodeId || !isStandaloneAffordance) return
    return registerAffordanceNode(nodeId)
  }, [nodeId, isStandaloneAffordance])

  // If mounted inside renderer as fallback but SelectionAffordanceManager is already handling it
  if (!isStandaloneAffordance && nodeId && isAffordanceActive) {
    return null
  }

  const [draftPoints, setDraftPoints] = useState<Point[] | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null)
  const [hoveredExt, setHoveredExt] = useState<'start' | 'end' | null>(null)

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
    setHoveredExt(null)
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

  const terminalHandles = useMemo(() => {
    if (points.length < 2) return null

    const pFirst = points[0]!
    const pNext = points[1]!
    const sDx = pFirst[0] - pNext[0]
    const sDz = pFirst[1] - pNext[1]
    const sLen = Math.hypot(sDx, sDz)
    const sUx = sLen > 1e-6 ? sDx / sLen : -1
    const sUz = sLen > 1e-6 ? sDz / sLen : 0
    const startPos: Point = [pFirst[0] + sUx * 1.0, pFirst[1] + sUz * 1.0]

    const pLast = points[points.length - 1]!
    const pPrev = points[points.length - 2]!
    const eDx = pLast[0] - pPrev[0]
    const eDz = pLast[1] - pPrev[1]
    const eLen = Math.hypot(eDx, eDz)
    const eUx = eLen > 1e-6 ? eDx / eLen : 1
    const eUz = eLen > 1e-6 ? eDz / eLen : 0
    const endPos: Point = [pLast[0] + eUx * 1.0, pLast[1] + eUz * 1.0]

    return { startPos, endPos }
  }, [points])

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

  const beginAppend = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    if (points.length >= MAX_VERTICES) return

    const nextPoints = withRouteVertexAppended(points)
    if (!nextPoints) return

    const newIndex = nextPoints.length - 1
    dragIndexRef.current = newIndex
    draftRef.current = nextPoints
    setDraftPoints(nextPoints)
    setSelectedIndex(newIndex)
    document.body.style.cursor = 'grabbing'

    try {
      useViewer.getState().setInputDragging?.(true)
    } catch {}

    try {
      useScene.temporal?.getState()?.pause?.()
    } catch {}

    try {
      useLiveNodeOverrides.getState().set(node.id, { points: nextPoints })
      useScene.getState().markDirty?.(node.id as AnyNodeId)
    } catch {}

    try {
      triggerSFX('sfx:item-pick')
    } catch {}
  }

  const beginPrepend = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    if (points.length >= MAX_VERTICES) return

    const nextPoints = withRouteVertexPrepended(points)
    if (!nextPoints) return

    const newIndex = 0
    dragIndexRef.current = newIndex
    draftRef.current = nextPoints
    setDraftPoints(nextPoints)
    setSelectedIndex(newIndex)
    document.body.style.cursor = 'grabbing'

    try {
      useViewer.getState().setInputDragging?.(true)
    } catch {}

    try {
      useScene.temporal?.getState()?.pause?.()
    } catch {}

    try {
      useLiveNodeOverrides.getState().set(node.id, { points: nextPoints })
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
              raycast={NO_RAYCAST}
              renderOrder={1010}
            >
              <sphereGeometry args={[0.22, 16, 12]} />
              <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
            </mesh>

            {/* Dark green outline ring */}
            <mesh raycast={NO_RAYCAST} renderOrder={1011} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.245, 0.035, 8, 28]} />
              <meshBasicMaterial color="#14532d" depthTest={false} depthWrite={false} />
            </mesh>

            {/* Invisible pick box for easy cursor grabbing */}
            <mesh
              onPointerDown={beginDrag(i)}
              onPointerEnter={(e) => {
                e.stopPropagation()
                setHoveredIndex(i)
              }}
              onPointerLeave={(e) => {
                e.stopPropagation()
                setHoveredIndex((cur) => (cur === i ? null : cur))
              }}
            >
              <boxGeometry args={[0.6, 0.12, 0.6]} />
              <meshBasicMaterial depthWrite={false} transparent opacity={0} />
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
              raycast={NO_RAYCAST}
              renderOrder={1010}
            >
              <sphereGeometry args={[0.14, 14, 10]} />
              <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
            </mesh>

            {/* Cross indicator boxes */}
            <mesh raycast={NO_RAYCAST} position={[0, 0, 0]} renderOrder={1011}>
              <boxGeometry args={[0.16, 0.03, 0.04]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
            </mesh>
            <mesh raycast={NO_RAYCAST} position={[0, 0, 0]} renderOrder={1011}>
              <boxGeometry args={[0.04, 0.03, 0.16]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
            </mesh>

            {/* Pick box for midpoint */}
            <mesh
              onPointerDown={beginInsert(i)}
              onPointerEnter={(e) => {
                e.stopPropagation()
                setHoveredMidpoint(i)
              }}
              onPointerLeave={(e) => {
                e.stopPropagation()
                setHoveredMidpoint((cur) => (cur === i ? null : cur))
              }}
            >
              <boxGeometry args={[0.45, 0.12, 0.45]} />
              <meshBasicMaterial depthWrite={false} transparent opacity={0} />
            </mesh>
          </group>
        )
      })}

      {/* Terminal Extension Handles (Başa / Sona Nokta Ekleme) */}
      {!dragging && points.length < MAX_VERTICES && terminalHandles && (
        <>
          {/* Start Extension Handle (Başa Nokta Ekle) */}
          <group position={[terminalHandles.startPos[0], 0, terminalHandles.startPos[1]]}>
            <mesh
              raycast={NO_RAYCAST}
              renderOrder={1012}
            >
              <sphereGeometry args={[0.18, 16, 12]} />
              <meshBasicMaterial
                color={hoveredExt === 'start' ? '#38bdf8' : '#0284c7'}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>

            {/* Cyan outline ring */}
            <mesh raycast={NO_RAYCAST} renderOrder={1013} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.21, 0.03, 8, 28]} />
              <meshBasicMaterial color="#0369a1" depthTest={false} depthWrite={false} />
            </mesh>

            {/* Plus sign cross */}
            <mesh raycast={NO_RAYCAST} position={[0, 0, 0]} renderOrder={1014}>
              <boxGeometry args={[0.16, 0.035, 0.04]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
            </mesh>
            <mesh raycast={NO_RAYCAST} position={[0, 0, 0]} renderOrder={1014}>
              <boxGeometry args={[0.04, 0.035, 0.16]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
            </mesh>

            {/* Pick box */}
            <mesh
              onPointerDown={beginPrepend}
              onPointerEnter={(e) => {
                e.stopPropagation()
                setHoveredExt('start')
              }}
              onPointerLeave={(e) => {
                e.stopPropagation()
                setHoveredExt((cur) => (cur === 'start' ? null : cur))
              }}
            >
              <boxGeometry args={[0.6, 0.18, 0.6]} />
              <meshBasicMaterial depthWrite={false} transparent opacity={0} />
            </mesh>
          </group>

          {/* End Extension Handle (Sona Nokta Ekle) */}
          <group position={[terminalHandles.endPos[0], 0, terminalHandles.endPos[1]]}>
            <mesh
              raycast={NO_RAYCAST}
              renderOrder={1012}
            >
              <sphereGeometry args={[0.18, 16, 12]} />
              <meshBasicMaterial
                color={hoveredExt === 'end' ? '#38bdf8' : '#0284c7'}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>

            {/* Cyan outline ring */}
            <mesh raycast={NO_RAYCAST} renderOrder={1013} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.21, 0.03, 8, 28]} />
              <meshBasicMaterial color="#0369a1" depthTest={false} depthWrite={false} />
            </mesh>

            {/* Plus sign cross */}
            <mesh raycast={NO_RAYCAST} position={[0, 0, 0]} renderOrder={1014}>
              <boxGeometry args={[0.16, 0.035, 0.04]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
            </mesh>
            <mesh raycast={NO_RAYCAST} position={[0, 0, 0]} renderOrder={1014}>
              <boxGeometry args={[0.04, 0.035, 0.16]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
            </mesh>

            {/* Pick box */}
            <mesh
              onPointerDown={beginAppend}
              onPointerEnter={(e) => {
                e.stopPropagation()
                setHoveredExt('end')
              }}
              onPointerLeave={(e) => {
                e.stopPropagation()
                setHoveredExt((cur) => (cur === 'end' ? null : cur))
              }}
            >
              <boxGeometry args={[0.6, 0.18, 0.6]} />
              <meshBasicMaterial depthWrite={false} transparent opacity={0} />
            </mesh>
          </group>
        </>
      )}

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
