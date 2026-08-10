import { beforeEach, describe, expect, test } from 'bun:test'
import { driveInRackDefinition } from './definition'
import { frameTopY, lanePitch, totalDepth, totalWidth } from './lanes'
import { resetSeamIndex, snapToNeighbourSeam } from './magnet'
import { resetNeighbourIndex } from './neighbours'
import { DriveInRackNode } from './schema'
import {
  BEARING_MIN_DISPLACED,
  BEARING_MIN_IN_MOTION,
  DEPTH_CLEARANCE_MIN,
  FRONTAL_ENTRY_WIDTHS,
  GUIDE_GAP_INSET,
  LEVEL_PITCH_ALLOWANCE,
  laneClearWidthFor,
  RAIL_PROFILES,
  SIDE_CLEARANCE_MIN,
  TOP_CLEAR_ALLOWANCE,
} from './standards'

const lane = (patch: Partial<DriveInRackNode> = {}) =>
  DriveInRackNode.parse({ id: 'drive-in-rack_probe', ...patch })

describe('definition', () => {
  test('defaults parse', () => {
    const defaults = driveInRackDefinition.defaults()
    // Sabit ad YOK — bkz. `src/tree-label.ts`. `defaults()` bir ad yazarsa
    // `treeLabel` onu kullanıcının verdiği ad sanıp türetmeyi atlar, ve iki
    // fiş ağaçta yine aynı adla görünür.
    expect('name' in defaults).toBe(false)
    expect(() => DriveInRackNode.parse({ id: 'drive-in-rack_x', ...defaults })).not.toThrow()
  })

  test('the footprint is the PITCH, not the outer width', () => {
    /**
     * The bug this prevents is documented on the selective rack and it is the
     * one that would break the kind's only real gesture: at the outer width,
     * two lanes brought flush overlap by one upright, `spatialGridManager`
     * calls that a hard conflict, the box goes red and the click is swallowed.
     */
    const node = lane()
    const footprint = driveInRackDefinition.capabilities.floorPlaced.footprint(node as never)
    expect(footprint.dimensions[0]).toBeCloseTo(lanePitch(node), 9)
    expect(footprint.dimensions[0]).toBeLessThan(totalWidth(node))
    expect(footprint.dimensions[2]).toBeCloseTo(totalDepth(node), 9)
  })

  test('drag bounds are the OUTER width — the box wraps the steel', () => {
    const node = lane()
    const bounds = driveInRackDefinition.capabilities.dragBounds(node as never)
    expect(bounds.size[0]).toBeCloseTo(totalWidth(node), 9)
    // Zarf `frameTopY`den — dikmenin ham boyundan değil. Üst kuşak dikmeyi
    // taşımıyor, dikme kuşağı taşıyor, ve yapının tepesi kuşağın üstü.
    expect(bounds.centerY).toBeCloseTo(frameTopY(node) / 2, 9)
  })

  test('0 is in the rotation snap list', () => {
    // A mirrored-and-filtered list drops 0 as well as -0, which silently
    // removes the one angle a user most expects to snap back to.
    expect(driveInRackDefinition.capabilities.rotatable.snapAngles).toContain(0)
  })

  test('the kind is hidden from the host palette', () => {
    // Reachable only from this plugin's catalog: `build-tab.tsx` enumerates the
    // registry without checking install state, so a palette-visible plugin kind
    // would show even when uninstalled.
    expect(driveInRackDefinition.presentation.hidden).toBe(true)
  })
})

describe('magnet', () => {
  beforeEach(() => {
    resetSeamIndex()
    resetNeighbourIndex()
  })

  test('snaps to exactly one lane pitch', () => {
    const anchor = lane()
    const pitch = lanePitch(anchor)
    const nodes = { [anchor.id]: anchor }
    const dragged = lane({ id: 'drive-in-rack_b' })

    // Dropped 12 cm short of the seam — inside the half-metre magnet.
    const snapped = snapToNeighbourSeam(dragged, [pitch - 0.12, 0, 0], [], nodes)
    expect(snapped?.[0]).toBeCloseTo(pitch, 9)
    expect(snapped?.[2]).toBeCloseTo(0, 9)
  })

  test('leaves a far drag alone', () => {
    const anchor = lane()
    const nodes = { [anchor.id]: anchor }
    expect(snapToNeighbourSeam(lane({ id: 'drive-in-rack_b' }), [6, 0, 0], [], nodes)).toBeNull()
  })

  test('respects rotation — the seam follows local +X', () => {
    const anchor = lane({ rotation: [0, Math.PI / 2, 0] })
    const pitch = lanePitch(anchor)
    const nodes = { [anchor.id]: anchor }
    const dragged = lane({ id: 'drive-in-rack_b', rotation: [0, Math.PI / 2, 0] })

    // Local +X at 90° carries onto world −Z.
    const snapped = snapToNeighbourSeam(dragged, [0.05, 0, -pitch + 0.1], [], nodes)
    expect(snapped?.[0]).toBeCloseTo(0, 6)
    expect(snapped?.[2]).toBeCloseTo(-pitch, 6)
  })

  test('a lane of a different shape does not magnet', () => {
    // Shape has to match, because that is what decides whether the two frame
    // lines genuinely coincide. It is the *same* predicate the frame builder
    // asks, so the magnet cannot pull a lane into a seam the builder refuses.
    const anchor = lane()
    const nodes = { [anchor.id]: anchor }
    const different = lane({ id: 'drive-in-rack_b', palletsDeep: 7 })
    expect(snapToNeighbourSeam(different, [lanePitch(anchor) - 0.1, 0, 0], [], nodes)).toBeNull()
  })

  test('a lane does not magnet to its own seam', () => {
    const anchor = lane()
    const nodes = { [anchor.id]: anchor }
    expect(snapToNeighbourSeam(anchor, [lanePitch(anchor) - 0.1, 0, 0], [], nodes)).toBeNull()
  })

  test('nor onto a place another lane already stands in', () => {
    const a = lane()
    const pitch = lanePitch(a)
    const b = lane({ id: 'drive-in-rack_b', position: [pitch, 0, 0] })
    const nodes = { [a.id]: a, [b.id]: b }
    const dragged = lane({ id: 'drive-in-rack_c' })
    // The seam to a's right is occupied by b; the free seam is to a's left.
    const snapped = snapToNeighbourSeam(dragged, [pitch - 0.1, 0, 0], [], nodes)
    expect(snapped).toBeNull()
  })
})

describe('standards tables against the catalogue', () => {
  test('published entry widths are the p.18 series', () => {
    expect(FRONTAL_ENTRY_WIDTHS.map((value) => Math.round(value * 1000))).toEqual([
      1350, 1400, 1450, 1500, 1550,
    ])
  })

  test('rail sections and the fixed GP span', () => {
    expect(Math.round(RAIL_PROFILES.gp.height * 1000)).toBe(50)
    expect(Math.round(RAIL_PROFILES.c.height * 1000)).toBe(100)
    // The figure the whole frontal-dimensions table turns on.
    expect(Math.round((RAIL_PROFILES.gp.clearSpan ?? 0) * 1000)).toBe(1026)
    // C has no published span — its rails follow the load.
    expect(RAIL_PROFILES.c.clearSpan).toBeNull()
  })

  test('clearance constants', () => {
    expect(Math.round(SIDE_CLEARANCE_MIN * 1000)).toBe(75)
    expect(Math.round(DEPTH_CLEARANCE_MIN * 1000)).toBe(25)
    expect(Math.round(BEARING_MIN_DISPLACED * 1000)).toBe(30)
    expect(Math.round(BEARING_MIN_IN_MOTION * 1000)).toBe(20)
    expect(Math.round(GUIDE_GAP_INSET * 1000)).toBe(110)
  })

  test('level pitch allowances F and the top clear G', () => {
    expect(Math.round(LEVEL_PITCH_ALLOWANCE.gp * 1000)).toBe(150)
    expect(Math.round(LEVEL_PITCH_ALLOWANCE.c * 1000)).toBe(300)
    expect(Math.round(TOP_CLEAR_ALLOWANCE * 1000)).toBe(200)
  })

  test('entry width for a load snaps up to the published series', () => {
    // 1200 + 2×75 = 1350, the table's first row exactly.
    expect(Math.round(laneClearWidthFor(1.2) * 1000)).toBe(1350)
    // 1250 + 150 = 1400.
    expect(Math.round(laneClearWidthFor(1.25) * 1000)).toBe(1400)
  })

  test('a load wider than the table returns the RULE, not the table maximum', () => {
    // Clamping to 1550 would be a quiet lie about a structure that does not fit
    // the pallet. 1600 + 150 = 1750.
    expect(Math.round(laneClearWidthFor(1.6) * 1000)).toBe(1750)
  })
})
