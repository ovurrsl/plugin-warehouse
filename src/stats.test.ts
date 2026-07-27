import { beforeEach, describe, expect, test } from 'bun:test'
import { PalletRackNode } from './rack/schema'
import { resetStatsIndex, resolveStatsScope, sceneStats, statsReport } from './stats'

/**
 * A scene, as the host's node map: a plain record keyed by id, with parents
 * naming their children. Built by hand rather than through the host's store,
 * because the point of the index is that it reads an untrusted map — including
 * the shapes a hand-edited file can produce.
 */
type Scene = Record<string, unknown>

const level = (id: string, children: string[], patch: Record<string, unknown> = {}) => ({
  id,
  type: 'level',
  children,
  level: 0,
  ...patch,
})

const slab = (id: string, size: number, patch: Record<string, unknown> = {}) => ({
  id,
  type: 'slab',
  polygon: [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ],
  holes: [],
  ...patch,
})

const rack = (id: string, patch: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id, ...patch })

const scene = (...nodes: ({ id: string } & Record<string, unknown>)[]): Scene =>
  Object.fromEntries(nodes.map((node) => [node.id, node]))

const reportFor = (nodes: Scene) => {
  const stats = sceneStats(nodes)
  return statsReport(
    stats,
    stats.levels.map((entry) => entry.id),
    null,
  )
}

const codes = (nodes: Scene) => reportFor(nodes).qualifications.map((entry) => entry.code)

beforeEach(() => {
  resetStatsIndex()
})

describe('storage and picking are different units and are never added', () => {
  test('the canonical bay reports twelve pallet positions', () => {
    // Three levels plus the floor, three pallets across on a 2.7 m clear bay.
    // Catches any regression to a multiplied-out `levels × palletsPerLevel`,
    // which would count the levels the upright cannot actually fit.
    const report = reportFor(scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1')))
    expect(report.palletPositions).toBe(12)
    expect(report.directPositions).toBe(12)
    expect(report.containerPositions).toBe(0)
    expect(report.rackCount).toBe(1)
  })

  test('a double-deep bay doubles the positions and not the reachable ones', () => {
    const report = reportFor(
      scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1', { depthPositions: 2 })),
    )
    expect(report.palletPositions).toBe(24)
    expect(report.directPositions).toBe(12)
  })

  test('picking is eight, not ninety', () => {
    // **The most important assertion in this file.** The version this replaces
    // computed picking positions as `palletsPerLevel × 6 × round(loadHeight /
    // 0.33)` — two invented constants applied to a PALLET count and printed as
    // picking locations. The honest figure is the box grid that actually fits:
    // `pickingBoxesAcross × pickingBoxesDeep`.
    const nodes = scene(
      level('level_1', ['pallet_rack_1']),
      rack('pallet_rack_1', { pickingLevels: 1 }),
    )
    const report = reportFor(nodes)
    expect(report.containerPositions).toBe(8)
    expect(report.containerPositions).not.toBe(3 * 6 * Math.round(1.75 / 0.33))
  })

  test('a picking level stops being a pallet level', () => {
    // Proves the split is a partition rather than an addition: the ground level
    // moved from one figure to the other, it did not appear in both.
    const report = reportFor(
      scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1', { pickingLevels: 1 })),
    )
    expect(report.palletPositions).toBe(9)
    expect(report.containerPositions).toBe(8)
  })

  test('no field of the report is the two added together', () => {
    const report = reportFor(
      scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1', { pickingLevels: 1 })),
    )
    const sum = report.palletPositions + report.containerPositions
    for (const value of Object.values(report)) {
      if (typeof value === 'number') expect(value).not.toBe(sum)
    }
  })

  test('each figure ignores the other’s dimensions', () => {
    const base = reportFor(
      scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1', { pickingLevels: 1 })),
    )
    resetStatsIndex()
    const widerBoxes = reportFor(
      scene(
        level('level_1', ['pallet_rack_1']),
        rack('pallet_rack_1', { pickingLevels: 1, pickingBoxWidth: 0.3 }),
      ),
    )
    expect(widerBoxes.palletPositions).toBe(base.palletPositions)
    expect(widerBoxes.containerPositions).not.toBe(base.containerPositions)
  })
})

describe('a bay reports what it holds, not what it was asked for', () => {
  test('a tunnel removes its levels and says how many', () => {
    const nodes = scene(
      level('level_1', ['pallet_rack_1']),
      rack('pallet_rack_1', { tunnelLevels: 1 }),
    )
    const report = reportFor(nodes)
    expect(report.palletPositions).toBe(9)
    const tunnel = report.qualifications.find((entry) => entry.code === 'tunnelled-bay')
    expect(tunnel?.count).toBe(1)
    // Closed form, so this also catches the expression drifting from what
    // `storageLevelsPresent` actually drops.
    expect(tunnel?.amount).toBe(3)
  })

  test('levels that do not fit the upright are never counted', () => {
    const ten = reportFor(
      scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1', { levels: 10 })),
    )
    resetStatsIndex()
    const three = reportFor(
      scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1', { levels: 3 })),
    )
    expect(ten.palletPositions).toBe(three.palletPositions)
  })

  test('a rack that cannot be parsed counts as nothing and says so', () => {
    // The exact failure the typed schema exists to prevent: the version this
    // replaces read `metadata.bayCount ?? 1` from an untyped blob, so a
    // hand-edited file cascaded into NaN with no complaint.
    const broken = { id: 'pallet_rack_1', type: 'warehouse:pallet-rack', bayClearWidth: 'wide' }
    const report = reportFor(scene(level('level_1', ['pallet_rack_1']), broken))
    expect(report.palletPositions).toBe(0)
    expect(report.rackCount).toBe(1)
    expect(report.qualifications.map((entry) => entry.code)).toContain('racks-unreadable')
    expect(report.status.storage).toBe('unavailable')
    for (const value of Object.values(report)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('area is measured, and refused when it cannot be', () => {
  test('a hole is deducted', () => {
    const withHole = slab('slab_1', 10, {
      holes: [
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 4],
        ],
      ],
    })
    const report = reportFor(scene(level('level_1', ['slab_1']), withHole))
    expect(report.area).toBeCloseTo(96, 6)
    expect(report.slabs[0]?.gross).toBeCloseTo(100, 6)
  })

  test('a self-crossing outline is withheld, not summed as zero', () => {
    // A symmetric bow-tie's shoelace is exactly 0 — a number that looks like an
    // area, sums like an area, and is not one.
    const bowTie = {
      id: 'slab_2',
      type: 'slab',
      polygon: [
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ],
      holes: [],
    }
    const nodes = scene(level('level_1', ['slab_1', 'slab_2']), slab('slab_1', 10), bowTie)
    const report = reportFor(nodes)
    expect(report.area).toBeCloseTo(100, 6)
    expect(report.qualifications.map((entry) => entry.code)).toContain('slab-self-intersecting')
    expect(report.slabs.find((entry) => entry.id === 'slab_2')?.selfIntersecting).toBe(true)
  })

  test('a mezzanine is summed and named rather than silently doubling the floor', () => {
    const nodes = scene(
      level('level_1', ['slab_1', 'slab_2']),
      slab('slab_1', 10, { elevation: 0.05 }),
      slab('slab_2', 6, { elevation: 3.2 }),
    )
    const report = reportFor(nodes)
    expect(report.area).toBeCloseTo(136, 6)
    const bands = report.qualifications.find((entry) => entry.code === 'elevation-bands')
    expect(bands?.count).toBe(2)
    expect(bands?.amount).toBeCloseTo(36, 6)
  })

  test('a slab with no elevation still counts and forms its own band', () => {
    // A host that renames the field must lose the qualifier, not the area.
    const report = reportFor(scene(level('level_1', ['slab_1']), slab('slab_1', 10)))
    expect(report.area).toBeCloseTo(100, 6)
    expect(report.slabs[0]?.elevation).toBeUndefined()
  })

  test('an unreadable outline is excluded and distinguishable from a real zero', () => {
    const twoPoints = {
      id: 'slab_1',
      type: 'slab',
      polygon: [
        [0, 0],
        [1, 1],
      ],
      holes: [],
    }
    const report = reportFor(scene(level('level_1', ['slab_1']), twoPoints))
    expect(report.slabs).toHaveLength(0)
    expect(report.qualifications.map((entry) => entry.code)).toContain('slabs-unreadable')
    expect(report.status.footprint).toBe('unavailable')
  })
})

describe('the slab filter distinguishes all from none', () => {
  const nodes = () =>
    scene(level('level_1', ['slab_1', 'slab_2']), slab('slab_1', 10), slab('slab_2', 4))

  test('null sums every slab, a set sums its own, and an empty set sums none', () => {
    // The version this replaces overloaded `null` to mean both "all" and
    // "none", so unticking every slab showed every slab.
    const stats = sceneStats(nodes())
    const ids = stats.levels.map((entry) => entry.id)
    expect(statsReport(stats, ids, null).area).toBeCloseTo(116, 6)
    expect(statsReport(stats, ids, new Set(['slab_2'])).area).toBeCloseTo(16, 6)
    expect(statsReport(stats, ids, new Set<string>()).area).toBeCloseTo(0, 6)
  })

  test('the unfiltered total stays available beside the filtered one', () => {
    const stats = sceneStats(nodes())
    const report = statsReport(
      stats,
      stats.levels.map((entry) => entry.id),
      new Set(['slab_2']),
    )
    expect(report.area).toBeCloseTo(16, 6)
    expect(report.areaAllSlabs).toBeCloseTo(116, 6)
  })
})

describe('scope drives every figure, not just one of them', () => {
  const twoLevels = () =>
    scene(
      { id: 'building_1', type: 'building', children: ['level_1', 'level_2'] },
      level('level_1', ['pallet_rack_1', 'slab_1'], { level: 0, name: 'Ground' }),
      level('level_2', ['pallet_rack_2', 'slab_2'], { level: 1, name: 'First' }),
      rack('pallet_rack_1'),
      rack('pallet_rack_2'),
      slab('slab_1', 10),
      slab('slab_2', 4),
    )

  test('one level in scope excludes its sibling’s racks AND its slabs', () => {
    // This is the reference screen's actual defect, written as a test: it
    // printed a building-wide pallet total beside a single level's area.
    const stats = sceneStats(twoLevels())
    const report = statsReport(stats, ['level_1'], null)
    expect(report.palletPositions).toBe(12)
    expect(report.area).toBeCloseTo(100, 6)
  })

  test('a building scope with no building resolves to the project and says so', () => {
    const stats = sceneStats(twoLevels())
    const resolution = resolveStatsScope(stats, {
      scope: 'building',
      buildingId: null,
      levelId: null,
    })
    expect(resolution.resolved).toBe('project')
    expect(resolution.levelIds).toHaveLength(2)
    expect(resolution.widenedNote).not.toBeNull()
  })

  test('a level that no longer exists cascades rather than emptying', () => {
    const stats = sceneStats(twoLevels())
    const resolution = resolveStatsScope(stats, {
      scope: 'level',
      buildingId: 'building_1',
      levelId: 'level_gone',
    })
    expect(resolution.resolved).toBe('building')
    expect(resolution.levelIds).toHaveLength(2)
    expect(resolution.widenedNote).not.toBeNull()
  })

  test('two buildings’ ground floors stay two rows', () => {
    const nodes = {
      ...twoLevels(),
      building_2: { id: 'building_2', type: 'building', children: ['level_3'] },
      level_3: level('level_3', [], { level: 0, name: 'Ground' }),
    }
    const stats = sceneStats(nodes)
    const resolution = resolveStatsScope(stats, {
      scope: 'project',
      buildingId: null,
      levelId: null,
    })
    expect(resolution.levelChoices).toHaveLength(3)
    expect(new Set(resolution.levelChoices.map((entry) => entry.label)).size).toBe(3)
  })
})

describe('what is counted, and what is deliberately not', () => {
  test('a rack nested under a group is still on its level', () => {
    // The exact bug `walkSubtree` was written for: counting only a level's
    // direct children made a grouped run contribute nothing to its own figure.
    const nodes = scene(
      level('level_1', ['group_1']),
      { id: 'group_1', type: 'group', children: ['pallet_rack_1'] },
      rack('pallet_rack_1'),
    )
    expect(reportFor(nodes).palletPositions).toBe(12)
  })

  test('a rack under no level is counted nowhere, and that is said out loud', () => {
    const nodes = scene(level('level_1', []), rack('pallet_rack_1'))
    const report = reportFor(nodes)
    expect(report.palletPositions).toBe(0)
    expect(report.qualifications.map((entry) => entry.code)).toContain('nodes-outside-levels')
  })

  test('goods are not locations', () => {
    // A pallet standing in a bay is stock, not a position. Nothing here infers
    // occupancy from geometry, so it changes no headline — and the screen says
    // so rather than leaving the user to wonder.
    const nodes = scene(
      level('level_1', ['pallet_rack_1', 'pallet_1', 'conveyor_1']),
      rack('pallet_rack_1'),
      { id: 'pallet_1', type: 'warehouse:pallet' },
      { id: 'conveyor_1', type: 'warehouse:conveyor-roller' },
    )
    const report = reportFor(nodes)
    expect(report.palletPositions).toBe(12)
    expect(report.containerPositions).toBe(0)
    expect(report.qualifications.map((entry) => entry.code)).toContain('floor-pallets')
    expect(sceneStats(nodes).placed).toBe(3)
  })

  test('ghost stock is scenery and enters no count', () => {
    const withGhosts = scene(
      level('level_1', ['pallet_rack_1']),
      rack('pallet_rack_1', { ghostFill: 1 }),
    )
    const ghostReport = reportFor(withGhosts)
    resetStatsIndex()
    const plain = reportFor(scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1')))
    expect(ghostReport.palletPositions).toBe(plain.palletPositions)
    expect(ghostReport.qualifications.map((entry) => entry.code)).toContain('ghost-fill')
  })

  test('a hidden rack still holds pallets', () => {
    // Hiding is a view setting. A designer who hid a run and saw the figure
    // unchanged should be told why rather than left to guess.
    const nodes = scene(level('level_1', ['pallet_rack_1']), {
      ...rack('pallet_rack_1'),
      visible: false,
    })
    const report = reportFor(nodes)
    expect(report.palletPositions).toBe(12)
    expect(report.qualifications.map((entry) => entry.code)).toContain('hidden-nodes')
  })

  test('supportSlabId never changes a figure', () => {
    // The host strips it on the first drag and copy-paste inherits it verbatim,
    // so a count scoped by it would decay silently.
    const variants = [undefined, null, 'ground', 'slab_gone']
    const counts = variants.map((value) => {
      resetStatsIndex()
      return reportFor(
        scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1', { supportSlabId: value })),
      ).palletPositions
    })
    expect(new Set(counts).size).toBe(1)
    expect(counts[0]).toBe(12)
  })
})

describe('occupancy is a fact a pallet carries, never one inferred', () => {
  test('a pallet in a slot fills a position and is not a floor pallet', () => {
    const nodes = scene(level('level_1', ['pallet_rack_1', 'pallet_1']), rack('pallet_rack_1'), {
      id: 'pallet_1',
      type: 'warehouse:pallet',
      slotRackId: 'pallet_rack_1',
      slotAddress: 'R1-B1-L0-P1-D1',
    })
    const report = reportFor(nodes)
    expect(report.palletPositions).toBe(12)
    expect(report.occupiedPositions).toBe(1)
    expect(report.qualifications.map((entry) => entry.code)).not.toContain('floor-pallets')
  })

  test('a pallet standing on the floor fills nothing', () => {
    // Nothing tests a pallet's position against a rack's box: a pallet visually
    // inside a bay is not in that bay unless the placement chain put it there
    // and wrote the address down.
    const nodes = scene(level('level_1', ['pallet_rack_1', 'pallet_1']), rack('pallet_rack_1'), {
      id: 'pallet_1',
      type: 'warehouse:pallet',
      position: [0, 0, 0],
    })
    const report = reportFor(nodes)
    expect(report.occupiedPositions).toBe(0)
    expect(report.qualifications.map((entry) => entry.code)).toContain('floor-pallets')
  })

  test('a claim on a rack that is gone counts as a pallet on the floor', () => {
    // The honest reading of a stale address: the pallet is real and it is not in
    // a rack. Counting it against a bay that no longer exists would report a
    // warehouse fuller than it is.
    const nodes = scene(level('level_1', ['pallet_1']), {
      id: 'pallet_1',
      type: 'warehouse:pallet',
      slotRackId: 'pallet_rack_gone',
      slotAddress: 'R1-B1-L0-P1-D1',
    })
    const report = reportFor(nodes)
    expect(report.occupiedPositions).toBe(0)
    expect(report.qualifications.map((entry) => entry.code)).toContain('floor-pallets')
  })

  test('occupancy never exceeds the positions on the same level', () => {
    const nodes = scene(level('level_1', ['pallet_rack_1', 'pallet_1']), rack('pallet_rack_1'), {
      id: 'pallet_1',
      type: 'warehouse:pallet',
      slotRackId: 'pallet_rack_1',
      slotAddress: 'R1-B1-L0-P1-D1',
    })
    const report = reportFor(nodes)
    expect(report.occupiedPositions).toBeLessThanOrEqual(report.palletPositions)
  })
})

describe('the index is built once per store write', () => {
  test('the same node map returns the identical object', () => {
    // What lets the panel subscribe with a plain selector: `Object.is` on the
    // result, so an unrelated write does not re-render the tab.
    const nodes = scene(level('level_1', ['pallet_rack_1']), rack('pallet_rack_1'))
    expect(sceneStats(nodes)).toBe(sceneStats(nodes))
  })

  test('a fresh map reuses every unchanged rack and slab', () => {
    const rackNode = rack('pallet_rack_1')
    const slabNode = slab('slab_1', 10)
    const first = sceneStats(
      scene(level('level_1', ['pallet_rack_1', 'slab_1']), rackNode, slabNode),
    )
    const second = sceneStats(
      scene(level('level_1', ['pallet_rack_1', 'slab_1']), rackNode, slabNode),
    )
    expect(second).not.toBe(first)
    // Same figures from the per-node memos rather than a re-enumeration: the
    // difference between twelve slot allocations on a rack nudge and
    // twenty-four thousand.
    expect(second.levels[0]?.palletPositions).toBe(first.levels[0]?.palletPositions)
    expect(second.levels[0]?.slabs[0]?.area).toBe(first.levels[0]?.slabs[0]?.area)
  })
})

describe('a hostile scene produces a report rather than an exception', () => {
  test('cycles, wrong types and missing nodes are all survivable', () => {
    // Throwing here replaces the whole Warehouse panel with the host's crash
    // fallback for the rest of the session.
    const nodes: Scene = {
      level_1: level('level_1', ['group_1', 'slab_1', 'missing_1']),
      group_1: { id: 'group_1', type: 'group', children: ['level_1', 'pallet_rack_1'] },
      pallet_rack_1: rack('pallet_rack_1'),
      slab_1: { id: 'slab_1', type: 'slab', polygon: 'not a ring', holes: [] },
      level_2: level('level_2', [42 as unknown as string], { level: 'ground' }),
      building_1: { id: 'building_1', type: 'building', children: ['wall_1'] },
    }
    const report = reportFor(nodes)
    expect(report.palletPositions).toBe(12)
    expect(codes(nodes)).toContain('slabs-unreadable')
    expect(sceneStats(nodes).levels).toHaveLength(2)
  })
})
