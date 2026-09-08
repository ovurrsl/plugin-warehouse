'use client'

import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import type { ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { slabAt } from '../host-adapter'
import { collectSlabs } from '../placement'
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
  position?: [number, number, number]
  rotation?: [number, number, number]
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

/**
 * Eats the click the browser sends after a drag's `pointerup`.
 *
 * A window CAPTURE listener, so it runs before the canvas's own — which is the
 * point, and also why it must be armed **only when a drag actually changed
 * something**. `grid:click` is emitted from that same canvas listener
 * (`editor/hooks/use-grid-events.ts`), and it is the only event a multi-point
 * tool draws with: arming this on a gesture that moved nothing deletes the next
 * corner the user tries to place anywhere in the scene.
 */
function swallowNextClick() {
  const handler = (e: MouseEvent) => {
    e.stopPropagation()
    window.removeEventListener('click', handler, true)
  }
  window.addEventListener('click', handler, true)
  setTimeout(() => window.removeEventListener('click', handler, true), 100)
}

/**
 * **The primary button, and nothing else.**
 *
 * The host binds RIGHT to camera ROTATE and MIDDLE to SCREEN_PAN
 * (`editor/components/editor/custom-camera-controls.tsx`), and its own node
 * events refuse anything but button 0 for the same reason
 * (`viewer/hooks/use-node-events.ts`). These grips sit 50 mm above the paint
 * and their pick boxes reach 1 m past each end of the run, so with no guard a
 * right-drag anywhere near a selected route started a vertex drag instead of
 * orbiting — and the drag then swallowed every `pointermove` of the gesture.
 * The camera does not move, which is exactly what "the camera locks when I
 * click the route" describes.
 *
 * Absent `button` counts as primary: synthesized events in tests and on some
 * touch stacks omit it, and refusing those would break dragging on a phone.
 */
export function startsGripDrag(event: { button?: number }): boolean {
  return (event.button ?? 0) === 0
}

/** Whether a drag ended anywhere other than where it started. */
export function routePointsEqual(a: readonly Point[] | null, b: readonly Point[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((point, index) => point[0] === b[index]![0] && point[1] === b[index]![1])
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
  const sceneNodes = useScene((s) => s.nodes as Record<string, unknown>)
  const rawPosition = node?.position ?? [0, 0, 0]
  const slabElevation = useMemo(() => {
    if (!node) return 0
    if (node.supportSlabId) {
      const slab = sceneNodes[node.supportSlabId] as { elevation?: number } | undefined
      if (typeof slab?.elevation === 'number') {
        return slab.elevation
      }
    }
    const slabs = node.parentId ? collectSlabs(sceneNodes, node.parentId) : []
    const slab = slabAt(slabs, rawPosition[0], rawPosition[2])
    return slab?.elevation ?? 0
  }, [node, sceneNodes, rawPosition])
  const isAffordanceActive = useIsAffordanceActive(nodeId)

  // Manage affordance presence to avoid duplicate handles when both SelectionAffordanceManager
  // and RouteRenderer fallback mount
  useEffect(() => {
    if (!nodeId || !isStandaloneAffordance) return
    return registerAffordanceNode(nodeId)
  }, [nodeId, isStandaloneAffordance])

  const [draftPoints, setDraftPoints] = useState<Point[] | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null)
  const [hoveredExt, setHoveredExt] = useState<'start' | 'end' | null>(null)

  const dragIndexRef = useRef<number | null>(null)
  const draftRef = useRef<Point[] | null>(null)
  /** Where the gesture started, so a release can tell a drag from a click. */
  const originPointsRef = useRef<Point[] | null>(null)
  /** The host's own undo of `beginInputDrag`, when it handed us one. */
  const restoreInputDraggingRef = useRef<(() => void) | null>(null)
  /** Set only while this component is the one that changed the body cursor. */
  const ownsCursorRef = useRef(false)

  // Clear the transient UI state when the active node changes. The drag itself
  // is released by the cleanup of the `[releaseDrag]` effect below, which runs
  // with the OUTGOING node's closure and so clears the right node's override.
  useEffect(() => {
    setSelectedIndex(null)
    setHoveredIndex(null)
    setHoveredMidpoint(null)
    setHoveredExt(null)
  }, [nodeId])

  /**
   * The one way out of a drag — and it must be reachable from every one of them.
   *
   * Raising `inputDragging` without a guaranteed lowering is what turns a
   * mis-click into a dead editor: while it is set the host suppresses every node
   * selection event (`viewer/hooks/use-node-events.ts`) and stands its own drag
   * sessions down (`editor/components/editor/selection-manager.tsx`). The same
   * goes for the paused undo stack and the `grabbing` body cursor. So all three
   * are released here, and `commit`, `cancelDrag`, a node change and unmount all
   * come through this function rather than each repeating it — the earlier
   * version repeated it in two places and skipped it in a third.
   *
   * Idempotent, because it genuinely is called twice: the drag plane's
   * `onPointerUp` and the window-level fail-safe both fire for one release.
   */
  const releaseDrag = useCallback((): { points: Point[] | null; origin: Point[] | null } => {
    const points = draftRef.current
    const origin = originPointsRef.current
    const wasDragging = dragIndexRef.current !== null || points !== null

    dragIndexRef.current = null
    draftRef.current = null
    originPointsRef.current = null
    setDraftPoints(null)

    if (ownsCursorRef.current) {
      ownsCursorRef.current = false
      if (typeof document !== 'undefined') document.body.style.cursor = ''
    }

    const restore = restoreInputDraggingRef.current
    restoreInputDraggingRef.current = null
    try {
      // The host's `beginInputDrag` returns a restore that puts back whatever
      // the flag was — hard-setting `false` would clear a drag somebody else
      // owns. Only fall back to the blunt write when we were never handed one.
      if (restore) restore()
      else if (wasDragging) useViewer.getState().setInputDragging?.(false)
    } catch {}

    // Everything below costs something, so it is spent only on a gesture that
    // actually happened: this function also runs on every deselect and unmount,
    // and marking a node dirty there would rebuild its buffer for nothing.
    if (wasDragging) {
      try {
        useScene.temporal?.getState()?.resume?.()
      } catch {}

      if (nodeId) {
        try {
          useLiveNodeOverrides.getState().clear(nodeId)
          useScene.getState().markDirty?.(nodeId as AnyNodeId)
        } catch {}
      }
    }

    return { points: wasDragging ? points : null, origin }
  }, [nodeId])

  /**
   * Opens a drag session. Every `begin*` handler goes through here so none of
   * them can raise half the flags.
   */
  const acquireDrag = useCallback(
    (index: number, next: Point[], origin: readonly Point[]) => {
      dragIndexRef.current = index
      draftRef.current = next
      originPointsRef.current = origin.map((p) => [p[0], p[1]] as Point)
      setDraftPoints(next)

      if (typeof document !== 'undefined') {
        document.body.style.cursor = 'grabbing'
        ownsCursorRef.current = true
      }

      const beginInputDrag = (
        props?.interactionApi as { beginInputDrag?: () => () => void } | undefined
      )?.beginInputDrag
      try {
        restoreInputDraggingRef.current = beginInputDrag ? beginInputDrag() : null
        if (!beginInputDrag) useViewer.getState().setInputDragging?.(true)
      } catch {}

      try {
        useScene.temporal?.getState()?.pause?.()
      } catch {}

      try {
        triggerSFX('sfx:item-pick')
      } catch {}
    },
    [props?.interactionApi],
  )

  const commit = useCallback(() => {
    const { points, origin } = releaseDrag()
    if (!points) return

    // A press that moved nothing is a CLICK, not an edit. Writing history for
    // it litters the undo stack with no-ops, and swallowing the click that
    // follows kills the next corner the route tool tries to place.
    const changed = !routePointsEqual(points, origin)
    if (!changed) return

    if (nodeId) {
      try {
        useScene.getState().updateNode(nodeId as AnyNodeId, { points } as never)
        triggerSFX('sfx:item-place')
      } catch {}
    }

    swallowNextClick()
  }, [nodeId, releaseDrag])

  const cancelDrag = useCallback(() => {
    releaseDrag()
  }, [releaseDrag])

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

  // Releases a live drag when this component unmounts OR when the node it is
  // bound to changes — the second case is the one that used to leak, because
  // the node-change effect reset the refs and left `inputDragging` raised with
  // nothing able to lower it again. Unconditional now: `releaseDrag` is
  // idempotent, so there is no state to test first and therefore no state to
  // get wrong.
  useEffect(() => {
    return () => {
      releaseDrag()
    }
  }, [releaseDrag])

  // Keyboard deletion on Delete or Backspace key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target.isContentEditable ||
          target.closest?.('input, textarea, select, [contenteditable="true"], [role="listbox"]'))
      ) {
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedIndex === null) return
      if (!node || (node?.points?.length ?? 0) <= 2) return

      event.preventDefault()
      const removed = withRouteVertexRemoved(node?.points ?? [], selectedIndex)
      if (removed) {
        setSelectedIndex(null)
        try {
          useScene.getState().updateNode(node?.id as AnyNodeId, { points: removed } as never)
          triggerSFX('sfx:item-delete')
        } catch {}
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [node, selectedIndex])

  const points = draftPoints ?? node?.points ?? []
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
    // Before `stopPropagation`, deliberately: a right- or middle-press belongs
    // to the camera, and swallowing it here is what froze the view.
    if (!startsGripDrag(event)) return
    event.stopPropagation()

    // Alt-click deletes vertex immediately
    if (event.altKey) {
      if (points.length <= 2) return
      const removed = withRouteVertexRemoved(points, index)
      if (removed) {
        setSelectedIndex(null)
        try {
          useScene.getState().updateNode(node?.id as AnyNodeId, { points: removed } as never)
          triggerSFX('sfx:item-delete')
        } catch {}
      }
      return
    }

    setSelectedIndex(index)
    acquireDrag(index, [...points], points)
  }

  const beginInsert = (segmentIndex: number) => (event: ThreeEvent<PointerEvent>) => {
    if (!startsGripDrag(event)) return
    event.stopPropagation()
    const inserted = withRouteVertexInserted(points, segmentIndex)
    if (!inserted) return

    const newIndex = segmentIndex + 1
    setSelectedIndex(newIndex)
    acquireDrag(newIndex, inserted, points)

    try {
      useLiveNodeOverrides.getState().set(node?.id as string, { points: inserted })
      useScene.getState().markDirty?.(node?.id as AnyNodeId)
    } catch {}
  }

  const beginAppend = (event: ThreeEvent<PointerEvent>) => {
    if (!startsGripDrag(event)) return
    event.stopPropagation()
    if (points.length >= MAX_VERTICES) return

    const nextPoints = withRouteVertexAppended(points)
    if (!nextPoints) return

    const newIndex = nextPoints.length - 1
    setSelectedIndex(newIndex)
    acquireDrag(newIndex, nextPoints, points)

    try {
      useLiveNodeOverrides.getState().set(node?.id as string, { points: nextPoints })
      useScene.getState().markDirty?.(node?.id as AnyNodeId)
    } catch {}
  }

  const beginPrepend = (event: ThreeEvent<PointerEvent>) => {
    if (!startsGripDrag(event)) return
    event.stopPropagation()
    if (points.length >= MAX_VERTICES) return

    const nextPoints = withRouteVertexPrepended(points)
    if (!nextPoints) return

    const newIndex = 0
    setSelectedIndex(newIndex)
    acquireDrag(newIndex, nextPoints, points)

    try {
      useLiveNodeOverrides.getState().set(node?.id as string, { points: nextPoints })
      useScene.getState().markDirty?.(node?.id as AnyNodeId)
    } catch {}
  }

  const onPlaneMove = (event: ThreeEvent<PointerEvent>) => {
    const index = dragIndexRef.current
    const basePoints = draftRef.current
    if (index === null || !basePoints) return

    event.stopPropagation()
    const local = worldToLocalXZ(
      [event.point.x, event.point.z],
      node?.position ?? [0, 0, 0],
      node?.rotation?.[1] ?? 0,
    )
    const moved = withRouteVertexMoved(basePoints, index, local)
    if (moved) {
      draftRef.current = moved
      setDraftPoints(moved)
      try {
        useLiveNodeOverrides.getState().set(node?.id as string, { points: moved })
        useScene.getState().markDirty?.(node?.id as AnyNodeId)
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
            <mesh raycast={NO_RAYCAST} renderOrder={1010}>
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
            <mesh raycast={NO_RAYCAST} renderOrder={1010}>
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
            <mesh raycast={NO_RAYCAST} renderOrder={1012}>
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
            <mesh raycast={NO_RAYCAST} renderOrder={1012}>
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

  const resolvedY = Math.max(rawPosition[1] ?? 0, slabElevation)
  const effectivePosition: [number, number, number] = props?.position ?? [
    rawPosition[0],
    resolvedY,
    rawPosition[2],
  ]
  const effectiveRotation = props?.rotation ?? node?.rotation ?? [0, 0, 0]

  if (!node || props?.active === false || props?.readOnly === true) return null
  if (!isStandaloneAffordance && nodeId && isAffordanceActive) return null

  return (
    <group position={effectivePosition} rotation={effectiveRotation}>
      {content}
    </group>
  )
}

export default RouteControls
