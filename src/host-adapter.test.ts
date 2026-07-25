import { describe, expect, test } from 'bun:test'
import {
  asBuilding,
  asLevel,
  asSlab,
  levelsOfBuilding,
  pointInRing,
  pointInSlab,
  ringArea,
  slabArea,
  slabAt,
  slabsOfLevel,
  walkSubtree,
} from './host-adapter'

const squareSlab = {
  id: 'slab-1',
  type: 'slab',
  polygon: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
}

describe('asSlab', () => {
  test('narrows a well-formed slab', () => {
    const slab = asSlab(squareSlab)
    expect(slab).not.toBeNull()
    expect(slab?.id).toBe('slab-1')
    expect(slab?.polygon).toHaveLength(4)
    expect(slab?.holes).toEqual([])
  })

  test('reads holes when present', () => {
    const slab = asSlab({
      ...squareSlab,
      holes: [
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 4],
        ],
      ],
    })
    expect(slab?.holes).toHaveLength(1)
  })

  // The guards exist so a host schema change degrades the readout to "no data"
  // instead of throwing. Each case below is a shape a future host could ship.
  test.each([
    ['null', null],
    ['a non-object', 'slab'],
    ['a different kind', { id: 'w', type: 'wall', polygon: squareSlab.polygon }],
    ['a missing polygon', { id: 's', type: 'slab' }],
    ['a renamed polygon field', { id: 's', type: 'slab', outline: squareSlab.polygon }],
    [
      'a degenerate polygon',
      {
        id: 's',
        type: 'slab',
        polygon: [
          [0, 0],
          [1, 1],
        ],
      },
    ],
    [
      'non-numeric coordinates',
      {
        id: 's',
        type: 'slab',
        polygon: [
          ['a', 0],
          [1, 1],
          [2, 2],
        ],
      },
    ],
    ['a point-object polygon', { id: 's', type: 'slab', polygon: [{ x: 0, z: 0 }] }],
    [
      'a non-finite coordinate',
      {
        id: 's',
        type: 'slab',
        polygon: [
          [Number.NaN, 0],
          [1, 1],
          [2, 2],
        ],
      },
    ],
  ])('returns null for %s', (_label, input) => {
    expect(asSlab(input)).toBeNull()
  })

  test('drops malformed holes but keeps a usable outline', () => {
    const slab = asSlab({
      ...squareSlab,
      holes: [
        [[0, 0]],
        'nope',
        [
          [1, 1],
          [2, 2],
          [3, 3],
        ],
      ],
    })
    expect(slab).not.toBeNull()
    expect(slab?.holes).toHaveLength(1)
  })
})

describe('asLevel / asBuilding', () => {
  test('reads children and ordering key', () => {
    const level = asLevel({
      id: 'l1',
      type: 'level',
      level: 2,
      children: ['a', 'b'],
      name: 'First',
    })
    expect(level?.children).toEqual(['a', 'b'])
    expect(level?.level).toBe(2)
    expect(level?.name).toBe('First')
  })

  test('defaults a missing level index rather than failing', () => {
    expect(asLevel({ id: 'l1', type: 'level' })?.level).toBe(0)
  })

  test('filters non-string child ids', () => {
    const level = asLevel({ id: 'l1', type: 'level', children: ['a', 42, null, 'b'] })
    expect(level?.children).toEqual(['a', 'b'])
  })

  test('rejects the wrong kind', () => {
    expect(asLevel({ id: 'b1', type: 'building' })).toBeNull()
    expect(asBuilding({ id: 'l1', type: 'level' })).toBeNull()
  })
})

describe('ringArea / slabArea', () => {
  test('computes a square', () => {
    expect(ringArea(squareSlab.polygon as [number, number][])).toBe(100)
  })

  test('is winding-order agnostic', () => {
    const reversed = [...squareSlab.polygon].reverse() as [number, number][]
    expect(ringArea(reversed)).toBe(100)
  })

  test('subtracts holes', () => {
    const slab = asSlab({
      ...squareSlab,
      holes: [
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 4],
        ],
      ],
    })
    expect(slab && slabArea(slab)).toBe(96)
  })

  test('never returns a negative area when holes exceed the outline', () => {
    const slab = asSlab({
      id: 's',
      type: 'slab',
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      holes: [
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
      ],
    })
    expect(slab && slabArea(slab)).toBe(0)
  })
})

describe('pointInRing / pointInSlab', () => {
  test('detects inside and outside', () => {
    const ring = squareSlab.polygon as [number, number][]
    expect(pointInRing(ring, 5, 5)).toBe(true)
    expect(pointInRing(ring, 15, 5)).toBe(false)
    expect(pointInRing(ring, -1, 5)).toBe(false)
  })

  test('treats a hole as outside', () => {
    const slab = asSlab({
      ...squareSlab,
      holes: [
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 4],
        ],
      ],
    })
    expect(slab && pointInSlab(slab, 3, 3)).toBe(false)
    expect(slab && pointInSlab(slab, 7, 7)).toBe(true)
  })
})

describe('slabAt', () => {
  test('elects the smallest containing slab so a nested slab wins over its container', () => {
    const outer = asSlab(squareSlab)
    const inner = asSlab({
      id: 'slab-inner',
      type: 'slab',
      polygon: [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
      ],
    })
    expect(outer && inner && slabAt([outer, inner], 5, 5)?.id).toBe('slab-inner')
    expect(outer && inner && slabAt([outer, inner], 1, 1)?.id).toBe('slab-1')
    expect(outer && inner && slabAt([outer, inner], 50, 50)).toBeNull()
  })
})

describe('walkSubtree', () => {
  const nodes: Record<string, unknown> = {
    b1: { id: 'b1', type: 'building', children: ['l1'] },
    l1: { id: 'l1', type: 'level', children: ['g1', 'r1'] },
    g1: { id: 'g1', type: 'group', children: ['r2'] },
    r1: { id: 'r1', type: 'warehouse:pallet-rack' },
    // Nested one level deeper than the fork's single-level scan reached.
    r2: { id: 'r2', type: 'warehouse:pallet-rack' },
  }

  test('reaches nested descendants, not just direct children', () => {
    const seen: string[] = []
    walkSubtree(nodes, 'b1', (_node, id) => seen.push(id))
    expect(seen.sort()).toEqual(['b1', 'g1', 'l1', 'r1', 'r2'])
  })

  test('terminates on a cyclic graph', () => {
    const cyclic: Record<string, unknown> = {
      a: { id: 'a', children: ['b'] },
      b: { id: 'b', children: ['a'] },
    }
    const seen: string[] = []
    walkSubtree(cyclic, 'a', (_node, id) => seen.push(id))
    expect(seen.sort()).toEqual(['a', 'b'])
  })

  test('skips ids with no node', () => {
    const seen: string[] = []
    walkSubtree({ a: { id: 'a', children: ['ghost'] } }, 'a', (_node, id) => seen.push(id))
    expect(seen).toEqual(['a'])
  })
})

describe('levelsOfBuilding / slabsOfLevel', () => {
  const nodes: Record<string, unknown> = {
    b1: { id: 'b1', type: 'building', children: ['l2', 'l1'] },
    l1: { id: 'l1', type: 'level', level: 0, children: ['s1'] },
    l2: { id: 'l2', type: 'level', level: 1, children: [] },
    s1: squareSlab,
  }

  test('orders levels bottom to top regardless of child order', () => {
    expect(levelsOfBuilding(nodes, 'b1').map((l) => l.id)).toEqual(['l1', 'l2'])
  })

  test('returns empty for a missing or null building', () => {
    expect(levelsOfBuilding(nodes, null)).toEqual([])
    expect(levelsOfBuilding(nodes, 'nope')).toEqual([])
  })

  test('collects slabs on a level', () => {
    const level = levelsOfBuilding(nodes, 'b1')[0]
    expect(level && slabsOfLevel(nodes, level).map((s) => s.id)).toEqual(['slab-1'])
  })
})
