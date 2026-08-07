import { beforeEach, describe, expect, test } from 'bun:test'
import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { bayPitch, totalDepth, totalWidth } from './bays'
import { m3ShelvingDefinition } from './definition'
import { buildM3Floorplan } from './floorplan'
import { m3GeometryKey } from './geometry-builder'
import { resetSeamIndex, snapToNeighbourSeam } from './magnet'
import { hasRightNeighbour, resetNeighbourIndex } from './neighbours'
import { m3Parts } from './parts'
import { M3ShelvingNode } from './schema'
import {
  DOOR_BAY_LENGTH,
  DOOR_HEIGHTS,
  FRAME_HEIGHTS,
  MESH_APERTURE,
  SHELF_DEPTHS,
  SHELF_LENGTHS,
  SHELF_MODELS,
  SLOT_PITCH,
  UPRIGHT_FRONT_FACE,
} from './standards'

const bay = (patch: Partial<M3ShelvingNode> = {}) =>
  M3ShelvingNode.parse({ id: 'm3_probe', ...patch })

const ctx = { viewState: undefined } as unknown as GeometryContext

describe('definition', () => {
  test('defaults parse', () => {
    const defaults = m3ShelvingDefinition.defaults()
    expect(defaults.name).toBe('M3 Bay')
    expect(() => M3ShelvingNode.parse({ id: 'm3_x', ...defaults })).not.toThrow()
  })

  test('the footprint is the PITCH, not the outer width', () => {
    /**
     * The fourth kind to state it. At the outer width, two bays brought flush
     * overlap by one upright, `spatialGridManager` calls that a hard conflict,
     * the box goes red and the click that places the second is swallowed.
     */
    const node = bay()
    const footprint = m3ShelvingDefinition.capabilities.floorPlaced.footprint(node as never)
    expect(footprint.dimensions[0]).toBeCloseTo(bayPitch(node), 9)
    expect(footprint.dimensions[0]).toBeLessThan(totalWidth(node))
    expect(footprint.dimensions[2]).toBeCloseTo(totalDepth(node), 9)
  })

  test('drag bounds are the OUTER width — the box wraps the steel', () => {
    const node = bay()
    const bounds = m3ShelvingDefinition.capabilities.dragBounds(node as never)
    expect(bounds.size[0]).toBeCloseTo(totalWidth(node), 9)
    expect(bounds.centerY).toBeCloseTo(node.frameHeight / 2, 9)
  })

  test('0 is in the rotation snap list', () => {
    // A mirrored-and-filtered list drops 0 as well as -0, which silently
    // removes the one angle a user most expects to snap back to.
    expect(m3ShelvingDefinition.capabilities.rotatable.snapAngles).toContain(0)
  })

  test('the kind is hidden from the host palette', () => {
    // Reachable only from this plugin's catalog: `build-tab.tsx` enumerates the
    // registry without checking install state, so a palette-visible plugin kind
    // would show even when uninstalled.
    expect(m3ShelvingDefinition.presentation.hidden).toBe(true)
  })
})

describe('geometri anahtarı türetilenleri de taşıyor', () => {
  /**
   * Bir şema alanı listelemek yetmez: çapraz bağ takımı, çerçeve bağı sayısı,
   * çekmece sayısı ve bölücü boyu hiçbiri alan DEĞİL, hepsi mesh'i değiştiriyor.
   * Yalnız şema anahtarlarını listeleyen bir anahtar, farklı yükseklikteki iki
   * gözü — biri tek takım, biri çift çapraz bağlı — aynı geometriye oturturdu.
   */
  test('çapraz bağ takımını değiştiren yükseklik anahtarı da değiştiriyor', () => {
    const low = bay({ frameHeight: 2.5 })
    const high = bay({ frameHeight: 2.75 })
    expect(m3GeometryKey(low, 'full')).not.toBe(m3GeometryKey(high, 'full'))
  })

  test('arka panel eklemek anahtarı değiştiriyor — çapraz bağı kaldırdığı için', () => {
    expect(m3GeometryKey(bay({ frameHeight: 4 }), 'full')).not.toBe(
      m3GeometryKey(bay({ frameHeight: 4, backPanel: 'metal' }), 'full'),
    )
  })

  test('çerçevenin üstünde kalan kat anahtarı BÖLMÜYOR', () => {
    // Ulaşmadığı bir kat mesh'i değiştirmez; bölerse elli göz elli mesh olur.
    const level = {
      elevation: 0.5,
      structure: 'shelf' as const,
      model: 'HL' as const,
      dividers: 0,
      drawerModel: 'MA' as const,
      drawerWidth: 'wide' as const,
    }
    const a = bay({ frameHeight: 1, levels: [level] })
    const b = bay({ frameHeight: 1, levels: [level, { ...level, elevation: 3 }] })
    expect(m3GeometryKey(a, 'full')).toBe(m3GeometryKey(b, 'full'))
  })

  test('komşulu ve komşusuz göz ayrı anahtar alıyor', () => {
    const node = bay()
    expect(m3GeometryKey(node, 'full', { omitRight: true })).not.toBe(
      m3GeometryKey(node, 'full', { omitRight: false }),
    )
  })
})

describe('magnet', () => {
  beforeEach(() => {
    resetSeamIndex()
    resetNeighbourIndex()
  })

  test('snaps to exactly one bay pitch', () => {
    const anchor = bay()
    const pitch = bayPitch(anchor)
    const nodes = { [anchor.id]: anchor }
    const dragged = bay({ id: 'm3_b' })

    // Dropped 12 cm short of the seam — inside the half-metre magnet.
    const snapped = snapToNeighbourSeam(dragged, [pitch - 0.12, 0, 0], [], nodes)
    expect(snapped?.[0]).toBeCloseTo(pitch, 9)
    expect(snapped?.[2]).toBeCloseTo(0, 9)
  })

  test('leaves a far drag alone', () => {
    const anchor = bay()
    const nodes = { [anchor.id]: anchor }
    expect(snapToNeighbourSeam(bay({ id: 'm3_b' }), [6, 0, 0], [], nodes)).toBeNull()
  })

  test('respects rotation — the seam follows local +X', () => {
    const anchor = bay({ rotation: [0, Math.PI / 2, 0] })
    const pitch = bayPitch(anchor)
    const nodes = { [anchor.id]: anchor }
    const dragged = bay({ id: 'm3_b', rotation: [0, Math.PI / 2, 0] })

    // Local +X at 90° carries onto world −Z.
    const snapped = snapToNeighbourSeam(dragged, [0.05, 0, -pitch + 0.1], [], nodes)
    expect(snapped?.[0]).toBeCloseTo(0, 6)
    expect(snapped?.[2]).toBeCloseTo(-pitch, 6)
  })

  test('a bay with a different FRAME MODEL does not magnet', () => {
    /**
     * The one place M3's shape key differs from M7's. An M3 frame comes in five
     * models, three of which fill the frame plane with a sheet or a mesh — so a
     * plain frame and a panelled one at the same place are not the same ladder,
     * and merging them would silently delete a panel the user ordered.
     */
    const anchor = bay()
    const nodes = { [anchor.id]: anchor }
    const panelled = bay({ id: 'm3_b', frameVariant: 'side-panel' })
    expect(snapToNeighbourSeam(panelled, [bayPitch(anchor) - 0.1, 0, 0], [], nodes)).toBeNull()
  })

  test('but a different LEVEL LAYOUT still magnets — that is the point of a run', () => {
    const anchor = bay()
    const nodes = { [anchor.id]: anchor }
    const drawers = bay({
      id: 'm3_b',
      levels: [
        {
          elevation: 0.5,
          structure: 'drawers',
          model: 'HM',
          dividers: 0,
          drawerModel: 'MB',
          drawerWidth: 'narrow',
        },
      ],
    })
    expect(snapToNeighbourSeam(drawers, [bayPitch(anchor) - 0.1, 0, 0], [], nodes)).not.toBeNull()
  })

  test('a bay does not magnet to its own seam', () => {
    const anchor = bay()
    const nodes = { [anchor.id]: anchor }
    expect(snapToNeighbourSeam(anchor, [bayPitch(anchor) - 0.1, 0, 0], [], nodes)).toBeNull()
  })

  test('nor onto a place another bay already stands in', () => {
    const a = bay()
    const pitch = bayPitch(a)
    const b = bay({ id: 'm3_b', position: [pitch, 0, 0] })
    const nodes = { [a.id]: a, [b.id]: b }
    expect(snapToNeighbourSeam(bay({ id: 'm3_c' }), [pitch - 0.1, 0, 0], [], nodes)).toBeNull()
  })
})

describe('frame sharing', () => {
  beforeEach(() => {
    resetNeighbourIndex()
    resetSeamIndex()
  })

  test('two bays one pitch apart: the left one drops its right frame', () => {
    const a = bay()
    const b = bay({ id: 'm3_b', position: [bayPitch(a), 0, 0] })
    const nodes = { [a.id]: a, [b.id]: b }
    expect(hasRightNeighbour(nodes, a.id)).toBe(true)
    expect(hasRightNeighbour(nodes, b.id)).toBe(false)
  })

  test('so N bays stand on N+1 frames', () => {
    const a = bay()
    const pitch = bayPitch(a)
    const b = bay({ id: 'm3_b', position: [pitch, 0, 0] })
    const c = bay({ id: 'm3_c', position: [pitch * 2, 0, 0] })
    const nodes = { [a.id]: a, [b.id]: b, [c.id]: c }

    let posts = 0
    for (const node of [a, b, c]) {
      posts += m3Parts(node, 'full', { omitRight: hasRightNeighbour(nodes, node.id) }).filter(
        (part) => part.role === 'upright',
      ).length
    }
    // Two posts per frame line, four frame lines.
    expect(posts).toBe(4 * 2)
  })
})

describe('floorplan', () => {
  test('the symbol is a group with the bay footprint at its head', () => {
    const geometry = buildM3Floorplan(bay(), ctx)
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    const first = geometry.children[0]
    expect(first?.kind).toBe('rect')
    if (first?.kind !== 'rect') return
    expect(first.width).toBeCloseTo(totalWidth(bay()), 9)
    expect(first.height).toBeCloseTo(totalDepth(bay()), 9)
  })

  test('a drawer top level draws its cells, not one panel', () => {
    const node = bay({
      levels: [
        {
          elevation: 0.5,
          structure: 'drawers',
          model: 'HL',
          dividers: 0,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
      ],
    })
    const geometry = buildM3Floorplan(node, ctx)
    if (geometry?.kind !== 'group') throw new Error('grup bekleniyordu')
    const rects = geometry.children.filter(
      (child): child is Extract<FloorplanGeometry, { kind: 'rect' }> => child.kind === 'rect',
    )
    // Footprint + four posts + four drawer cells; no single shelf rectangle
    // hiding the cells that are the point of the symbol.
    expect(rects).toHaveLength(1 + 4 + 4)
  })

  /**
   * The plan matches the model — an assertion, not a slogan.
   *
   * Both the symbol and the mesh are projected from `m3Parts`, and this measures
   * that they land in the same place. The failure it guards against is the one
   * the selective rack hit: two files each computing frame positions from the
   * same inputs, agreeing exactly until one of them is edited, and then
   * disagreeing silently because nothing compares them.
   */
  test('every post rect sits where its 3D box does', () => {
    for (const patch of [
      {},
      { shelfLength: 1.4, shelfDepth: 0.6 },
      { frameHeight: 4 },
      { frameVariant: 'mesh' as const },
    ]) {
      const node = bay(patch)
      const geometry = buildM3Floorplan(node, ctx)
      if (geometry?.kind !== 'group') throw new Error('grup bekleniyordu')
      const rects = geometry.children.filter(
        (child): child is Extract<FloorplanGeometry, { kind: 'rect' }> => child.kind === 'rect',
      )
      for (const post of m3Parts(node, 'full').filter((part) => part.role === 'upright')) {
        const expectedX = post.center[0] - post.size[0] / 2
        const expectedY = post.center[2] - post.size[2] / 2
        const found = rects.some(
          (rect) =>
            Math.abs(rect.x - expectedX) < 1e-9 &&
            Math.abs(rect.y - expectedY) < 1e-9 &&
            Math.abs(rect.width - post.size[0]) < 1e-9 &&
            Math.abs(rect.height - post.size[2]) < 1e-9,
        )
        expect(found, `${JSON.stringify(patch)}: dikme planda yok`).toBe(true)
      }
    }
  })

  test('a door draws its swing — the clearance a layout has to keep', () => {
    const plain = buildM3Floorplan(bay(), ctx)
    const withDoor = buildM3Floorplan(bay({ door: 'h2000' }), ctx)
    if (plain?.kind !== 'group' || withDoor?.kind !== 'group') throw new Error('grup bekleniyordu')
    const polylines = (geometry: typeof plain) =>
      geometry.children.filter((child) => child.kind === 'polyline').length
    expect(polylines(plain)).toBe(0)
    // Two leaves, each an arc plus the open leaf itself.
    expect(polylines(withDoor)).toBe(4)
  })
})

describe('standards tables against the catalogue', () => {
  test('the one slot pitch is 25 mm', () => {
    expect(Math.round(SLOT_PITCH * 1000)).toBe(25)
  })

  test('the upright front face is 30 mm', () => {
    expect(Math.round(UPRIGHT_FRONT_FACE * 1000)).toBe(30)
  })

  test('published shelf lengths and depths', () => {
    expect(SHELF_LENGTHS.map((value) => Math.round(value * 1000))).toEqual([750, 1000, 1250, 1400])
    expect(SHELF_DEPTHS.map((value) => Math.round(value * 1000))).toEqual([300, 400, 500, 600])
  })

  test('the common frame-height series is the English edition’s six', () => {
    expect(FRAME_HEIGHTS.map((value) => Math.round(value * 1000))).toEqual([
      1500, 2000, 2500, 2750, 3000, 4000,
    ])
  })

  test('the published loads — the only measured capacity in this package', () => {
    expect(SHELF_MODELS.HL.loadKg).toBe(150)
    expect(SHELF_MODELS.HM.loadKg).toBe(275)
    // And both are printed, not chosen. If either provenance ever softens, the
    // panel's claim that these are published stops being true.
    expect(SHELF_MODELS.HL.provenance).toBe('CATALOG')
    expect(SHELF_MODELS.HM.provenance).toBe('CATALOG')
  })

  test('the door series', () => {
    expect(Math.round(DOOR_BAY_LENGTH * 1000)).toBe(1000)
    expect(DOOR_HEIGHTS.map((value) => Math.round(value * 1000))).toEqual([1000, 2000])
  })

  test('the mesh aperture — the figure a sprinkler calculation needs', () => {
    expect(Math.round(MESH_APERTURE * 1000)).toBe(50)
  })
})
