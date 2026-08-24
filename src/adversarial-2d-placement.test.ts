import { describe, expect, test } from 'bun:test'
import { type AnyNode, emitter } from '@pascal-app/core'
import { useEditor, useFacingPose, usePlacementPreview } from '@pascal-app/editor'
import { warehousePlugin } from './index'
import {
  clearPlacementPreview,
  disarmPlacementToolOnCommit,
  publishPlacementPreview,
  resolveActiveLevelId,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
} from './placement'

describe('Adversarial Challenge 1: Ambient Building View (null selection.levelId)', () => {
  const buildingWithLevels: Record<string, unknown> = {
    'bldg-1': {
      id: 'bldg-1',
      type: 'building',
      object: 'node',
      children: ['lvl-1', 'lvl-0', 'lvl-2'],
    },
    'lvl-0': {
      id: 'lvl-0',
      type: 'level',
      object: 'node',
      level: 0,
      parentId: 'bldg-1',
      children: [],
    },
    'lvl-1': {
      id: 'lvl-1',
      type: 'level',
      object: 'node',
      level: 1,
      parentId: 'bldg-1',
      children: [],
    },
    'lvl-2': {
      id: 'lvl-2',
      type: 'level',
      object: 'node',
      level: 2,
      parentId: 'bldg-1',
      children: [],
    },
  }

  test('null selection.levelId with buildingId resolves Level 0 regardless of child array order', () => {
    const resolved = resolveActiveLevelId(buildingWithLevels, {
      levelId: null,
      buildingId: 'bldg-1',
    })
    expect(resolved).toBe('lvl-0')
  })

  test('undefined selection.levelId resolves Level 0', () => {
    const resolved = resolveActiveLevelId(buildingWithLevels, {
      levelId: undefined,
      buildingId: 'bldg-1',
    })
    expect(resolved).toBe('lvl-0')
  })

  test('stale / dangling levelId (deleted from scene) gracefully falls back to ambient Level 0', () => {
    const resolved = resolveActiveLevelId(buildingWithLevels, {
      levelId: 'deleted-level-uuid-999',
      buildingId: 'bldg-1',
    })
    expect(resolved).toBe('lvl-0')
  })

  test('stale / dangling buildingId falls back to scene-wide Level 0', () => {
    const resolved = resolveActiveLevelId(buildingWithLevels, {
      levelId: null,
      buildingId: 'deleted-building-uuid-888',
    })
    expect(resolved).toBe('lvl-0')
  })

  test('building with corrupted / non-string children array handles gracefully', () => {
    const corruptedNodes: Record<string, unknown> = {
      'bldg-corrupt': {
        id: 'bldg-corrupt',
        type: 'building',
        children: [null, undefined, 123, 'missing-node-id', 'lvl-valid-0'],
      },
      'lvl-valid-0': {
        id: 'lvl-valid-0',
        type: 'level',
        level: 0,
        parentId: 'bldg-corrupt',
      },
    }
    const resolved = resolveActiveLevelId(corruptedNodes, {
      buildingId: 'bldg-corrupt',
    })
    expect(resolved).toBe('lvl-valid-0')
  })

  test('building node without children property falls back across scene', () => {
    const nodesWithoutChildren: Record<string, unknown> = {
      'bldg-empty': {
        id: 'bldg-empty',
        type: 'building',
      },
      'lvl-fallback-0': {
        id: 'lvl-fallback-0',
        type: 'level',
        level: 0,
      },
    }
    const resolved = resolveActiveLevelId(nodesWithoutChildren, {
      buildingId: 'bldg-empty',
    })
    expect(resolved).toBe('lvl-fallback-0')
  })
})

describe('Adversarial Challenge 2: Multi-Building Scenes', () => {
  const multiBuildingScene: Record<string, unknown> = {
    'bldg-alpha': {
      id: 'bldg-alpha',
      type: 'building',
      object: 'node',
      children: ['lvl-a0', 'lvl-a1'],
    },
    'lvl-a0': {
      id: 'lvl-a0',
      type: 'level',
      object: 'node',
      level: 0,
      parentId: 'bldg-alpha',
      children: [],
    },
    'lvl-a1': {
      id: 'lvl-a1',
      type: 'level',
      object: 'node',
      level: 1,
      parentId: 'bldg-alpha',
      children: [],
    },

    'bldg-beta': {
      id: 'bldg-beta',
      type: 'building',
      object: 'node',
      children: ['lvl-b0', 'lvl-b1'],
    },
    'lvl-b0': {
      id: 'lvl-b0',
      type: 'level',
      object: 'node',
      level: 0,
      parentId: 'bldg-beta',
      children: [],
    },
    'lvl-b1': {
      id: 'lvl-b1',
      type: 'level',
      object: 'node',
      level: 1,
      parentId: 'bldg-beta',
      children: [],
    },

    'bldg-gamma': {
      id: 'bldg-gamma',
      type: 'building',
      object: 'node',
      children: ['lvl-c0'],
    },
    'lvl-c0': {
      id: 'lvl-c0',
      type: 'level',
      object: 'node',
      level: 0,
      parentId: 'bldg-gamma',
      children: [],
    },
  }

  test('selecting Building Beta attaches equipment to Building Beta Level 0, never Alpha', () => {
    const resolved = resolveActiveLevelId(multiBuildingScene, {
      levelId: null,
      buildingId: 'bldg-beta',
    })
    expect(resolved).toBe('lvl-b0')
  })

  test('selecting Building Gamma attaches equipment to Building Gamma Level 0', () => {
    const resolved = resolveActiveLevelId(multiBuildingScene, {
      levelId: null,
      buildingId: 'bldg-gamma',
    })
    expect(resolved).toBe('lvl-c0')
  })

  test('explicitly selecting Level B1 bypasses ambient Level 0 in multi-building scene', () => {
    const resolved = resolveActiveLevelId(multiBuildingScene, {
      levelId: 'lvl-b1',
      buildingId: 'bldg-beta',
    })
    expect(resolved).toBe('lvl-b1')
  })

  test('selecting Building with non-zero levels when another building has Level 0 does NOT cross-pollinate', () => {
    const mixedBuildingsScene: Record<string, unknown> = {
      'bldg-with-0': {
        id: 'bldg-with-0',
        type: 'building',
        object: 'node',
        children: ['lvl-zero'],
      },
      'lvl-zero': {
        id: 'lvl-zero',
        type: 'level',
        object: 'node',
        level: 0,
        parentId: 'bldg-with-0',
      },

      'bldg-only-upper': {
        id: 'bldg-only-upper',
        type: 'building',
        object: 'node',
        children: ['lvl-upper-1', 'lvl-upper-2'],
      },
      'lvl-upper-1': {
        id: 'lvl-upper-1',
        type: 'level',
        object: 'node',
        level: 1,
        parentId: 'bldg-only-upper',
      },
      'lvl-upper-2': {
        id: 'lvl-upper-2',
        type: 'level',
        object: 'node',
        level: 2,
        parentId: 'bldg-only-upper',
      },
    }

    // When user targets bldg-only-upper, it MUST resolve lvl-upper-1, NOT bldg-with-0's lvl-zero!
    const resolved = resolveActiveLevelId(mixedBuildingsScene, {
      buildingId: 'bldg-only-upper',
    })
    expect(resolved).toBe('lvl-upper-1')
  })
})

describe('Adversarial Challenge 3: Non-zero lowest levels and negative elevations (Basements)', () => {
  test('underground basement-only building with levels [-3, -2, -1] resolves lowest basement (-3)', () => {
    const basementScene: Record<string, unknown> = {
      'bldg-underground': {
        id: 'bldg-underground',
        type: 'building',
        object: 'node',
        children: ['lvl-b1', 'lvl-b3', 'lvl-b2'],
      },
      'lvl-b1': { id: 'lvl-b1', type: 'level', object: 'node', level: -1 },
      'lvl-b2': { id: 'lvl-b2', type: 'level', object: 'node', level: -2 },
      'lvl-b3': { id: 'lvl-b3', type: 'level', object: 'node', level: -3 },
    }

    const resolved = resolveActiveLevelId(basementScene, {
      buildingId: 'bldg-underground',
    })
    expect(resolved).toBe('lvl-b3')
  })

  test('building with basement (-1), ground (0), and floor (1) prefers Ground Floor (0)', () => {
    const standardBuildingWithBasement: Record<string, unknown> = {
      'bldg-std': {
        id: 'bldg-std',
        type: 'building',
        object: 'node',
        children: ['lvl-neg1', 'lvl-g0', 'lvl-pos1'],
      },
      'lvl-neg1': { id: 'lvl-neg1', type: 'level', object: 'node', level: -1 },
      'lvl-g0': { id: 'lvl-g0', type: 'level', object: 'node', level: 0 },
      'lvl-pos1': { id: 'lvl-pos1', type: 'level', object: 'node', level: 1 },
    }

    const resolved = resolveActiveLevelId(standardBuildingWithBasement, {
      buildingId: 'bldg-std',
    })
    expect(resolved).toBe('lvl-g0')
  })

  test('building with high-rise podium levels [10, 11, 12] resolves lowest level (10)', () => {
    const highRiseScene: Record<string, unknown> = {
      'bldg-high': {
        id: 'bldg-high',
        type: 'building',
        object: 'node',
        children: ['lvl-12', 'lvl-10', 'lvl-11'],
      },
      'lvl-10': { id: 'lvl-10', type: 'level', object: 'node', level: 10 },
      'lvl-11': { id: 'lvl-11', type: 'level', object: 'node', level: 11 },
      'lvl-12': { id: 'lvl-12', type: 'level', object: 'node', level: 12 },
    }

    const resolved = resolveActiveLevelId(highRiseScene, {
      buildingId: 'bldg-high',
    })
    expect(resolved).toBe('lvl-10')
  })

  test('building with non-integer split levels [-1.5, 0.5, 2.5] resolves lowest level (-1.5)', () => {
    const splitLevelScene: Record<string, unknown> = {
      'bldg-split': {
        id: 'bldg-split',
        type: 'building',
        object: 'node',
        children: ['lvl-p05', 'lvl-n15', 'lvl-p25'],
      },
      'lvl-n15': { id: 'lvl-n15', type: 'level', object: 'node', level: -1.5 },
      'lvl-p05': { id: 'lvl-p05', type: 'level', object: 'node', level: 0.5 },
      'lvl-p25': { id: 'lvl-p25', type: 'level', object: 'node', level: 2.5 },
    }

    const resolved = resolveActiveLevelId(splitLevelScene, {
      buildingId: 'bldg-split',
    })
    expect(resolved).toBe('lvl-n15')
  })

  test('building containing non-level child nodes (roof, elevator) filters them out cleanly', () => {
    const mixedChildrenScene: Record<string, unknown> = {
      'bldg-mixed': {
        id: 'bldg-mixed',
        type: 'building',
        object: 'node',
        children: ['elev-1', 'roof-1', 'lvl-4'],
      },
      'elev-1': { id: 'elev-1', type: 'elevator', object: 'node' },
      'roof-1': { id: 'roof-1', type: 'roof', object: 'node' },
      'lvl-4': { id: 'lvl-4', type: 'level', object: 'node', level: 4 },
    }

    const resolved = resolveActiveLevelId(mixedChildrenScene, {
      buildingId: 'bldg-mixed',
    })
    expect(resolved).toBe('lvl-4')
  })
})

describe('Adversarial Challenge 4: Rapid multiple placements in repeat vs single mode', () => {
  test('single mode disarms tool, clears preview and returns mode to select on commit', () => {
    useEditor.getState().setMode('build')
    useEditor.getState().setTool('pallet' as never)
    useEditor.getState().setContinuation('point', 'single')
    publishPlacementPreview({ id: 'ghost_p', type: 'warehouse:pallet', position: [0, 0, 0] })

    let repeatCount = 0
    disarmPlacementToolOnCommit(() => {
      repeatCount++
    })

    expect(repeatCount).toBe(0)
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
    expect(usePlacementPreview.getState().node).toBeNull()
  })

  test('repeat mode keeps tool armed and invokes repeat callback on commit', () => {
    useEditor.getState().setMode('build')
    useEditor.getState().setTool('pallet' as never)
    useEditor.getState().setContinuation('point', 'repeat')
    publishPlacementPreview({ id: 'ghost_p', type: 'warehouse:pallet', position: [0, 0, 0] })

    let repeatCount = 0
    disarmPlacementToolOnCommit(() => {
      repeatCount++
    })

    expect(repeatCount).toBe(1)
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('pallet' as never)

    // Repeat placement again
    disarmPlacementToolOnCommit(() => {
      repeatCount++
    })
    expect(repeatCount).toBe(2)
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('pallet' as never)
  })

  test('rapid clicks at different coordinates (> 1mm) all execute commits', () => {
    const committedPositions: Array<[number, number, number]> = []
    let lastPosition: [number, number, number] = [0, 0, 0]

    const unsubscribeMove = subscribeGridMove((pos) => {
      lastPosition = pos
    })
    const unsubscribeClicks = subscribePlacementClicks(() => {
      committedPositions.push([...lastPosition])
    })

    // Simulate burst placement across 5 different grid points
    const points: Array<[number, number]> = [
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 0],
      [8, 0],
    ]

    for (const [x, z] of points) {
      emitter.emit('grid:move', {
        position: [x, 0, z],
        localPosition: [x, 0, z],
        nativeEvent: {} as never,
      } as never)
      emitter.emit('grid:click', {
        position: [x, 0, z],
        localPosition: [x, 0, z],
        nativeEvent: {} as never,
      } as never)
    }

    expect(committedPositions.length).toBe(5)
    expect(committedPositions).toEqual([
      [0, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
      [6, 0, 0],
      [8, 0, 0],
    ])

    unsubscribeMove()
    unsubscribeClicks()
  })

  test('rapid duplicate clicks at identical coordinates within 200ms window are suppressed (double-click safety)', () => {
    const committedPositions: Array<[number, number, number]> = []
    let lastPosition: [number, number, number] = [5, 0, 5]

    const unsubscribeMove = subscribeGridMove((pos) => {
      lastPosition = pos
    })
    const unsubscribeClicks = subscribePlacementClicks(() => {
      committedPositions.push([...lastPosition])
    })

    // First click at (5, 0, 5)
    emitter.emit('grid:move', {
      position: [5, 0, 5],
      localPosition: [5, 0, 5],
      nativeEvent: {} as never,
    } as never)
    emitter.emit('grid:click', {
      position: [5, 0, 5],
      localPosition: [5, 0, 5],
      nativeEvent: {} as never,
    } as never)

    // Immediate second click at exact same (5, 0, 5) (within 200ms)
    emitter.emit('grid:click', {
      position: [5, 0, 5],
      localPosition: [5, 0, 5],
      nativeEvent: {} as never,
    } as never)

    expect(committedPositions.length).toBe(1)
    expect(committedPositions[0]).toEqual([5, 0, 5])

    unsubscribeMove()
    unsubscribeClicks()
  })

  /**
   * The shape that actually shipped: one click over a conveyor placed two
   * stacked conveyors.
   *
   * The test above emits the pair as two `grid:click`s at the SAME point, which
   * is the double-click case — and the position test in the guard already
   * caught that. The real pair never agrees on position: the node click is
   * raycast against the module's own collider and the grid click against the
   * ground plane, so a module standing 0.8 m tall reports XZ the better part of
   * a metre away. That is why a guard keyed on position let the second commit
   * through, and why this case needs its own test.
   */
  test('a node-surface click and the browser click that follows it commit once, though their positions differ', async () => {
    // The duplicate guard keeps module-level state across tests. Let its
    // window lapse first, or this test's opening click is collapsed as the
    // previous test's double-click and the assertion passes for a false reason.
    await new Promise((resolve) => setTimeout(resolve, 250))

    const commits: Array<[number, number, number]> = []
    let lastPosition: [number, number, number] = [5, 0, 5]

    const unsubscribeMove = subscribeGridMove((pos) => {
      lastPosition = pos
    })
    const unsubscribeClicks = subscribePlacementClicks(() => {
      commits.push([...lastPosition])
    })

    try {
      emitter.emit('grid:move', {
        position: [5, 0, 5],
        localPosition: [5, 0, 5],
        nativeEvent: {} as never,
      } as never)

      // 1. The node synthesizes its own click on pointerup, hit against the
      //    module's collider — a different surface, so a different point.
      emitter.emit('warehouse:conveyor-roller:click' as never, {
        position: [5.62, 0.82, 5.41],
        localPosition: [5.62, 0.82, 5.41],
        nativeEvent: {} as never,
      } as never)

      // 2. The browser's real click reaches the canvas listener a frame later,
      //    hit against the ground plane.
      emitter.emit('grid:click', {
        position: [5, 0, 5],
        localPosition: [5, 0, 5],
        nativeEvent: {} as never,
      } as never)

      expect(commits.length).toBe(1)
    } finally {
      // In a `finally` because the guard's state is module-level: a throw that
      // skipped these would leave this handler subscribed, and the next test's
      // events would then pass through the shared guard twice and be collapsed.
      unsubscribeMove()
      unsubscribeClicks()
    }
  })

  /**
   * The guard must not become a blanket "swallow every grid click that follows
   * a node click" — a real second placement has to survive.
   */
  test('a grid click well after a node click is a second placement, not a follow-up', async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))

    const commits: Array<[number, number, number]> = []
    let lastPosition: [number, number, number] = [40, 0, 40]

    const unsubscribeMove = subscribeGridMove((pos) => {
      lastPosition = pos
    })
    const unsubscribeClicks = subscribePlacementClicks(() => {
      commits.push([...lastPosition])
    })

    // Coordinates deliberately far from the test above: the duplicate guard
    // keeps module-level state, so reusing a point within its 200 ms window
    // would collapse this test's opening click as that test's double-click.
    try {
      emitter.emit('grid:move', {
        position: [40, 0, 40],
        localPosition: [40, 0, 40],
        nativeEvent: {} as never,
      } as never)
      emitter.emit('warehouse:conveyor-roller:click' as never, {
        position: [40.62, 0.82, 40.41],
        localPosition: [40.62, 0.82, 40.41],
        nativeEvent: {} as never,
      } as never)

      // Past the same-gesture allowance, and somewhere else entirely.
      await new Promise((resolve) => setTimeout(resolve, 90))

      emitter.emit('grid:move', {
        position: [12, 0, 3],
        localPosition: [12, 0, 3],
        nativeEvent: {} as never,
      } as never)
      emitter.emit('grid:click', {
        position: [12, 0, 3],
        localPosition: [12, 0, 3],
        nativeEvent: {} as never,
      } as never)

      expect(commits.length).toBe(2)
    } finally {
      unsubscribeMove()
      unsubscribeClicks()
    }
  })
})

describe('Adversarial Challenge 5: Immediate 2D FloorplanRegistry Rendering without Unmounting/View Switching', () => {
  const pluginDefs = new Map(
    (warehousePlugin.nodes ?? []).map((def) => [(def as { kind: string }).kind, def]),
  )

  // Simulate 2D FloorplanRegistryLayer DFS collector
  function simulateFloorplanRegistryDFS(
    nodes: Record<string, unknown>,
    resolvedLevelId: string,
  ): string[] {
    const visitedIds: string[] = []
    const visit = (id: string) => {
      const node = nodes[id] as { type?: string; children?: string[] } | undefined
      if (!node || typeof node.type !== 'string') return
      const def = pluginDefs.get(node.type) as { floorplan?: unknown } | undefined
      if (def?.floorplan || node.type === 'level') {
        visitedIds.push(id)
      }
      const childIds = node.children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) visit(cid)
      }
    }
    visit(resolvedLevelId)
    return visitedIds
  }

  test('all 21 warehouse node types receive ambient Level 0 parentId and appear in 2D Floorplan DFS immediately', () => {
    const initialScene: Record<string, unknown> = {
      'bldg-main': {
        id: 'bldg-main',
        type: 'building',
        object: 'node',
        children: ['lvl-main-0'],
      },
      'lvl-main-0': {
        id: 'lvl-main-0',
        type: 'level',
        object: 'node',
        level: 0,
        parentId: 'bldg-main',
        children: [],
      },
    }

    const selection = { levelId: null, buildingId: 'bldg-main' }
    const activeLevelId = resolveActiveLevelId(initialScene, selection)
    expect(activeLevelId).toBe('lvl-main-0')

    const currentNodes: Record<string, unknown> = { ...initialScene }
    const level0 = { ...(currentNodes['lvl-main-0'] as { children: string[] }) }
    currentNodes['lvl-main-0'] = level0
    level0.children = []

    const registeredKinds = (warehousePlugin.nodes ?? []).map((n) => (n as { kind: string }).kind)
    expect(registeredKinds.length).toBe(21)

    // For each registered kind, instantiate and commit to level0
    for (let i = 0; i < registeredKinds.length; i++) {
      const kind = registeredKinds[i]
      if (!kind) continue
      const nodeId = `item_${i}_${kind.replace(':', '_')}`
      const newNode = {
        id: nodeId,
        type: kind,
        object: 'node',
        position: [i * 2, 0, 0],
        rotation: [0, 0, 0],
        parentId: activeLevelId,
        metadata: {},
        visible: true,
      }

      currentNodes[nodeId] = newNode
      level0.children = [...level0.children, nodeId]

      // Verify that after this commit, the DFS immediately finds this node without switching view modes
      const visited = simulateFloorplanRegistryDFS(currentNodes, activeLevelId!)
      expect(visited).toContain(nodeId)
    }

    // Verify all 21 items + level-main-0 are in visited list
    const finalVisited = simulateFloorplanRegistryDFS(currentNodes, activeLevelId!)
    expect(finalVisited.length).toBe(22) // 1 level + 21 equipment items
  })

  test('ephemeral 2D placement preview updates without modifying scene nodes', () => {
    const activeLevelNode = {
      id: 'lvl-test-0',
      type: 'level',
      object: 'node',
      level: 0,
    } as unknown as AnyNode

    const ghostPallet = {
      id: 'ghost_pallet_1',
      type: 'warehouse:pallet',
      object: 'node',
      position: [12.5, 0, 8.2],
      rotation: [0, Math.PI / 2, 0],
      parentId: 'lvl-test-0',
    } as unknown as AnyNode

    publishPlacementPreview(ghostPallet, activeLevelNode)

    const previewState = usePlacementPreview.getState()
    expect(previewState.node).toEqual(ghostPallet)
    expect(previewState.parentNode).toEqual(activeLevelNode)

    clearPlacementPreview()
    expect(usePlacementPreview.getState().node).toBeNull()
    expect(usePlacementPreview.getState().parentNode).toBeNull()
  })
})
