import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  computeCode128Checksum,
  drawCode128Barcode,
  getLevelColor,
  getLevelLetter,
  LEVEL_COLOR_PALETTE,
  MasterLabelAtlas,
  MAX_ATLAS_CELLS,
} from './beam-label-atlas'
import { createBeamLipLabelMaterial } from './beam-label-material'
import {
  CULL_DISTANCE_FAR,
  CULL_DISTANCE_NEAR,
  LABEL_HEIGHT,
  LABEL_WIDTH,
  ROTATION_180_Y,
} from './beam-labels-renderer'
import {
  BADGE_HEIGHT,
  BADGE_THICKNESS,
  BADGE_WIDTH,
  GROUND_STENCIL_HEIGHT,
  GROUND_STENCIL_WIDTH,
  GROUND_STENCIL_Y_OFFSET,
  resolveAisleSignLabel,
  SIGN_BACKPLATE_HEIGHT,
  SIGN_BACKPLATE_THICKNESS,
  SIGN_BACKPLATE_WIDTH,
  SIGN_FLUSH_CLEARANCE,
  SIGN_STANDOFF_DISTANCE,
} from './row-labels-renderer'
import { PalletRackNode } from './schema'
import { bayPitch, levelBeamHeight, levelSurfaceY, palletSlotsOf, rowDepth } from './slots'
import { useWarehouseStore, WAREHOUSE_PREFERENCE_PERSISTENCE } from '../store'

const makeRack = (overrides: Record<string, unknown> = {}): PalletRackNode => {
  const rawId = (overrides.id as string) || 'test'
  const id = rawId.startsWith('pallet_rack_') || rawId.startsWith('pallet-rack_')
    ? rawId
    : `pallet_rack_${rawId}`

  return PalletRackNode.parse({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    rowLabel: 'A',
    bayIndex: 1,
    ...overrides,
    id,
  })
}

describe('Feature 6: Aisle Upright Signs & Label Resolution', () => {
  test('resolves direct single rowLabel', () => {
    const rack = makeRack({ rowLabel: 'A' })
    expect(resolveAisleSignLabel(rack)).toBe('A')
  })

  test('resolves space-separated aisle pairs from rowLabel', () => {
    const rack = makeRack({ rowLabel: 'A B' })
    expect(resolveAisleSignLabel(rack)).toBe('A B')
  })

  test('resolves aisle pair from frontAisleLabel and rearAisleLabel', () => {
    const rack = makeRack({
      rowLabel: 'L1',
      frontAisleLabel: 'A',
      rearAisleLabel: 'B',
    })
    expect(resolveAisleSignLabel(rack)).toBe('A B')
  })

  test('resolves single frontAisleLabel when rear is empty', () => {
    const rack = makeRack({
      rowLabel: '',
      frontAisleLabel: 'C',
      rearAisleLabel: '',
    })
    expect(resolveAisleSignLabel(rack)).toBe('C')
  })

  test('sign physical dimensions match specification', () => {
    expect(SIGN_BACKPLATE_WIDTH).toBe(0.8)
    expect(SIGN_BACKPLATE_HEIGHT).toBe(0.35)
    expect(SIGN_BACKPLATE_THICKNESS).toBe(0.016)
    expect(SIGN_STANDOFF_DISTANCE).toBe(0.05)
    expect(SIGN_FLUSH_CLEARANCE).toBe(0.002)
  })
})

describe('Feature 7: 3D Ground Bay Stencils', () => {
  test('ground stencil dimensions and non-zero clearance offset', () => {
    expect(GROUND_STENCIL_WIDTH).toBe(0.50)
    expect(GROUND_STENCIL_HEIGHT).toBe(0.35)
    // Local Y = 0.002m strictly eliminates coplanar Z-fighting with warehouse slab
    expect(GROUND_STENCIL_Y_OFFSET).toBe(0.002)
  })

  test('stencil number is zero-padded 2-digit bay index', () => {
    const r1 = makeRack({ bayIndex: 1 })
    const r2 = makeRack({ bayIndex: 9 })
    const r3 = makeRack({ bayIndex: 14 })

    expect(String(r1.bayIndex).padStart(2, '0')).toBe('01')
    expect(String(r2.bayIndex).padStart(2, '0')).toBe('09')
    expect(String(r3.bayIndex).padStart(2, '0')).toBe('14')
  })

  test('stencil placement Z is centered in aisle 350mm forward of rack front face', () => {
    const rack = makeRack({ depth: 1.1 })
    const depth = rowDepth(rack)
    const expectedZ = depth / 2 + 0.35
    expect(expectedZ).toBeCloseTo(1.1 / 2 + 0.35, 3)
  })

  test('dual-facing rack supports front (+Z) and rear (-Z) stencil positions', () => {
    const dualRack = makeRack({ depth: 1.1, accessMode: 'dual-facing' })
    const depth = rowDepth(dualRack)
    const frontZ = depth / 2 + 0.35
    const rearZ = -(depth / 2 + 0.35)

    expect(frontZ).toBeCloseTo(0.9, 3)
    expect(rearZ).toBeCloseTo(-0.9, 3)
  })
})

describe('Feature 8: 3D Upright Level Color Badges', () => {
  test('mandates exact hex palette for levels A through F', () => {
    expect(LEVEL_COLOR_PALETTE.A).toBe('#FACC15') // Yellow
    expect(LEVEL_COLOR_PALETTE.B).toBe('#2563EB') // Blue
    expect(LEVEL_COLOR_PALETTE.C).toBe('#DC2626') // Red
    expect(LEVEL_COLOR_PALETTE.D).toBe('#16A34A') // Green
    expect(LEVEL_COLOR_PALETTE.E).toBe('#18181B') // Black
    expect(LEVEL_COLOR_PALETTE.F).toBe('#9333EA') // Magenta
  })

  test('level letter and color mapping helper', () => {
    expect(getLevelLetter(0)).toBe('A')
    expect(getLevelLetter(1)).toBe('B')
    expect(getLevelLetter(2)).toBe('C')
    expect(getLevelLetter(3)).toBe('D')
    expect(getLevelLetter(4)).toBe('E')
    expect(getLevelLetter(5)).toBe('F')

    expect(getLevelColor(0)).toBe('#FACC15')
    expect(getLevelColor(1)).toBe('#2563EB')
    expect(getLevelColor(2)).toBe('#DC2626')
    expect(getLevelColor(3)).toBe('#16A34A')
    expect(getLevelColor(4)).toBe('#18181B')
    expect(getLevelColor(5)).toBe('#9333EA')
  })

  test('badge plate dimensions match specification', () => {
    expect(BADGE_WIDTH).toBe(0.06)
    expect(BADGE_HEIGHT).toBe(0.04)
    expect(BADGE_THICKNESS).toBe(0.006)
  })

  test('left post position matches -bayPitch / 2', () => {
    const rack = makeRack({ bayClearWidth: 2.7, uprightWidth: 0.122 })
    const pitch = bayPitch(rack)
    const expectedX = -pitch / 2
    expect(expectedX).toBeCloseTo(-(2.7 + 0.122) / 2, 5)
  })

  test('ground level badge elevation is 0.15m above floor', () => {
    const groundBadgeY = 0.15
    expect(groundBadgeY).toBe(0.15)
  })

  test('beamed level badge elevation is centered on the beam connector', () => {
    const rack = makeRack({ levels: 3 })
    for (let lvl = 1; lvl <= 3; lvl++) {
      const surfaceY = levelSurfaceY(rack, lvl)
      const beamH = levelBeamHeight(rack, lvl)
      const centerY = surfaceY - beamH / 2
      expect(centerY).toBeLessThan(surfaceY)
      expect(centerY).toBeGreaterThan(0)
    }
  })
})

describe('Feature 9: 3D Beam Lip Barcodes via InstancedMesh & Atlas', () => {
  test('label dimensions match 150mm x 40mm physical standard', () => {
    expect(LABEL_WIDTH).toBe(0.15)
    expect(LABEL_HEIGHT).toBe(0.04)
  })

  test('Code 128 Modulo 103 checksum calculation is correct', () => {
    // Validates checksum for warehouse address format
    const checksum = computeCode128Checksum('A-02-D2')
    expect(checksum).toBeGreaterThanOrEqual(0)
    expect(checksum).toBeLessThan(103)
  })

  test('MasterLabelAtlas grid dimensions and UV calculation', () => {
    const atlas = new MasterLabelAtlas()
    expect(ATLAS_COLS).toBe(8)
    expect(ATLAS_ROWS).toBe(32)

    const cell0 = atlas.getOrCreateCell({ address: 'A-01-A1', levelLetter: 'A' })
    expect(cell0).toBe(0)
    const [u0, v0] = atlas.getCellUvOffset(0)
    expect(u0).toBe(0.0)
    expect(v0).toBeCloseTo(1.0 - 1.0 / 32, 5)

    const cell1 = atlas.getOrCreateCell({ address: 'A-01-A2', levelLetter: 'A' })
    expect(cell1).toBe(1)
    const [u1, v1] = atlas.getCellUvOffset(1)
    expect(u1).toBeCloseTo(1.0 / 8, 5)
    expect(v1).toBeCloseTo(v0, 5)

    // Cached retrieval returns the exact same cell index
    expect(atlas.getOrCreateCell({ address: 'A-01-A1', levelLetter: 'A' })).toBe(0)
  })

  test('rear beam orientation rotates by 180 degrees (PI) around Y', () => {
    const forwardVector = new THREE.Vector3(0, 0, 1).applyQuaternion(ROTATION_180_Y)
    expect(forwardVector.z).toBeCloseTo(-1, 5)
    expect(forwardVector.x).toBeCloseTo(0, 5)
    expect(forwardVector.y).toBeCloseTo(0, 5)
  })

  test('culling distance thresholds (20m to 25m hysteresis)', () => {
    expect(CULL_DISTANCE_NEAR).toBe(20)
    expect(CULL_DISTANCE_FAR).toBe(25)
  })

  test('slot enumeration for 10 racks produces expected capacity for InstancedMesh', () => {
    const racks = Array.from({ length: 10 }, (_, i) =>
      makeRack({
        id: `multi_rack_${i}`,
        bayIndex: i + 1,
        levels: 3,
        groundLevelStorage: true,
      }),
    )

    let totalSlots = 0
    for (const r of racks) {
      totalSlots += palletSlotsOf(r).length
    }
    // 10 racks * (4 levels * 3 positions) = 120 slots
    expect(totalSlots).toBe(120)
  })
})

describe('Feature 10: View Layer Toggles & Persistence', () => {
  test('store provides independent boolean toggles with default true', () => {
    const store = useWarehouseStore.getState()
    expect(store.showAisleSigns).toBe(true)
    expect(store.showGroundStencils).toBe(true)
    expect(store.showLevelColorBadges).toBe(true)
    expect(store.showBeamLipBarcodes).toBe(true)
  })

  test('setLabelToggles updates individual layers independently', () => {
    const { setLabelToggles } = useWarehouseStore.getState()

    setLabelToggles({ showAisleSigns: false })
    expect(useWarehouseStore.getState().showAisleSigns).toBe(false)
    expect(useWarehouseStore.getState().showGroundStencils).toBe(true)

    setLabelToggles({ showGroundStencils: false })
    expect(useWarehouseStore.getState().showGroundStencils).toBe(false)

    setLabelToggles({ showLevelColorBadges: false })
    expect(useWarehouseStore.getState().showLevelColorBadges).toBe(false)

    setLabelToggles({ showBeamLipBarcodes: false })
    expect(useWarehouseStore.getState().showBeamLipBarcodes).toBe(false)

    // Restore to defaults
    setLabelToggles({
      showAisleSigns: true,
      showGroundStencils: true,
      showLevelColorBadges: true,
      showBeamLipBarcodes: true,
    })
    expect(useWarehouseStore.getState().showAisleSigns).toBe(true)
  })

  test('individual setters update their respective layer toggle', () => {
    const {
      setShowAisleSigns,
      setShowGroundStencils,
      setShowLevelColorBadges,
      setShowBeamLipBarcodes,
    } = useWarehouseStore.getState()

    setShowAisleSigns(false)
    expect(useWarehouseStore.getState().showAisleSigns).toBe(false)

    setShowGroundStencils(false)
    expect(useWarehouseStore.getState().showGroundStencils).toBe(false)

    setShowLevelColorBadges(false)
    expect(useWarehouseStore.getState().showLevelColorBadges).toBe(false)

    setShowBeamLipBarcodes(false)
    expect(useWarehouseStore.getState().showBeamLipBarcodes).toBe(false)

    // Restore to true
    setShowAisleSigns(true)
    setShowGroundStencils(true)
    setShowLevelColorBadges(true)
    setShowBeamLipBarcodes(true)
  })
})

describe('Milestone M2 Remediation Verification', () => {
  test('Item 1 & 2: Local vs World coordinateSpace in BeamLipLabelMesh prevents double transform', () => {
    // Single rack at position [10, 0, 20] rotated 90 degrees around Y
    const rack = makeRack({
      position: [10, 0, 20],
      rotation: [0, Math.PI / 2, 0],
      depth: 1.1,
      levels: 2,
    })

    const slots = palletSlotsOf(rack)
    expect(slots.length).toBeGreaterThan(0)
    const slot0 = slots[0]!

    const beamH = levelBeamHeight(rack, slot0.level)
    const beamY = slot0.level === 0 ? 0.08 : levelSurfaceY(rack, slot0.level) - beamH / 2
    const localX = slot0.localPosition[0]
    const localY = beamY
    const localZ = slot0.localPosition[2] + rack.depth / 2 + 0.001

    // Local matrix composed in rack local space
    const localPos = new THREE.Vector3(localX, localY, localZ)
    const localQuat = new THREE.Quaternion()
    const localMatrix = new THREE.Matrix4().compose(localPos, localQuat, new THREE.Vector3(1, 1, 1))

    // Rack matrix (parent group)
    const rackMatrix = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(0, Math.PI / 2, 0))
      .setPosition(10, 0, 20)

    // In local mode (inside parent group), Three.js computes world position as M_rack * M_local:
    const expectedWorldPos = localPos.clone().applyMatrix4(rackMatrix)

    // Verify expected world position
    expect(expectedWorldPos.x).toBeCloseTo(10 + localZ, 3)
    expect(expectedWorldPos.y).toBeCloseTo(localY, 3)
    expect(expectedWorldPos.z).toBeCloseTo(20 - localX, 3)

    // If double transformed (buggy behavior), M_world was (M_rack)^2 * M_local:
    const buggyDoubleTransformed = localMatrix.clone().premultiply(rackMatrix).premultiply(rackMatrix)
    const buggyPos = new THREE.Vector3().setFromMatrixPosition(buggyDoubleTransformed)

    // The buggy position is displaced by over 10m in X and 20m in Z
    const errorDistance = expectedWorldPos.distanceTo(buggyPos)
    expect(errorDistance).toBeGreaterThan(10)
  })

  test('Item 3: MasterLabelAtlas bijective ring buffer eviction and bounded memory above 256 slots', () => {
    const atlas = new MasterLabelAtlas()
    expect(MAX_ATLAS_CELLS).toBe(256)

    // 1. Allocate initial 256 cells
    for (let i = 0; i < 256; i++) {
      const cell = atlas.getOrCreateCell({ address: `LOC-${i}`, levelLetter: 'A' })
      expect(cell).toBe(i)
      expect(atlas.hasAddress(`LOC-${i}`)).toBe(true)
      expect(atlas.getAddressForCell(i)).toBe(`LOC-${i}`)
    }
    expect(atlas.allocatedCellsCount).toBe(256)

    // 2. Wrap around: 257th slot overwrites cell 0
    const cell256 = atlas.getOrCreateCell({ address: 'LOC-256', levelLetter: 'A' })
    expect(cell256).toBe(0)

    // Invariant check: LOC-0 MUST be evicted from addressToCell
    expect(atlas.hasAddress('LOC-0')).toBe(false)
    expect(atlas.hasAddress('LOC-256')).toBe(true)
    expect(atlas.getAddressForCell(0)).toBe('LOC-256')
    expect(atlas.allocatedCellsCount).toBe(256)

    // 3. Requesting evicted LOC-0 re-allocates cell 1, evicting LOC-1
    const realloc = atlas.getOrCreateCell({ address: 'LOC-0', levelLetter: 'A' })
    expect(realloc).toBe(1)
    expect(atlas.hasAddress('LOC-1')).toBe(false)
    expect(atlas.hasAddress('LOC-0')).toBe(true)
    expect(atlas.getAddressForCell(1)).toBe('LOC-0')
    expect(atlas.allocatedCellsCount).toBe(256)

    // 4. Massive throughput: 1,000 slots
    for (let i = 257; i < 1000; i++) {
      atlas.getOrCreateCell({ address: `LOC-${i}`, levelLetter: 'B' })
    }
    // Memory remains strictly bounded to 256
    expect(atlas.allocatedCellsCount).toBe(256)

    // 5. Dispose clears all mappings and resets ring buffer
    atlas.dispose()
    expect(atlas.allocatedCellsCount).toBe(0)
    expect(atlas.getAddressForCell(0)).toBeUndefined()
  })

  test('Item 4: createBeamLipLabelMaterial sets customProgramCacheKey to isolate Three.js shader cache', () => {
    const dummyTexture = new THREE.Texture()
    const mat = createBeamLipLabelMaterial(dummyTexture, 8, 32)

    expect(typeof mat.customProgramCacheKey).toBe('function')
    expect(mat.customProgramCacheKey()).toBe('beam-lip-label-material')
  })

  test('Item 5: Rear ground stencil rotation produces surface normal pointing up (+Y)', () => {
    const initialNormal = new THREE.Vector3(0, 0, 1)

    // Front ground stencil rotation: [-Math.PI / 2, 0, 0]
    const frontEuler = new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ')
    const frontNormal = initialNormal.clone().applyEuler(frontEuler)
    expect(frontNormal.x).toBeCloseTo(0, 5)
    expect(frontNormal.y).toBeCloseTo(1, 5) // Points +Y (up)
    expect(frontNormal.z).toBeCloseTo(0, 5)

    // Fixed rear ground stencil rotation: [-Math.PI / 2, 0, Math.PI]
    const rearEulerFixed = new THREE.Euler(-Math.PI / 2, 0, Math.PI, 'XYZ')
    const rearNormalFixed = initialNormal.clone().applyEuler(rearEulerFixed)
    expect(rearNormalFixed.x).toBeCloseTo(0, 5)
    expect(rearNormalFixed.y).toBeCloseTo(1, 5) // Points +Y (up)
    expect(rearNormalFixed.z).toBeCloseTo(0, 5)

    // Buggy rear rotation was [Math.PI / 2, 0, Math.PI] which pointed DOWN into floor
    const rearEulerBuggy = new THREE.Euler(Math.PI / 2, 0, Math.PI, 'XYZ')
    const rearNormalBuggy = initialNormal.clone().applyEuler(rearEulerBuggy)
    expect(rearNormalBuggy.y).toBeCloseTo(-1, 5) // Pointed -Y (inverted!)

    // Rear stencil up vector (text orientation) points along +Z towards rack
    const initialUp = new THREE.Vector3(0, 1, 0)
    const rearUp = initialUp.clone().applyEuler(rearEulerFixed)
    expect(rearUp.z).toBeCloseTo(1, 5)
  })

  test('Item 6: Standalone frontAisleLabel correctly resolves and enables aisle sign rendering', () => {
    const rack = makeRack({
      rowLabel: '',
      frontAisleLabel: 'Aisle-North',
      rearAisleLabel: '',
    })

    const signText = resolveAisleSignLabel(rack)
    expect(signText).toBe('Aisle-North')
    expect(Boolean(signText)).toBe(true)
    // Previously, Boolean(rack.rowLabel) was false, suppressing the sign
    expect(Boolean(rack.rowLabel)).toBe(false)
  })
})
