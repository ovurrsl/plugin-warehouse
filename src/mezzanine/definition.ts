import type { NodeDefinition } from '@pascal-app/core'
import { buildMezzanineFloorplan } from './floorplan'
import { footprintDepthM, footprintWidthM, totalHeightM } from './metrics'
import { mezzanineParametrics } from './parametrics'
import { MezzanineNode } from './schema'

const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Mecalux asma kat — çok katlı yapısal çelik platform.
 *
 * Faz 1 iskeleti: grid + kolon + ana/ikincil kiriş + döşeme, `tiers[]`
 * mimarisiyle (host'un Level'ından bağımsız — bkz. `schema.ts`). Merdiven/
 * kapı/korkuluk Faz 2'nin konusu; `accessories` şemada henüz yok.
 */
export const mezzanineDefinition = {
  kind: 'warehouse:mezzanine',
  schemaVersion: 1,
  schema: MezzanineNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  defaults: () => {
    const { id: _id, type: _type, ...rest } = MezzanineNode.parse({})
    return { ...rest, name: 'Mezzanine' }
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      footprint: (node) => {
        const mezz = node as unknown as MezzanineNode
        return {
          dimensions: [footprintWidthM(mezz), totalHeightM(mezz), footprintDepthM(mezz)],
          rotation: mezz.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    dragBounds: (node) => {
      const mezz = node as unknown as MezzanineNode
      const height = totalHeightM(mezz)
      return {
        size: [footprintWidthM(mezz), height, footprintDepthM(mezz)],
        centerY: height / 2,
      }
    },
  },

  parametrics: mezzanineParametrics,

  // Kendi geometrisini cache'leyen paylaşılan bir mesh — `def.geometry` değil,
  // rack'ın gerekçesinin aynısı: `<GeometrySystem>` her rebuild'de önceki
  // build'in çocuklarını atar, ve bu geometri aynı şekildeki her mezzanine
  // tarafından paylaşılıyor.
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  // Güverteleri host `slab` düğümleriyle uzlaştıran sistem — mezzanine'in
  // üstüne raf/palet/konveyör konabilmesinin tek yolu (gerekçe:
  // `deck-slabs.ts`). Kolektif instancing sistemiyle çakışmaz: o rack'ın
  // kind'ına asılı ayrı bir modül, bu ayrı bir modül, ve `RegisteredSystems`
  // her kaydın sistemini kendi başına mount eder.
  system: {
    module: () => import('./deck-slab-system'),
  },

  floorplan: buildMezzanineFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place mezzanine' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Mezzanine',
    description:
      'Multi-tier structural steel platform. Sigma, GL2000 or Mixed construction; each tier carries its own load class and floor type.',
    icon: { kind: 'iconify', name: 'lucide:layers-3' },
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'A Mecalux mezzanine — a multi-tier structural steel platform. `constructiveSystem` picks the profile family (SIGMA cold-formed, GL2000 hot-rolled IPE+HEA, MIXED). `grid` sets the column bay pattern. `tiers` is an array, NOT a level count: each entry is one internal deck with its own `clearHeightM`, `loadClass` (kg/m²) and `floorType`; `elevationM` is usually `"auto"` (computed from the tiers below it). This is independent of the host\'s own Level/Building structure — a 3-tier mezzanine is ONE node placed on ONE host Level, not three. Staircases, gates and railings are not modelled yet (Phase 2). Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof MezzanineNode>
