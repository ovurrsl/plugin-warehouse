import { describe, expect, test } from 'bun:test'
import { driveInGeometryKey } from './geometry-builder'
import { DriveInRackNode } from './schema'

/**
 * Cache-key coverage, in **both** directions.
 *
 * A shape cache is only as good as its key, and a key fails two ways that look
 * nothing alike:
 *
 *  - **Under-reporting** — a field moves vertices but is not in the key, so two
 *    different lanes share one mesh and editing the field changes nothing on
 *    screen. Silent, and the user concludes the control is broken.
 *  - **Over-reporting** — a field is in the key but moves no vertex under the
 *    current settings, so byte-identical meshes are built twice. Invisible
 *    except as memory and draw calls.
 *
 * The repo's doctrine is to trust this test over reading the builder.
 */

const lane = (patch: Partial<DriveInRackNode> = {}) =>
  DriveInRackNode.parse({ id: 'drive-in-rack_probe', ...patch })

const key = (patch: Partial<DriveInRackNode> = {}) => driveInGeometryKey(lane(patch), 'full')

describe('fields that MUST change the key', () => {
  const moving: Array<[string, Partial<DriveInRackNode>]> = [
    ['laneClearWidth', { laneClearWidth: 1.5 }],
    ['palletsDeep', { palletsDeep: 6 }],
    ['depthClearance', { depthClearance: 0.05 }],
    ['levels', { levels: 4 }],
    ['levelClear', { levelClear: 1.6 }],
    ['levelClears', { levelClears: [2, null, null, null] }],
    ['topClear', { topClear: 1.9 }],
    ['uprightHeight', { uprightHeight: 8 }],
    ['railType', { railType: 'c' }],
    ['uprightWidth', { uprightWidth: 0.162 }],
    ['uprightDepth', { uprightDepth: 0.1 }],
    ['postPitchZ', { postPitchZ: 1.2 }],
    ['topBeamHeight', { topBeamHeight: 0.2 }],
    ['constructiveSystem', { constructiveSystem: 'cs3' }],
    ['entryMode', { entryMode: 'drive-through' }],
    ['guideRails', { guideRails: true }],
    ['uprightReinforcer', { uprightReinforcer: false }],
    ['uprightColor', { uprightColor: '#123456' }],
    ['beamColor', { beamColor: '#123456' }],
    ['railColor', { railColor: '#123456' }],
    ['palletPreset', { palletPreset: 'gma-48x40' }],
    ['palletOrientation', { palletOrientation: 'short-side-out' }],
  ]

  const base = key()
  for (const [label, patch] of moving) {
    test(label, () => {
      expect(
        key(patch),
        `${label} anahtarı değiştirmiyor — iki farklı şerit tek mesh paylaşır`,
      ).not.toBe(base)
    })
  }
})

describe('fields that must NOT change the key', () => {
  const base = key()
  const inert: Array<[string, Partial<DriveInRackNode>]> = [
    ['position', { position: [12, 0, -4] }],
    ['rotation', { rotation: [0, Math.PI / 2, 0] }],
    ['ghostFill', { ghostFill: 0.8 }],
    ['supportSlabId', { supportSlabId: 'slab_x' }],
    ['clearanceSide', { clearanceSide: 0.1 }],
  ]

  for (const [label, patch] of inert) {
    test(label, () => {
      expect(key(patch), `${label} anahtarı bölüyor — aynı mesh iki kez kuruluyor`).toBe(base)
    })
  }

  test('the guide VARIANT is inert while no guide is fitted', () => {
    // The canonical over-reporting case: a variant with no guide moves no
    // vertex, so listing it raw would split the cache between identical meshes.
    expect(key({ guideVariant: 'vgpc' })).toBe(base)
    // …and lives again the moment guides are fitted.
    expect(key({ guideRails: true, guideVariant: 'vgpc' })).not.toBe(
      key({ guideRails: true, guideVariant: 'lpn50' }),
    )
  })

  test('centralisers are inert on a C rail', () => {
    // p.24: a GP fitting. On a C rail the geometry does not build them, so the
    // flag cannot move a vertex.
    expect(key({ railType: 'c', centralisers: true })).toBe(
      key({ railType: 'c', centralisers: false }),
    )
    // On a GP rail it is live.
    expect(key({ centralisers: false })).not.toBe(base)
  })

  test('a level beyond what the post carries is inert', () => {
    // The key encodes the rails that are actually DRAWN, so declaring a fourth
    // level on a post that carries three must not split the cache.
    const short = { uprightHeight: 4.6, levels: 3 } as const
    expect(key({ ...short, levels: 5 })).toBe(key({ ...short }))
  })
})

describe('tier and frame omission', () => {
  test('the two tiers are different meshes', () => {
    const node = lane()
    expect(driveInGeometryKey(node, 'full')).not.toBe(driveInGeometryKey(node, 'simple'))
  })

  test('omitting the shared frame line is a different mesh', () => {
    const node = lane()
    expect(driveInGeometryKey(node, 'full', { omitRight: true })).not.toBe(
      driveInGeometryKey(node, 'full', { omitRight: false }),
    )
  })
})
