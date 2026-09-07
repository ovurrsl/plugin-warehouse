import { describe, expect, test } from 'bun:test'
import { DEPTH_BIAS, ROUTE_ELEVATIONS } from '../route/constants'
import { crosswalkDefinition } from './definition'
import { buildCrosswalkFloorplan } from './floorplan'
import { crosswalkParametrics } from './parametrics'
import { CrosswalkNode } from './schema'

describe('Crosswalk Feature Suite', () => {
  test('CrosswalkNode parses default values correctly', () => {
    const node = CrosswalkNode.parse({})
    expect(node.type).toBe('warehouse:crosswalk')
    expect(node.width).toBe(3.5)
    expect(node.length).toBe(2.5)
    expect(node.stripeCount).toBe(6)
    expect(node.stripeColor).toBe('#ffffff')
    expect(node.routeId).toBeNull()
    expect(node.t).toBe(0.5)
  })

  test('CrosswalkNode validates custom dimensions and colors', () => {
    const custom = CrosswalkNode.parse({
      width: 5.0,
      length: 3.0,
      stripeCount: 8,
      stripeColor: '#facc15',
      routeId: 'route-123',
      t: 0.75,
    })
    expect(custom.width).toBe(5.0)
    expect(custom.length).toBe(3.0)
    expect(custom.stripeCount).toBe(8)
    expect(custom.stripeColor).toBe('#facc15')
    expect(custom.routeId).toBe('route-123')
    expect(custom.t).toBe(0.75)
  })

  test('crosswalkDefinition declares proper capabilities and floorplan', () => {
    expect(crosswalkDefinition.kind).toBe('warehouse:crosswalk')
    expect(crosswalkDefinition.capabilities.deletable).toBe(true)
    expect(crosswalkDefinition.capabilities.movable).toBeDefined()
    expect(crosswalkDefinition.capabilities.rotatable).toBeDefined()

    const node = CrosswalkNode.parse({ width: 4.0, length: 2.0 })
    const fp = buildCrosswalkFloorplan(node, {} as any)
    expect(fp).not.toBeNull()
    expect(fp?.kind).toBe('group')
    if (fp?.kind === 'group') {
      expect(fp.children.length).toBe(6)
      expect(fp.children[0]?.kind).toBe('polygon')
    }
  })

  test('crosswalkParametrics exposes width, length, stripeCount, stripeColor', () => {
    const group = crosswalkParametrics.groups[0]
    expect(group).toBeDefined()
    const keys = group!.fields.map((f) => f.key)
    expect(keys).toContain('width')
    expect(keys).toContain('length')
    expect(keys).toContain('stripeCount')
    expect(keys).toContain('stripeColor')
  })

  test('Zebra elevation and depth bias constants match monotonic requirements', () => {
    expect(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK).toBe(0.016)
    expect(DEPTH_BIAS.ZEBRA.polygonOffsetFactor).toBe(-4)
    expect(DEPTH_BIAS.ZEBRA.renderOrder).toBe(10)
  })
})
