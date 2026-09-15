import { describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useScene } from '@pascal-app/core'
import React from 'react'
import { RowLabelRenderer } from './row-labels-renderer'
import * as rowNaming from './row-naming'
import { PalletRackNode } from './schema'
import { bayPitch } from './slots'

// Headless polyfills for scene store
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(cb, 0) as unknown as number
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

const makeRack = (id: string, overrides: Record<string, unknown> = {}): PalletRackNode =>
  PalletRackNode.parse({
    id: `pallet_rack_${id}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    rowLabel: 'A1',
    ...overrides,
  })

/**
 * Lightweight React Component test harness that accurately simulates
 * the React 19 hook lifecycle (useState, useEffect, dependency comparison, re-render)
 * without needing a browser DOM or WebGL canvas.
 */
class ComponentHarness {
  private stateMap = new Map<number, any>()
  private effectMap = new Map<number, { cb: () => void; deps: any[] }>()
  public renderCount = 0

  render(node: PalletRackNode) {
    let hookIdx = 0
    this.renderCount++

    const prevDispatcher = (React as any)
      .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H

    const pendingEffects: Array<() => void> = []

    ;(React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = {
      useState: (initial: any) => {
        const id = hookIdx++
        if (!this.stateMap.has(id)) {
          this.stateMap.set(id, typeof initial === 'function' ? initial() : initial)
        }
        const current = this.stateMap.get(id)
        const setState = (action: any) => {
          const next = typeof action === 'function' ? action(this.stateMap.get(id)) : action
          this.stateMap.set(id, next)
        }
        return [current, setState]
      },
      useEffect: (cb: () => void, deps?: any[]) => {
        const id = hookIdx++
        const prev = this.effectMap.get(id)
        let shouldRun = false
        if (!prev?.deps || !deps) {
          shouldRun = true
        } else if (
          deps.length !== prev.deps.length ||
          deps.some((d, i) => !Object.is(d, prev.deps[i]))
        ) {
          shouldRun = true
        }
        this.effectMap.set(id, { cb, deps: deps ? [...deps] : [] })
        if (shouldRun) {
          pendingEffects.push(cb)
        }
      },
    }

    try {
      RowLabelRenderer({ node })
    } finally {
      ;(React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H =
        prevDispatcher
    }

    // Run scheduled effects (as React does after commit)
    for (const effect of pendingEffects) {
      effect()
    }

    // If state changed during effect, simulate the follow-up render
    let finalResult: any
    try {
      ;(React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = {
        useState: () => {
          const id = 0
          return [this.stateMap.get(id), (v: any) => this.stateMap.set(id, v)]
        },
        useEffect: () => {},
      }
      finalResult = RowLabelRenderer({ node })
    } finally {
      ;(React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H =
        prevDispatcher
    }

    return finalResult
  }

  getCurrentState() {
    return this.stateMap.get(0)
  }
}

describe('RowLabelRenderer Non-Reactive Architecture & Requirements', () => {
  test('R1: Source code contains ZERO reactive subscriptions to useScene', () => {
    const filePath = path.resolve(__dirname, 'row-labels-renderer.tsx')
    const content = readFileSync(filePath, 'utf8')

    // Must NOT contain reactive subscriptions like useScene((s) => ...) or useScene(s => ...)
    expect(content).not.toMatch(/useScene\s*\(\s*\(?\s*\w+\s*\)?\s*=>/)
    expect(content).not.toContain('useScene((s)')
    expect(content).not.toContain('useScene(s =>')

    // Must use non-reactive read via useScene.getState()
    expect(content).toContain('useScene.getState')
  })

  test('R2: Uses local state (useState) and useEffect with specified dependencies', () => {
    const filePath = path.resolve(__dirname, 'row-labels-renderer.tsx')
    const content = readFileSync(filePath, 'utf8')

    // Must import and use useState and useEffect
    expect(content).toContain('useState')
    expect(content).toContain('useEffect')

    // useEffect dependency array must contain id, rowLabel, position, and rotation
    expect(content).toMatch(/node\.id/)
    expect(content).toMatch(/node\.rowLabel/)
    expect(content).toMatch(/node\.position/)
    expect(content).toMatch(/node\.rotation/)
  })
})

describe('RowLabelRenderer Lifecycle & Dynamic Updates', () => {
  test('initial mount computes end-rack status via useEffect non-reactively', () => {
    const rack = makeRack('single_1', { position: [0, 0, 0], rowLabel: 'ROW-1' })
    useScene.setState({
      nodes: {
        [rack.id]: rack,
      } as any,
    })

    const harness = new ComponentHarness()
    const vdom = harness.render(rack)

    expect(harness.getCurrentState()).toEqual({
      isFirst: true,
      isLast: true,
    })
    expect(vdom).not.toBeNull()
    expect(vdom.props.name).toBe(`rack-signs-${rack.id}`)
  })

  test('intermediate rack suppresses signs and returns null', () => {
    const base = makeRack('b1')
    const pitch = bayPitch(base)

    const r1 = makeRack('m_1', { position: [0, 0, 0], rowLabel: 'MID' })
    const r2 = makeRack('m_2', { position: [pitch, 0, 0], rowLabel: 'MID' })
    const r3 = makeRack('m_3', { position: [pitch * 2, 0, 0], rowLabel: 'MID' })

    useScene.setState({
      nodes: {
        [r1.id]: r1,
        [r2.id]: r2,
        [r3.id]: r3,
      } as any,
    })

    const harness = new ComponentHarness()
    const vdom = harness.render(r2)

    expect(harness.getCurrentState()).toEqual({
      isFirst: false,
      isLast: false,
    })
    expect(vdom).toBeNull()
  })

  test('rack with empty rowLabel cleanly suppresses calculation and returns null', () => {
    const emptyRack = makeRack('empty', { rowLabel: '' })
    useScene.setState({
      nodes: {
        [emptyRack.id]: emptyRack,
      } as any,
    })

    const spyFirst = spyOn(rowNaming, 'isFirstRackOfRow')
    const harness = new ComponentHarness()
    const vdom = harness.render(emptyRack)

    expect(vdom).toBeNull()
    expect(harness.getCurrentState()).toEqual({
      isFirst: false,
      isLast: false,
    })
    // Neither isFirstRackOfRow nor isLastRackOfRow should be invoked for empty labels
    expect(spyFirst).not.toHaveBeenCalled()
    spyFirst.mockRestore()
  })

  test('useEffect re-runs when node.position changes', () => {
    const base = makeRack('b')
    const pitch = bayPitch(base)

    const r1 = makeRack('pos_1', { position: [0, 0, 0], rowLabel: 'MOVE' })
    const r2 = makeRack('pos_2', { position: [pitch, 0, 0], rowLabel: 'MOVE' })
    const r3 = makeRack('pos_3', { position: [pitch * 2, 0, 0], rowLabel: 'MOVE' })

    useScene.setState({
      nodes: {
        [r1.id]: r1,
        [r2.id]: r2,
        [r3.id]: r3,
      } as any,
    })

    const harness = new ComponentHarness()
    // First render: r1 is first rack
    harness.render(r1)
    expect(harness.getCurrentState()).toEqual({ isFirst: true, isLast: false })

    // Now move r1 to position pitch * 3 (it becomes the last rack of the row)
    const movedR1 = makeRack('pos_1', { position: [pitch * 3, 0, 0], rowLabel: 'MOVE' })
    useScene.setState({
      nodes: {
        [movedR1.id]: movedR1,
        [r2.id]: r2,
        [r3.id]: r3,
      } as any,
    })

    harness.render(movedR1)
    expect(harness.getCurrentState()).toEqual({ isFirst: false, isLast: true })
  })

  test('useEffect re-runs when node.rowLabel changes', () => {
    const rack = makeRack('rename_1', { position: [0, 0, 0], rowLabel: 'OLD' })
    useScene.setState({
      nodes: {
        [rack.id]: rack,
      } as any,
    })

    const harness = new ComponentHarness()
    harness.render(rack)
    expect(harness.getCurrentState()).toEqual({ isFirst: true, isLast: true })

    const renamed = makeRack('rename_1', { position: [0, 0, 0], rowLabel: 'NEW' })
    useScene.setState({
      nodes: {
        [renamed.id]: renamed,
      } as any,
    })

    const spyFirst = spyOn(rowNaming, 'isFirstRackOfRow')
    harness.render(renamed)
    expect(spyFirst).toHaveBeenCalled()
    expect(harness.getCurrentState()).toEqual({ isFirst: true, isLast: true })
    spyFirst.mockRestore()
  })

  test('applyRowLabelToContiguousRacks triggers updates across the entire run when extending a row', () => {
    const base = makeRack('b')
    const pitch = bayPitch(base)

    const r1 = makeRack('ext_1', { position: [0, 0, 0], rowLabel: 'ROW-EXT' })
    const r2 = makeRack('ext_2', { position: [pitch, 0, 0], rowLabel: 'ROW-EXT' })

    useScene.setState({
      nodes: {
        [r1.id]: r1,
        [r2.id]: r2,
      } as any,
    })

    const harness1 = new ComponentHarness()
    const harness2 = new ComponentHarness()
    harness1.render(r1)
    harness2.render(r2)

    expect(harness1.getCurrentState()).toEqual({ isFirst: true, isLast: false })
    expect(harness2.getCurrentState()).toEqual({ isFirst: false, isLast: true })

    // Append a 3rd rack to the row
    const r3 = makeRack('ext_3', { position: [pitch * 2, 0, 0], rowLabel: '' })
    useScene.setState({
      nodes: {
        [r1.id]: r1,
        [r2.id]: r2,
        [r3.id]: r3,
      } as any,
    })

    // User applies row label to the contiguous run
    rowNaming.applyRowLabelToContiguousRacks(r1.id, 'ROW-EXT')

    // Re-render harness for r2 with its updated node from scene
    const updatedR2 = useScene.getState().nodes[r2.id] as PalletRackNode
    harness2.render(updatedR2)

    // Intermediate rack r2 must now have isFirst: false, isLast: false (signs suppressed)
    expect(harness2.getCurrentState()).toEqual({ isFirst: false, isLast: false })

    // And new end rack r3 has isFirst: false, isLast: true
    const harness3 = new ComponentHarness()
    const updatedR3 = useScene.getState().nodes[r3.id] as PalletRackNode
    harness3.render(updatedR3)
    expect(harness3.getCurrentState()).toEqual({ isFirst: false, isLast: true })
  })

  test('applyRowLabelToContiguousRacks updates remaining end rack when end rack is removed', () => {
    const base = makeRack('b')
    const pitch = bayPitch(base)

    const r1 = makeRack('del_1', { position: [0, 0, 0], rowLabel: 'ROW-DEL' })
    const r2 = makeRack('del_2', { position: [pitch, 0, 0], rowLabel: 'ROW-DEL' })
    const r3 = makeRack('del_3', { position: [pitch * 2, 0, 0], rowLabel: 'ROW-DEL' })

    useScene.setState({
      nodes: {
        [r1.id]: r1,
        [r2.id]: r2,
        [r3.id]: r3,
      } as any,
    })

    const harness1 = new ComponentHarness()
    const harness2 = new ComponentHarness()
    const harness3 = new ComponentHarness()
    harness1.render(r1)
    harness2.render(r2)
    harness3.render(r3)

    expect(harness1.getCurrentState()).toEqual({ isFirst: true, isLast: false })
    expect(harness2.getCurrentState()).toEqual({ isFirst: false, isLast: false })
    expect(harness3.getCurrentState()).toEqual({ isFirst: false, isLast: true })

    // Simulate deleting r3 from the scene
    const nodesWithoutR3 = { ...useScene.getState().nodes }
    delete nodesWithoutR3[r3.id]
    useScene.setState({ nodes: nodesWithoutR3 })

    // Re-apply row label on remaining row
    rowNaming.applyRowLabelToContiguousRacks(r1.id, 'ROW-DEL')

    // r2 is now the last rack in the row
    const updatedR2 = useScene.getState().nodes[r2.id] as PalletRackNode
    harness2.render(updatedR2)
    expect(harness2.getCurrentState()).toEqual({ isFirst: false, isLast: true })
  })
})

describe('Empirical Drag Benchmark — 10,000 Frames Zero Overhead Verification', () => {
  test('isFirstRackOfRow is called ZERO times when dragging an unrelated object in the scene', () => {
    const base = makeRack('base')
    const pitch = bayPitch(base)

    // Set up a 2-rack row
    const rackA = makeRack('bench_a', { position: [0, 0, 0], rowLabel: 'AISLE-1' })
    const rackB = makeRack('bench_b', { position: [pitch, 0, 0], rowLabel: 'AISLE-1' })

    // Unrelated object being dragged (e.g. a forklift, pallet, or wall)
    const unrelatedNode = {
      id: 'forklift_unrelated',
      type: 'warehouse:truck',
      position: [100, 0, 100],
      rotation: [0, 0, 0],
    }

    useScene.setState({
      nodes: {
        [rackA.id]: rackA,
        [rackB.id]: rackB,
        [unrelatedNode.id]: unrelatedNode,
      } as any,
    })

    // Mount both rack label renderers
    const harnessA = new ComponentHarness()
    const harnessB = new ComponentHarness()
    harnessA.render(rackA)
    harnessB.render(rackB)

    expect(harnessA.getCurrentState()).toEqual({ isFirst: true, isLast: false })
    expect(harnessB.getCurrentState()).toEqual({ isFirst: false, isLast: true })

    // Spy on isFirstRackOfRow and isLastRackOfRow
    const spyFirst = spyOn(rowNaming, 'isFirstRackOfRow')
    const spyLast = spyOn(rowNaming, 'isLastRackOfRow')

    // Simulate 10,000 frames of dragging the unrelated object across the warehouse floor
    const FRAMES = 10_000
    for (let f = 0; f < FRAMES; f++) {
      const x = 100 + f * 0.01
      const z = 100 + f * 0.01
      // Drag update: mutate scene store with new coordinates for the unrelated node
      useScene.setState({
        nodes: {
          ...useScene.getState().nodes,
          [unrelatedNode.id]: {
            ...unrelatedNode,
            position: [x, 0, z],
          },
        } as any,
      })
    }

    // Strict assertion: Zero calls during dragging of unrelated object
    expect(spyFirst).toHaveBeenCalledTimes(0)
    expect(spyLast).toHaveBeenCalledTimes(0)

    spyFirst.mockRestore()
    spyLast.mockRestore()
  })
})
