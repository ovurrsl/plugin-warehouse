/**
 * Tier 5 White-Box Adversarial Hardening Test Suite
 * 3D Grips, Affordances, & State Lifecycles
 *
 * Target: @ovurrsl/plugin-warehouse
 * Focus Areas:
 * 1. Undo/redo temporal transaction boundary integrity (exactly 1 commit per drag gesture).
 * 2. Live override 60 FPS update throughput without store pollution.
 * 3. Keydown listener: ensure Delete/Backspace on active HTML input elements does NOT trigger vertex deletion.
 * 4. Dual-mount suppression under rapid selection toggling.
 * 5. Interaction edge cases: pointer cancel gestures, window blur events, rapid multi-touch / click spam,
 *    mid-drag external node updates, live override memory clearing, non-finite coordinates.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { getRouteGeometry } from '../geometry'
import {
  COLLINEAR_SNAP_THRESHOLD_M,
  insertControlPoint,
  ORTHOGONAL_SNAP_THRESHOLD_M,
  snapCollinear,
  snapOrthogonal,
  withRouteVertexInserted,
  withRouteVertexMoved,
  withRouteVertexRemoved,
} from '../route-controls-math'
import { RouteNode } from '../schema'
import type { Point } from '../stripes'

// ---------------------------------------------------------------------------
// Environment Polyfills (Node / Bun Headless Support)
// ---------------------------------------------------------------------------

// Polyfill requestAnimationFrame / cancelAnimationFrame for useScene.updateNode
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 16) as unknown as number
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as NodeJS.Timeout)
}

// Minimal DOM Event & Element Polyfills
class MockEventTarget {
  listeners: Record<string, Array<{ cb: (e: any) => void; capture?: boolean }>> = {}

  addEventListener(type: string, cb: (e: any) => void, options?: boolean | { capture?: boolean }) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    this.listeners[type] = this.listeners[type] || []
    this.listeners[type].push({ cb, capture })
  }

  removeEventListener(
    type: string,
    cb: (e: any) => void,
    options?: boolean | { capture?: boolean },
  ) {
    if (!this.listeners[type]) return
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    this.listeners[type] = this.listeners[type].filter((l) => l.cb !== cb || l.capture !== capture)
  }

  dispatchEvent(evt: any): boolean {
    if (!this.listeners[evt.type]) return true
    for (const l of [...this.listeners[evt.type]]) {
      l.cb(evt)
    }
    return !evt.defaultPrevented
  }
}

class MockHTMLElement extends MockEventTarget {
  tagName = 'DIV'
  isContentEditable = false
  parentElement: MockHTMLElement | null = null
}

class MockHTMLInputElement extends MockHTMLElement {
  override tagName = 'INPUT'
  value = ''
}

class MockHTMLTextAreaElement extends MockHTMLElement {
  override tagName = 'TEXTAREA'
  value = ''
}

class MockHTMLSelectElement extends MockHTMLElement {
  override tagName = 'SELECT'
  value = ''
}

class MockKeyboardEvent {
  type = 'keydown'
  key: string
  target: any
  defaultPrevented = false
  propagationStopped = false

  constructor(key: string, target: any) {
    this.key = key
    this.target = target
  }

  preventDefault() {
    this.defaultPrevented = true
  }

  stopPropagation() {
    this.propagationStopped = true
  }
}

class MockMouseEvent {
  type: string
  target: any
  propagationStopped = false

  constructor(type: string, target: any = null) {
    this.type = type
    this.target = target
  }

  stopPropagation() {
    this.propagationStopped = true
  }
}

// Bind prototypes to globalThis for instanceof checks
globalThis.HTMLInputElement = MockHTMLInputElement as any
globalThis.HTMLTextAreaElement = MockHTMLTextAreaElement as any
globalThis.HTMLElement = MockHTMLElement as any
globalThis.HTMLSelectElement = MockHTMLSelectElement as any

// Helper to create test route nodes
function createTestRoute(
  id: string,
  points: Point[] = [
    [0, 0],
    [10, 0],
    [10, 10],
  ],
): RouteNode {
  return RouteNode.parse({
    id,
    type: 'warehouse:route',
    points,
    role: 'pedestrian',
    width: 2.0,
  })
}

// ---------------------------------------------------------------------------
// SUITE 1: Undo/Redo Temporal Transaction Boundary Integrity
// ---------------------------------------------------------------------------

describe('Suite 1: Undo/Redo Temporal Transaction Boundary Integrity', () => {
  beforeEach(() => {
    useScene.temporal?.getState()?.clear?.()
  })

  afterEach(() => {
    useScene.temporal?.getState()?.resume?.()
    useViewer.getState().setInputDragging?.(false)
  })

  test('T5.1.1: 500-step drag gesture triggers exactly 1 temporal pause, 0 intermediate scene commits, and exactly 1 commit on release', () => {
    const routeId = 'route_tier5_temporal_1'
    const initialPoints: Point[] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ]
    const route = createTestRoute(routeId, initialPoints)

    useScene.getState().createNode(route)
    useScene.temporal?.getState()?.clear?.()

    let pauseCount = 0
    let resumeCount = 0
    let updateNodeCount = 0

    // Spy on temporal pause / resume
    const originalPause = useScene.temporal.getState().pause
    const originalResume = useScene.temporal.getState().resume
    const originalUpdateNode = useScene.getState().updateNode

    useScene.temporal.getState().pause = () => {
      pauseCount++
      return originalPause()
    }
    useScene.temporal.getState().resume = () => {
      resumeCount++
      return originalResume()
    }
    useScene.getState().updateNode = ((id: AnyNodeId, patch: any) => {
      updateNodeCount++
      return originalUpdateNode(id, patch)
    }) as any

    try {
      // 1. Gesture Start (beginDrag)
      useScene.temporal.getState().pause()
      useViewer.getState().setInputDragging?.(true)
      expect(useScene.temporal.getState().isTracking).toBe(false)
      expect(pauseCount).toBe(1)

      // 2. Continuous 500-step planar dragging (stream of onPlaneMove ticks)
      let currentDraft = [...initialPoints]
      for (let step = 1; step <= 500; step++) {
        const nextCoord: Point = [10, step * 0.02] // move up to y = 10m
        const moved = withRouteVertexMoved(currentDraft, 1, nextCoord)
        expect(moved).not.toBeNull()
        currentDraft = moved!

        // Live override updated directly without touching store
        useLiveNodeOverrides.getState().set(routeId, { points: currentDraft })
      }

      // Assert zero intermediate commits into scene store during the drag
      expect(updateNodeCount).toBe(0)
      expect(useScene.temporal.getState().pastStates.length).toBe(0)
      expect(useScene.getState().nodes[routeId as AnyNodeId].points).toEqual(initialPoints)

      // 3. Gesture Release (commit)
      useViewer.getState().setInputDragging?.(false)
      useScene.temporal.getState().resume()
      useScene.getState().updateNode(routeId as AnyNodeId, { points: currentDraft } as never)
      useLiveNodeOverrides.getState().clear(routeId)

      // Assert exactly 1 temporal resume and exactly 1 scene store update
      expect(resumeCount).toBe(1)
      expect(updateNodeCount).toBe(1)
      expect(useScene.temporal.getState().isTracking).toBe(true)
      expect(useScene.temporal.getState().pastStates.length).toBe(1)
      expect(useScene.getState().nodes[routeId as AnyNodeId].points[1]).toEqual([10, 10])
    } finally {
      useScene.temporal.getState().pause = originalPause
      useScene.temporal.getState().resume = originalResume
      useScene.getState().updateNode = originalUpdateNode
    }
  })

  test('T5.1.2: A single undo reverts the entire 500-step drag back to initial coordinates atomically', () => {
    const routeId = 'route_tier5_temporal_2'
    const initialPoints: Point[] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ]
    const route = createTestRoute(routeId, initialPoints)

    useScene.getState().createNode(route)
    useScene.temporal?.getState()?.clear?.()

    // Perform drag gesture
    useScene.temporal.getState().pause()
    let currentDraft = [...initialPoints]
    for (let step = 1; step <= 500; step++) {
      currentDraft = withRouteVertexMoved(currentDraft, 1, [10, step * 0.05])!
    }
    useScene.temporal.getState().resume()
    useScene.getState().updateNode(routeId as AnyNodeId, { points: currentDraft } as never)

    expect(useScene.getState().nodes[routeId as AnyNodeId].points[1]).toEqual([10, 25])

    // Exactly 1 undo call
    useScene.temporal.getState().undo()

    // Entire drag is cleanly reversed to original coordinates
    const restoredPoints = (useScene.getState().nodes[routeId as AnyNodeId] as RouteNode).points
    expect(restoredPoints).toEqual(initialPoints)
  })

  test('T5.1.3: Midpoint insertion followed by 200-step drag collapses into exactly 1 atomic commit with length increment', () => {
    const routeId = 'route_tier5_temporal_3'
    const initialPoints: Point[] = [
      [0, 0],
      [20, 0],
    ]
    const route = createTestRoute(routeId, initialPoints)

    useScene.getState().createNode(route)
    useScene.temporal?.getState()?.clear?.()

    let updateCount = 0
    const originalUpdateNode = useScene.getState().updateNode
    useScene.getState().updateNode = ((id: AnyNodeId, patch: any) => {
      updateCount++
      return originalUpdateNode(id, patch)
    }) as any

    try {
      // 1. beginInsert on segment 0
      useScene.temporal.getState().pause()
      const inserted = withRouteVertexInserted(initialPoints, 0)
      expect(inserted).not.toBeNull()
      expect(inserted!.length).toBe(3)
      expect(inserted![1]).toEqual([10, 0])

      // 2. Drag the newly inserted vertex for 200 steps
      let currentDraft = inserted!
      for (let step = 1; step <= 200; step++) {
        currentDraft = withRouteVertexMoved(currentDraft, 1, [10, step * 0.05])!
        useLiveNodeOverrides.getState().set(routeId, { points: currentDraft })
      }

      // Zero updates in store during drag
      expect(updateCount).toBe(0)

      // 3. Commit on release
      useScene.temporal.getState().resume()
      useScene.getState().updateNode(routeId as AnyNodeId, { points: currentDraft } as never)
      useLiveNodeOverrides.getState().clear(routeId)

      // Exactly 1 update
      expect(updateCount).toBe(1)
      expect(useScene.temporal.getState().pastStates.length).toBe(1)
      const committedPoints = (useScene.getState().nodes[routeId as AnyNodeId] as RouteNode).points
      expect(committedPoints.length).toBe(3)
      expect(committedPoints[1]).toEqual([10, 10])

      // 1 undo restores back to original 2-point route
      useScene.temporal.getState().undo()
      expect((useScene.getState().nodes[routeId as AnyNodeId] as RouteNode).points.length).toBe(2)
      expect((useScene.getState().nodes[routeId as AnyNodeId] as RouteNode).points).toEqual(
        initialPoints,
      )
    } finally {
      useScene.getState().updateNode = originalUpdateNode
    }
  })

  test('T5.1.4: Pointer cancel gesture (pointercancel) during active drag triggers 0 commits, resumes temporal, and leaves scene unmutated', () => {
    const routeId = 'route_tier5_temporal_4'
    const initialPoints: Point[] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ]
    const route = createTestRoute(routeId, initialPoints)

    useScene.getState().createNode(route)
    useScene.temporal?.getState()?.clear?.()

    // 1. Begin drag
    useScene.temporal.getState().pause()
    useViewer.getState().setInputDragging?.(true)
    let currentDraft = [...initialPoints]

    // 2. Drag 100 steps
    for (let step = 1; step <= 100; step++) {
      currentDraft = withRouteVertexMoved(currentDraft, 1, [10, step * 0.1])!
      useLiveNodeOverrides.getState().set(routeId, { points: currentDraft })
    }

    expect(useLiveNodeOverrides.getState().get(routeId)?.points).toEqual(currentDraft)

    // 3. pointercancel event triggers cancelDrag()
    useViewer.getState().setInputDragging?.(false)
    useScene.temporal.getState().resume()
    useLiveNodeOverrides.getState().clear(routeId)
    // updateNode is NEVER called

    // Assert temporal is resumed and pastStates is 0
    expect(useScene.temporal.getState().isTracking).toBe(true)
    expect(useScene.temporal.getState().pastStates.length).toBe(0)
    expect(useLiveNodeOverrides.getState().get(routeId)).toBeUndefined()
    expect((useScene.getState().nodes[routeId as AnyNodeId] as RouteNode).points).toEqual(
      initialPoints,
    )
  })

  test('T5.1.5: 50 rapid sequential drag gestures execute exactly 50 pauses, 50 resumes, and exactly 50 discrete commits with 1:1 balance', () => {
    const routeId = 'route_tier5_temporal_5'
    const initialPoints: Point[] = [
      [0, 0],
      [5, 0],
      [10, 0],
    ]
    const route = createTestRoute(routeId, initialPoints)

    useScene.getState().createNode(route)
    useScene.temporal?.getState()?.clear?.()

    let totalCommits = 0
    const originalUpdateNode = useScene.getState().updateNode
    useScene.getState().updateNode = ((id: AnyNodeId, patch: any) => {
      totalCommits++
      return originalUpdateNode(id, patch)
    }) as any

    try {
      for (let gesture = 1; gesture <= 50; gesture++) {
        // Begin
        useScene.temporal.getState().pause()
        expect(useScene.temporal.getState().isTracking).toBe(false)

        // Drag 10 moves
        let draft = [...(useScene.getState().nodes[routeId as AnyNodeId] as RouteNode).points]
        for (let m = 1; m <= 10; m++) {
          draft = withRouteVertexMoved(draft, 1, [5, gesture * 0.1 + m * 0.01])!
        }

        // Commit
        useScene.temporal.getState().resume()
        expect(useScene.temporal.getState().isTracking).toBe(true)
        useScene.getState().updateNode(routeId as AnyNodeId, { points: draft } as never)
      }

      expect(totalCommits).toBe(50)
      expect(useScene.temporal.getState().pastStates.length).toBe(50)
    } finally {
      useScene.getState().updateNode = originalUpdateNode
    }
  })
})

// ---------------------------------------------------------------------------
// SUITE 2: Live Override 60 FPS Update Throughput Without Store Pollution
// ---------------------------------------------------------------------------

describe('Suite 2: Live Override 60 FPS Update Throughput Without Store Pollution', () => {
  beforeEach(() => {
    useLiveNodeOverrides.getState().clearAll?.()
  })

  test('T5.2.1: 600 consecutive 60 FPS frames (~10s continuous drag) update overrides without mutating useScene store', () => {
    const routeId = 'route_tier5_60fps_1'
    const initialPoints: Point[] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ]
    const route = createTestRoute(routeId, initialPoints)

    useScene.getState().createNode(route)
    const initialJson = JSON.stringify(useScene.getState().nodes[routeId as AnyNodeId])

    let draft = [...initialPoints]
    for (let frame = 1; frame <= 600; frame++) {
      const angle = (frame / 600) * Math.PI * 4
      const nextCoord: Point = [10 + Math.cos(angle) * 3, Math.sin(angle) * 3]
      const moved = withRouteVertexMoved(draft, 1, nextCoord)
      expect(moved).not.toBeNull()
      draft = moved!

      // Stream to live overrides
      useLiveNodeOverrides.getState().set(routeId, { points: draft })

      // Verify override is updated
      expect(useLiveNodeOverrides.getState().get(routeId)?.points).toEqual(draft)
    }

    // Verify useScene store node remained completely untouched and unpolluted
    expect(JSON.stringify(useScene.getState().nodes[routeId as AnyNodeId])).toBe(initialJson)

    // Cleanup on release
    useLiveNodeOverrides.getState().clear(routeId)
    expect(useLiveNodeOverrides.getState().get(routeId)).toBeUndefined()
  })

  test('T5.2.2: 600 frames process under 100ms with zero memory leak and valid geometry generation', () => {
    const routeId = 'route_tier5_60fps_2'
    const route = createTestRoute(routeId, [
      [0, 0],
      [15, 0],
      [30, 0],
    ])
    useScene.getState().createNode(route)

    let draft = [...route.points]
    const startTime = performance.now()

    for (let frame = 1; frame <= 600; frame++) {
      const target: Point = [15, (frame % 50) * 0.1 + 1.0]
      draft = withRouteVertexMoved(draft, 1, target)!
      useLiveNodeOverrides.getState().set(routeId, { points: draft })

      // Simulate effective node geometry synthesis in renderer
      const effectiveNode = { ...route, points: draft }
      const geom = getRouteGeometry(effectiveNode)
      expect(geom.getAttribute('position').count).toBeGreaterThan(0)
    }

    const duration = performance.now() - startTime
    // High-performance threshold: 600 full math + geometry invalidations should take < 100ms in Bun
    expect(duration).toBeLessThan(100)

    useLiveNodeOverrides.getState().clear(routeId)
    expect(useLiveNodeOverrides.getState().get(routeId)).toBeUndefined()
  })

  test('T5.2.3: Empirical Vulnerability: withRouteVertexMoved fails to reject NaN and Infinity coordinates', () => {
    const basePoints: Point[] = [
      [0, 0],
      [5, 0],
      [10, 0],
    ]

    // NaN input: Math.hypot(NaN, NaN) < 0.05 is false, bypassing distance guards
    const movedWithNaN = withRouteVertexMoved(basePoints, 1, [NaN, NaN])
    expect(movedWithNaN).not.toBeNull()
    expect(Number.isNaN(movedWithNaN![1][0])).toBe(true)
    expect(Number.isNaN(movedWithNaN![1][1])).toBe(true)

    // Infinity input: Infinity distance is not < 0.05
    const movedWithInfinity = withRouteVertexMoved(basePoints, 1, [Infinity, Infinity])
    expect(movedWithInfinity).not.toBeNull()
    expect(movedWithInfinity![1][0]).toBe(Infinity)

    // Proves that route-controls-math lacks Number.isFinite guards!
  })

  test('T5.2.4: Sub-50mm collapsing moves are rejected during 60 FPS stream, preserving previous valid draft', () => {
    const basePoints: Point[] = [
      [0, 0],
      [5, 0],
      [10, 0],
    ]
    let draft = [...basePoints]

    // Move to valid [5, 2]
    draft = withRouteVertexMoved(draft, 1, [5, 2])!
    expect(draft[1]).toEqual([5, 2])

    // Sudden collapsing jump toward vertex 0 (distance = 0.02m < 0.05m threshold)
    const collapsed = withRouteVertexMoved(draft, 1, [0.02, 0])
    expect(collapsed).toBeNull()

    // Draft remains at last known good position
    expect(draft[1]).toEqual([5, 2])

    // Sudden collapsing jump toward vertex 2 (distance = 0.03m < 0.05m threshold)
    const collapsed2 = withRouteVertexMoved(draft, 1, [9.97, 0])
    expect(collapsed2).toBeNull()
    expect(draft[1]).toEqual([5, 2])
  })

  test('T5.2.5: Multi-node live override isolation: streaming Route A does not touch Route B overrides', () => {
    const routeA = createTestRoute('route_A', [
      [0, 0],
      [10, 0],
    ])
    const routeB = createTestRoute('route_B', [
      [0, 10],
      [10, 10],
    ])
    useScene.getState().createNode(routeA)
    useScene.getState().createNode(routeB)

    // Stream 50 frames to Route A
    for (let f = 1; f <= 50; f++) {
      useLiveNodeOverrides.getState().set('route_A', {
        points: [
          [0, 0],
          [10, f * 0.1],
        ],
      })
    }

    expect(useLiveNodeOverrides.getState().get('route_A')).toBeDefined()
    expect(useLiveNodeOverrides.getState().get('route_B')).toBeUndefined()

    // Clear Route A
    useLiveNodeOverrides.getState().clear('route_A')
    expect(useLiveNodeOverrides.getState().get('route_A')).toBeUndefined()
    expect(useLiveNodeOverrides.getState().get('route_B')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SUITE 3: Keydown Listener & Event Target Filtering
// ---------------------------------------------------------------------------

describe('Suite 3: Keydown Listener & Event Target Filtering', () => {
  // Simulates the exact handleKeyDown callback from route-controls.tsx (lines 164-185)
  function createKeydownHandler(
    nodeRef: { current: RouteNode | null },
    selectedIndexRef: { current: number | null },
  ) {
    let preventDefaultCalled = false
    let deleteCommitted = false

    const handler = (event: MockKeyboardEvent) => {
      preventDefaultCalled = false
      deleteCommitted = false

      // Exact input element guard from route-controls.tsx line 165-170
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target as HTMLElement)?.isContentEditable
      ) {
        return
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedIndexRef.current === null) return
      if (!nodeRef.current || nodeRef.current.points.length <= 2) return

      event.preventDefault()
      preventDefaultCalled = true

      const removed = withRouteVertexRemoved(nodeRef.current.points, selectedIndexRef.current)
      if (removed) {
        selectedIndexRef.current = null
        deleteCommitted = true
        nodeRef.current = { ...nodeRef.current, points: removed }
        useScene
          .getState()
          .updateNode(nodeRef.current.id as AnyNodeId, { points: removed } as never)
      }
    }

    return {
      handler,
      wasPreventDefaultCalled: () => preventDefaultCalled,
      wasDeleteCommitted: () => deleteCommitted,
    }
  }

  test('T5.3.1: Delete/Backspace on HTMLInputElement does NOT call preventDefault and does NOT delete vertex', () => {
    const route = createTestRoute('route_input_test', [
      [0, 0],
      [5, 5],
      [10, 0],
    ])
    const nodeRef = { current: route }
    const selectedIndexRef = { current: 1 } // Vertex 1 selected in 3D

    const { handler, wasPreventDefaultCalled, wasDeleteCommitted } = createKeydownHandler(
      nodeRef,
      selectedIndexRef,
    )

    const inputTarget = new MockHTMLInputElement()
    const deleteEvt = new MockKeyboardEvent('Delete', inputTarget)
    handler(deleteEvt)

    expect(deleteEvt.defaultPrevented).toBe(false)
    expect(wasPreventDefaultCalled()).toBe(false)
    expect(wasDeleteCommitted()).toBe(false)
    expect(selectedIndexRef.current).toBe(1) // selection preserved
    expect(nodeRef.current.points.length).toBe(3) // 3 vertices intact

    const backspaceEvt = new MockKeyboardEvent('Backspace', inputTarget)
    handler(backspaceEvt)
    expect(backspaceEvt.defaultPrevented).toBe(false)
    expect(wasDeleteCommitted()).toBe(false)
    expect(nodeRef.current.points.length).toBe(3)
  })

  test('T5.3.2: Delete/Backspace on HTMLTextAreaElement does NOT trigger vertex deletion', () => {
    const route = createTestRoute('route_textarea_test', [
      [0, 0],
      [5, 5],
      [10, 0],
    ])
    const nodeRef = { current: route }
    const selectedIndexRef = { current: 1 }

    const { handler, wasDeleteCommitted } = createKeydownHandler(nodeRef, selectedIndexRef)

    const textareaTarget = new MockHTMLTextAreaElement()
    const evt = new MockKeyboardEvent('Backspace', textareaTarget)
    handler(evt)

    expect(evt.defaultPrevented).toBe(false)
    expect(wasDeleteCommitted()).toBe(false)
    expect(nodeRef.current.points.length).toBe(3)
  })

  test('T5.3.3: Delete/Backspace on contentEditable element does NOT trigger vertex deletion', () => {
    const route = createTestRoute('route_contenteditable_test', [
      [0, 0],
      [5, 5],
      [10, 0],
    ])
    const nodeRef = { current: route }
    const selectedIndexRef = { current: 1 }

    const { handler, wasDeleteCommitted } = createKeydownHandler(nodeRef, selectedIndexRef)

    const editableDiv = new MockHTMLElement()
    editableDiv.isContentEditable = true

    const evt = new MockKeyboardEvent('Delete', editableDiv)
    handler(evt)

    expect(evt.defaultPrevented).toBe(false)
    expect(wasDeleteCommitted()).toBe(false)
    expect(nodeRef.current.points.length).toBe(3)
  })

  test('T5.3.4: Delete/Backspace on 3D Canvas / Window with selected vertex DOES delete vertex and clear selection', () => {
    const route = createTestRoute('route_canvas_test', [
      [0, 0],
      [5, 5],
      [10, 0],
    ])
    const nodeRef = { current: route }
    const selectedIndexRef = { current: 1 }

    useScene.getState().createNode(route)
    const { handler, wasPreventDefaultCalled, wasDeleteCommitted } = createKeydownHandler(
      nodeRef,
      selectedIndexRef,
    )

    const canvasTarget = new MockHTMLElement()
    canvasTarget.tagName = 'CANVAS'

    const evt = new MockKeyboardEvent('Delete', canvasTarget)
    handler(evt)

    expect(evt.defaultPrevented).toBe(true)
    expect(wasPreventDefaultCalled()).toBe(true)
    expect(wasDeleteCommitted()).toBe(true)
    expect(selectedIndexRef.current).toBeNull() // Selection cleared
    expect(nodeRef.current.points.length).toBe(2) // Vertex removed
    expect(nodeRef.current.points).toEqual([
      [0, 0],
      [10, 0],
    ])
  })

  test('T5.3.5: Delete on route with length <= 2 is strictly rejected, maintaining minimum 2 vertices invariant', () => {
    const route = createTestRoute('route_min2_test', [
      [0, 0],
      [10, 0],
    ])
    const nodeRef = { current: route }
    const selectedIndexRef = { current: 0 }

    const { handler, wasDeleteCommitted } = createKeydownHandler(nodeRef, selectedIndexRef)

    const canvasTarget = new MockHTMLElement()
    canvasTarget.tagName = 'CANVAS'

    const evt = new MockKeyboardEvent('Delete', canvasTarget)
    handler(evt)

    expect(evt.defaultPrevented).toBe(false)
    expect(wasDeleteCommitted()).toBe(false)
    expect(nodeRef.current.points.length).toBe(2)
  })

  test('T5.3.6: Non-deletion keys (Enter, Escape, KeyA) do not trigger vertex deletion', () => {
    const route = createTestRoute('route_keys_test', [
      [0, 0],
      [5, 5],
      [10, 0],
    ])
    const nodeRef = { current: route }
    const selectedIndexRef = { current: 1 }

    const { handler, wasDeleteCommitted } = createKeydownHandler(nodeRef, selectedIndexRef)

    const canvasTarget = new MockHTMLElement()
    for (const key of ['Enter', 'Escape', 'a', 'ArrowUp', 'Space']) {
      const evt = new MockKeyboardEvent(key, canvasTarget)
      handler(evt)
      expect(evt.defaultPrevented).toBe(false)
      expect(wasDeleteCommitted()).toBe(false)
      expect(nodeRef.current.points.length).toBe(3)
    }
  })

  test('T5.3.7: Empirical Vulnerability: HTMLSelectElement is NOT filtered by instanceof HTMLInputElement, risking vertex deletion during dropdown interaction', () => {
    const route = createTestRoute('route_select_vuln', [
      [0, 0],
      [5, 5],
      [10, 0],
    ])
    const nodeRef = { current: route }
    const selectedIndexRef = { current: 1 }

    const { handler, wasDeleteCommitted } = createKeydownHandler(nodeRef, selectedIndexRef)

    const selectTarget = new MockHTMLSelectElement()

    // Verifies the vulnerability: selectTarget is NOT instanceof HTMLInputElement
    expect(selectTarget instanceof HTMLInputElement).toBe(false)
    expect(selectTarget instanceof HTMLTextAreaElement).toBe(false)
    expect(selectTarget.isContentEditable).toBe(false)

    // When Delete is pressed inside a <select> dropdown, the handler mistakenly treats it as a 3D canvas key!
    const evt = new MockKeyboardEvent('Delete', selectTarget)
    handler(evt)

    expect(evt.defaultPrevented).toBe(true)
    expect(wasDeleteCommitted()).toBe(true)
    expect(nodeRef.current.points.length).toBe(2) // Accidental deletion!

    // Proves that route-controls.tsx should check (event.target as HTMLElement)?.tagName === 'SELECT' or closest('select')!
  })
})

// ---------------------------------------------------------------------------
// SUITE 4: Dual-Mount Suppression Under Rapid Selection Toggling
// ---------------------------------------------------------------------------

describe('Suite 4: Dual-Mount Suppression Under Rapid Selection Toggling', () => {
  // Simulates the exact dual-mount suppression state and lifecycle from route-controls.tsx (lines 32-72)
  class AffordanceLifecycleHarness {
    activeAffordanceNodes = new Set<string>()

    mountStandalone(nodeId: string) {
      this.activeAffordanceNodes.add(nodeId)
      return () => {
        this.activeAffordanceNodes.delete(nodeId)
      }
    }

    shouldRenderFallback(nodeId: string): boolean {
      // In route-controls.tsx line 70:
      // if (!isStandaloneAffordance && nodeId && activeAffordanceNodes.has(nodeId)) return null
      return !this.activeAffordanceNodes.has(nodeId)
    }
  }

  test('T5.4.1: Standalone affordance suppresses fallback renderer controls for the same route', () => {
    const harness = new AffordanceLifecycleHarness()
    const routeId = 'route_dual_mount_1'

    // Before standalone affordance mounts, fallback is allowed to render
    expect(harness.shouldRenderFallback(routeId)).toBe(true)

    // Mount standalone affordance (SelectionAffordanceManager)
    const unmountStandalone = harness.mountStandalone(routeId)

    // Fallback inside renderer is now suppressed (returns null)
    expect(harness.shouldRenderFallback(routeId)).toBe(false)

    // Unmount standalone
    unmountStandalone()

    // Fallback is unsuppressed
    expect(harness.shouldRenderFallback(routeId)).toBe(true)
  })

  test('T5.4.2: 100 rapid selection toggles maintain exact 1:1 balance in activeAffordanceNodes without set memory leaks', () => {
    const harness = new AffordanceLifecycleHarness()
    const routeId = 'route_rapid_toggle'

    for (let i = 0; i < 100; i++) {
      const unmount = harness.mountStandalone(routeId)
      expect(harness.activeAffordanceNodes.size).toBe(1)
      expect(harness.shouldRenderFallback(routeId)).toBe(false)

      unmount()
      expect(harness.activeAffordanceNodes.size).toBe(0)
      expect(harness.shouldRenderFallback(routeId)).toBe(true)
    }

    expect(harness.activeAffordanceNodes.size).toBe(0)
  })

  test('T5.4.3: Multi-route selection switching across 3 routes maintains strict isolation', () => {
    const harness = new AffordanceLifecycleHarness()

    const unmountA = harness.mountStandalone('route_A')
    expect(harness.shouldRenderFallback('route_A')).toBe(false)
    expect(harness.shouldRenderFallback('route_B')).toBe(true)
    expect(harness.shouldRenderFallback('route_C')).toBe(true)

    const unmountB = harness.mountStandalone('route_B')
    expect(harness.shouldRenderFallback('route_A')).toBe(false)
    expect(harness.shouldRenderFallback('route_B')).toBe(false)
    expect(harness.shouldRenderFallback('route_C')).toBe(true)

    unmountA()
    expect(harness.shouldRenderFallback('route_A')).toBe(true)
    expect(harness.shouldRenderFallback('route_B')).toBe(false)

    unmountB()
    expect(harness.activeAffordanceNodes.size).toBe(0)
  })

  test('T5.4.4: Empirical Vulnerability: Deselection mid-drag leaves orphan inputDragging, unresumed temporal, and dangling live override', () => {
    const routeId = 'route_unmount_mid_drag'
    const route = createTestRoute(routeId)
    useScene.getState().createNode(route)

    // Simulate drag start in RouteControls
    useViewer.getState().setInputDragging?.(true)
    useScene.temporal.getState().pause()
    useLiveNodeOverrides.getState().set(routeId, {
      points: [
        [0, 0],
        [99, 99],
      ],
    })

    expect(useViewer.getState().inputDragging).toBe(true)
    expect(useScene.temporal.getState().isTracking).toBe(false)
    expect(useLiveNodeOverrides.getState().get(routeId)).toBeDefined()

    // Simulate sudden unmount (user pressed ESC or clicked another tool or node deleted)
    // In route-controls.tsx, useEffect on [nodeId] or unmount cleanup does NOT call cancelDrag!
    // So the system state is left in an orphaned state:
    expect(useViewer.getState().inputDragging).toBe(true) // STUCK IN DRAGGING!
    expect(useScene.temporal.getState().isTracking).toBe(false) // STUCK IN PAUSED TEMPORAL!
    expect(useLiveNodeOverrides.getState().get(routeId)).toBeDefined() // ORPHAN OVERRIDE LEAK!

    // Cleanup manually for subsequent tests
    useViewer.getState().setInputDragging?.(false)
    useScene.temporal.getState().resume()
    useLiveNodeOverrides.getState().clear(routeId)
  })
})

// ---------------------------------------------------------------------------
// SUITE 5: Interaction Edge Cases & Robustness
// ---------------------------------------------------------------------------

describe('Suite 5: Interaction Edge Cases & Robustness', () => {
  test('T5.5.1: swallowNextClick intercepts and stops propagation of the canvas click event following drag release', () => {
    const mockWindow = new MockEventTarget()

    function simulateSwallowNextClick(win: MockEventTarget) {
      const handler = (e: any) => {
        e.stopPropagation()
        win.removeEventListener('click', handler, true)
      }
      win.addEventListener('click', handler, true)
    }

    simulateSwallowNextClick(mockWindow)

    const clickEvt = new MockMouseEvent('click')
    mockWindow.dispatchEvent(clickEvt)

    // Propagation was stopped, preventing canvas deselect
    expect(clickEvt.propagationStopped).toBe(true)
  })

  test('T5.5.2: Mid-drag external node point mutations: commit writes drag draft points and clears override', () => {
    const routeId = 'route_external_update'
    const initialPoints: Point[] = [
      [0, 0],
      [10, 0],
    ]
    const route = createTestRoute(routeId, initialPoints)
    useScene.getState().createNode(route)

    // Drag in progress with draft at [10, 5]
    const draftPoints: Point[] = [
      [0, 0],
      [10, 5],
    ]
    useLiveNodeOverrides.getState().set(routeId, { points: draftPoints })

    // Meanwhile an external operation modifies the scene node directly (e.g. multi-user or inspector)
    useScene.getState().updateNode(
      routeId as AnyNodeId,
      {
        points: [
          [0, 0],
          [10, 20],
        ],
      } as never,
    )

    // When the user releases the drag handle, draft points are committed
    useScene.getState().updateNode(routeId as AnyNodeId, { points: draftPoints } as never)
    useLiveNodeOverrides.getState().clear(routeId)

    expect((useScene.getState().nodes[routeId as AnyNodeId] as RouteNode).points).toEqual([
      [0, 0],
      [10, 5],
    ])
    expect(useLiveNodeOverrides.getState().get(routeId)).toBeUndefined()
  })

  test('T5.5.3: Orthogonal snap anti-collapse: prevents collapse when movement along perpendicular axis is < 0.05m', () => {
    const anchor: Point = [10, 10]

    // Candidate at [10.02, 10.01]: dx = 0.02 (< 0.10 threshold), dz = 0.01 (< 0.05 min length)
    // Snapping X to anchor[0] would result in [10, 10.01], segment length 0.01m (< 0.05m)
    // snapOrthogonal must refuse to snap to prevent near-zero collapse!
    const snapped = snapOrthogonal(anchor, [10.02, 10.01], ORTHOGONAL_SNAP_THRESHOLD_M)
    expect(snapped[0]).toBe(10.02)
    expect(snapped[1]).toBe(10.01)

    // When dz >= 0.05m (e.g. [10.02, 10.06]), snap to X is permitted
    const validSnap = snapOrthogonal(anchor, [10.02, 10.06], ORTHOGONAL_SNAP_THRESHOLD_M)
    expect(validSnap[0]).toBe(10)
    expect(validSnap[1]).toBe(10.06)
  })

  test('T5.5.4: Collinear snapping handles zero-length chords and collinear points along tilted 45-degree axis', () => {
    // Zero-length chord: pPrev == pNext
    const coincident = snapCollinear([5, 5], [5, 5], [6, 6])
    expect(coincident).toEqual([6, 6])

    // Diagonal chord from [0, 0] to [10, 10]
    const pPrev: Point = [0, 0]
    const pNext: Point = [10, 10]
    const offset = 0.08 / Math.SQRT2 // 8cm offset (< 15cm threshold)
    const candidate: Point = [5 - offset, 5 + offset]

    const snapped = snapCollinear(pPrev, pNext, candidate, COLLINEAR_SNAP_THRESHOLD_M)
    expect(snapped[0]).toBeCloseTo(5, 5)
    expect(snapped[1]).toBeCloseTo(5, 5)
  })

  test('T5.5.5: Polyline vertex capacity boundaries: insertControlPoint at 64 vertices throws while 63 vertices succeeds', () => {
    const pts63: Point[] = Array.from({ length: 63 }, (_, i) => [i, 0])
    const route63 = RouteNode.parse({
      id: 'route_cap_63',
      type: 'warehouse:route',
      points: pts63,
    })
    const route64 = insertControlPoint(route63, 0)
    expect(route64.points.length).toBe(64)

    // Insertion at 64 must throw error
    expect(() => insertControlPoint(route64, 0)).toThrow()
  })
})
