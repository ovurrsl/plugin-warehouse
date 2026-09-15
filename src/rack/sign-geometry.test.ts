import { describe, expect, test } from 'bun:test'
import {
  SIGN_BACKPLATE_HEIGHT,
  SIGN_BACKPLATE_THICKNESS,
  SIGN_BACKPLATE_WIDTH,
  SIGN_FLUSH_CLEARANCE,
  SIGN_HEIGHT_OFFSET,
  SIGN_STANDOFF_DISTANCE,
  SIGN_STANDOFF_SIZE,
  computeSignTransform,
} from './row-labels-renderer'
import {
  applySignMountStyleToContiguousRacks,
  isFirstRackOfRow,
  isLastRackOfRow,
} from './row-naming'
import { PalletRackNode, type SignMountStyle } from './schema'
import { bayPitch, rowDepth } from './slots'

const makeRack = (id: string, overrides: Record<string, unknown> = {}): PalletRackNode =>
  PalletRackNode.parse({
    id: `pallet_rack_${id}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    ...overrides,
  })

describe('PalletRackNode schema — signMountStyle', () => {
  test('defaults signMountStyle to "flag"', () => {
    const node = makeRack('default')
    expect(node.signMountStyle).toBe('flag')
  })

  test('accepts "flag" explicitly', () => {
    const node = makeRack('flag', { signMountStyle: 'flag' })
    expect(node.signMountStyle).toBe('flag')
  })

  test('accepts "flush" explicitly', () => {
    const node = makeRack('flush', { signMountStyle: 'flush' })
    expect(node.signMountStyle).toBe('flush')
  })

  test('rejects invalid mount style values', () => {
    const result = PalletRackNode.safeParse({
      id: 'pallet_rack_inv',
      signMountStyle: 'hanging',
    })
    expect(result.success).toBe(false)
  })
})

describe('3D physical sign geometry constants', () => {
  test('backplate has standard warehouse dimensions (40cm x 25cm x 1.2cm)', () => {
    expect(SIGN_BACKPLATE_WIDTH).toBe(0.40)
    expect(SIGN_BACKPLATE_HEIGHT).toBe(0.25)
    expect(SIGN_BACKPLATE_THICKNESS).toBe(0.012)
  })

  test('standoff bracket has specified clearance and dimensions', () => {
    expect(SIGN_STANDOFF_DISTANCE).toBe(0.02)
    expect(SIGN_STANDOFF_SIZE).toEqual([0.02, 0.04, 0.04])
    expect(SIGN_FLUSH_CLEARANCE).toBe(0.002)
    expect(SIGN_HEIGHT_OFFSET).toBe(0.35)
  })
})

describe('3D sign transform math — Flag vs Flush', () => {
  const tallRack = makeRack('tall', { uprightHeight: 5.0, bayClearWidth: 2.7, depth: 1.1 })
  const pitch = bayPitch(tallRack)
  const depth = rowDepth(tallRack)

  test('flag mount on left frame upright: protrudes into aisle with 90 deg rotation', () => {
    const transform = computeSignTransform(tallRack, 'left', 'flag')

    // Left upright post X = -pitch / 2
    expect(transform.position[0]).toBeCloseTo(-pitch / 2, 5)
    // Height Y = uprightHeight - 0.35 = 4.65m
    expect(transform.position[1]).toBeCloseTo(5.0 - 0.35, 5)
    // Z = +depth / 2 + backplateWidth / 2 + standoff = depth / 2 + 0.20 + 0.02 = depth / 2 + 0.22
    expect(transform.position[2]).toBeCloseTo(depth / 2 + 0.40 / 2 + 0.02, 5)
    // Rotation = [0, PI / 2, 0]
    expect(transform.rotation).toEqual([0, Math.PI / 2, 0])
  })

  test('flag mount on right frame upright: correctly offsets X to +pitch / 2', () => {
    const transform = computeSignTransform(tallRack, 'right', 'flag')

    expect(transform.position[0]).toBeCloseTo(+pitch / 2, 5)
    expect(transform.position[1]).toBeCloseTo(4.65, 5)
    expect(transform.position[2]).toBeCloseTo(depth / 2 + 0.22, 5)
    expect(transform.rotation).toEqual([0, Math.PI / 2, 0])
  })

  test('flush mount on left frame upright: sits flat against upright front face', () => {
    const transform = computeSignTransform(tallRack, 'left', 'flush')

    expect(transform.position[0]).toBeCloseTo(-pitch / 2, 5)
    expect(transform.position[1]).toBeCloseTo(4.65, 5)
    // Z = +depth / 2 + backplateThickness / 2 + clearance = depth / 2 + 0.006 + 0.002 = depth / 2 + 0.008
    expect(transform.position[2]).toBeCloseTo(depth / 2 + 0.012 / 2 + 0.002, 5)
    // Rotation = [0, 0, 0] (no rotation offset)
    expect(transform.rotation).toEqual([0, 0, 0])
  })

  test('flush mount on right frame upright: sits flat at +pitch / 2', () => {
    const transform = computeSignTransform(tallRack, 'right', 'flush')

    expect(transform.position[0]).toBeCloseTo(+pitch / 2, 5)
    expect(transform.position[1]).toBeCloseTo(4.65, 5)
    expect(transform.position[2]).toBeCloseTo(depth / 2 + 0.008, 5)
    expect(transform.rotation).toEqual([0, 0, 0])
  })

  test('toggling mount style between flag and flush switches rotation and depth', () => {
    const flagTransform = computeSignTransform(tallRack, 'left', 'flag')
    const flushTransform = computeSignTransform(tallRack, 'left', 'flush')

    // Rotation switches between [0, PI/2, 0] and [0, 0, 0]
    expect(flagTransform.rotation[1]).toBe(Math.PI / 2)
    expect(flushTransform.rotation[1]).toBe(0)

    // Flag protrudes further into aisle along +Z than flush
    expect(flagTransform.position[2]).toBeGreaterThan(flushTransform.position[2])
    const difference = flagTransform.position[2] - flushTransform.position[2]
    expect(difference).toBeCloseTo(0.22 - 0.008, 5) // exactly 0.212m
  })

  test('adapts to variable rack heights (e.g. 3m low rack vs 10m high-bay rack)', () => {
    const lowRack = makeRack('low', { uprightHeight: 3.0 })
    const highRack = makeRack('high', { uprightHeight: 10.0 })

    expect(computeSignTransform(lowRack, 'left', 'flag').position[1]).toBeCloseTo(2.65, 5)
    expect(computeSignTransform(highRack, 'left', 'flag').position[1]).toBeCloseTo(9.65, 5)
  })
})

describe('end-rack detection in contiguous rows', () => {
  const baseRack = makeRack('1')
  const pitch = bayPitch(baseRack)

  const r1 = makeRack('1', { position: [0, 0, 0], rowLabel: 'A1' })
  const r2 = makeRack('2', { position: [pitch, 0, 0], rowLabel: 'A1' })
  const r3 = makeRack('3', { position: [pitch * 2, 0, 0], rowLabel: 'A1' })

  const threeBayNodes: Record<string, unknown> = {
    [r1.id]: r1,
    [r2.id]: r2,
    [r3.id]: r3,
  }

  test('first rack in row has sign on left frame', () => {
    expect(isFirstRackOfRow(threeBayNodes, r1.id)).toBe(true)
    expect(isLastRackOfRow(threeBayNodes, r1.id)).toBe(false)
  })

  test('intermediate rack has no aisle signs', () => {
    expect(isFirstRackOfRow(threeBayNodes, r2.id)).toBe(false)
    expect(isLastRackOfRow(threeBayNodes, r2.id)).toBe(false)
  })

  test('last rack in row has sign on right frame', () => {
    expect(isFirstRackOfRow(threeBayNodes, r3.id)).toBe(false)
    expect(isLastRackOfRow(threeBayNodes, r3.id)).toBe(true)
  })

  test('single isolated bay is both first and last, receiving signs on both ends', () => {
    const single = makeRack('solo', { position: [10, 0, 0], rowLabel: 'B1' })
    const singleNode: Record<string, unknown> = {
      [single.id]: single,
    }

    expect(isFirstRackOfRow(singleNode, single.id)).toBe(true)
    expect(isLastRackOfRow(singleNode, single.id)).toBe(true)
  })

  test('non-existent rack id safely returns false', () => {
    expect(isFirstRackOfRow(threeBayNodes, 'non_existent_id')).toBe(false)
    expect(isLastRackOfRow(threeBayNodes, 'non_existent_id')).toBe(false)
  })
})
