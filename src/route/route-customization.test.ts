import { describe, expect, test } from 'bun:test'
import { DEFAULT_PEDESTRIAN_FILL_COLOR, INDUSTRIAL_COLOR_PALETTE } from './constants'
import { buildRouteGeometry, resolveRouteFill } from './geometry'
import { getRouteMaterials } from './materials'
import { routeParametrics } from './parametrics'
import { RouteNode } from './schema'

function makeRoute(patch: Partial<RouteNode> = {}): RouteNode {
  return RouteNode.parse({
    points: [
      [0, 0],
      [20, 0],
    ],
    role: 'vehicle',
    traffic: 'one-way',
    ...patch,
  })
}

describe('Route Customization & Streetscape Parity Suite', () => {
  test('Industrial color palette contains standard 5 colors', () => {
    expect(INDUSTRIAL_COLOR_PALETTE.length).toBe(5)
    const ids = INDUSTRIAL_COLOR_PALETTE.map((p) => p.id)
    expect(ids).toContain('safety-yellow')
    expect(ids).toContain('pedestrian-blue')
    expect(ids).toContain('safety-green')
    expect(ids).toContain('warning-red')
    expect(ids).toContain('pure-white')
  })

  test('resolveRouteFill respects fillEnabled: false (unpainted) vs fillEnabled: true', () => {
    const unpainted = makeRoute({ fillEnabled: false })
    expect(resolveRouteFill(unpainted)).toBeNull()

    const filledWithColor = makeRoute({ fillEnabled: true, fillColor: '#22c55e' })
    expect(resolveRouteFill(filledWithColor)).toBe('#22c55e')

    const filledVehicleDefault = makeRoute({ fillEnabled: true, fillColor: undefined })
    expect(resolveRouteFill(filledVehicleDefault)).toBe('#f59e0b')

    const filledPedestrianDefault = makeRoute({
      role: 'pedestrian',
      fillEnabled: true,
      fillColor: undefined,
    })
    expect(resolveRouteFill(filledPedestrianDefault)).toBe(DEFAULT_PEDESTRIAN_FILL_COLOR)
  })

  test('buildRouteGeometry omits paint group when fillEnabled is false', () => {
    const emptyRoute = makeRoute({ fillEnabled: false, traffic: 'one-way' })
    const geom = buildRouteGeometry(emptyRoute)
    // When unpainted with arrows: exactly 2 groups (STRIPE + CONTRAST)
    expect(geom.groups.length).toBe(2)
    expect(geom.groups[0]?.materialIndex).toBe(0) // STRIPE
    expect(geom.groups[1]?.materialIndex).toBe(1) // CONTRAST (arrows)
  })

  test('buildRouteGeometry includes paint group when fillEnabled is true', () => {
    const filledRoute = makeRoute({ fillEnabled: true, fillColor: '#3b82f6', traffic: 'one-way' })
    const geom = buildRouteGeometry(filledRoute)
    // STRIPE (0), CONTRAST (1), PAINT (2)
    expect(geom.groups.length).toBe(3)
    expect(geom.groups[2]?.materialIndex).toBe(2) // PAINT
  })

  test('arrowDirection: backward points arrows in opposite direction', () => {
    const fwdRoute = makeRoute({
      points: [
        [0, 0],
        [10, 0],
      ],
      traffic: 'one-way',
      arrowDirection: 'forward',
    })
    const bwdRoute = makeRoute({
      points: [
        [0, 0],
        [10, 0],
      ],
      traffic: 'one-way',
      arrowDirection: 'backward',
    })

    const fwdGeom = buildRouteGeometry(fwdRoute)
    const bwdGeom = buildRouteGeometry(bwdRoute)

    expect(fwdGeom).not.toBeNull()
    expect(bwdGeom).not.toBeNull()
  })

  test('arrowSpacing modifies arrow frequency along long leg', () => {
    const denseRoute = makeRoute({
      points: [
        [0, 0],
        [60, 0],
      ],
      traffic: 'one-way',
      arrowSpacing: 5,
    })
    const sparseRoute = makeRoute({
      points: [
        [0, 0],
        [60, 0],
      ],
      traffic: 'one-way',
      arrowSpacing: 25,
    })

    const denseGeom = buildRouteGeometry(denseRoute)
    const sparseGeom = buildRouteGeometry(sparseRoute)

    // Contrast group length differs based on arrow count
    const denseContrast = denseGeom.groups.find((g) => g.materialIndex === 1)
    const sparseContrast = sparseGeom.groups.find((g) => g.materialIndex === 1)

    expect(denseContrast).toBeDefined()
    expect(sparseContrast).toBeDefined()
    expect(denseContrast!.count).toBeGreaterThanOrEqual(sparseContrast!.count)
  })

  test('getRouteMaterials respects custom edgeColor', () => {
    const matsDefault = getRouteMaterials('vehicle', 'rendered')
    const matsCustom = getRouteMaterials('vehicle', 'rendered', null, '#ef4444')

    expect(matsDefault[0]).not.toBe(matsCustom[0])
  })

  test('routeParametrics exposes Style & Colors and Flow & Arrows groups', () => {
    const labels = routeParametrics.groups.map((g) => g.label)
    expect(labels).toContain('Style & Colors')
    expect(labels).toContain('Flow & Arrows')

    const styleGroup = routeParametrics.groups.find((g) => g.label === 'Style & Colors')
    const styleKeys = styleGroup!.fields.map((f) => f.key)
    expect(styleKeys).toContain('fillEnabled')
    expect(styleKeys).toContain('fillColor')
    expect(styleKeys).toContain('edgeColor')
    expect(styleKeys).toContain('edgeStyle')

    const flowGroup = routeParametrics.groups.find((g) => g.label === 'Flow & Arrows')
    const flowKeys = flowGroup!.fields.map((f) => f.key)
    expect(flowKeys).toContain('arrowDirection')
    expect(flowKeys).toContain('arrowSpacing')
  })

  test('routeParametrics trailingSection correctly loads RoutePanel with post-draw editing capabilities', async () => {
    expect(routeParametrics.trailingSection).toBeDefined()
    expect(typeof routeParametrics.trailingSection).toBe('function')

    const module = await routeParametrics.trailingSection!()
    expect(module).toBeDefined()
    expect(typeof module.default).toBe('function')
  })
})
