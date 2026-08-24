import type { NodeDefinition } from '@pascal-app/core'
import { clashGuardedMove } from '../clash'
import { treeLabel } from '../tree-label'
import { BENCH_VARIANTS } from './catalog'
import { buildBenchFloorplan } from './floorplan'
import { depthM, overallHeightM, widthM } from './metrics'
import { benchParametrics } from './parametrics'
import { BenchNode } from './schema'

const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Paketleme / işleme tezgâhı — altı varyant, tek kind.
 *
 * Yerleşim davranışı mobilya davranışı: bir düğüm bir masa, zemine oturur,
 * 45°'lik adımlarla döner, komşu mıknatısı YOK. Tezgâhlar yan yana dizilir
 * ama çerçeve paylaşmazlar — her masa kendi ayaklarının üstünde durur, ve
 * bir mıknatıs onları raf gibi birbirine yapıştırırsa kullanıcı iki masayı
 * ayrı ayrı taşıyamaz.
 *
 * Tezgâhın ÖN yüzü +Z (`catalog.ts` → `FRONT_Z`): operatör orada durur,
 * çekmeceler ona açılır, ekran ona bakar, üst raf ve alet panosu arkada
 * duvara dayanır. Yön tanımlı olduğu için `facingIndicator` de açık — host'un
 * göstergesi ±Z'ye kilitli ve tezgâhın ön yüzü tam olarak orası.
 */
export const benchDefinition = {
  kind: 'warehouse:bench',
  schemaVersion: 1,
  schema: BenchNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = BenchNode.parse({})
    return rest
  },

  tree: {
    // Altı fişin altı adı — katalogdaki etiketin birebir aynısı, ikinci bir
    // ad listesi tutmamak için `BENCH_VARIANTS`'tan okunuyor.
    label: treeLabel<BenchNode>((node) => BENCH_VARIANTS[node.variant].label),
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'z'], gridSnap: true, ...clashGuardedMove() },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      // Zarf `overallHeightM` — tabla kotu DEĞİL. Üst raflı bir masanın
      // tepesi tabla kotunun yarım metre üstünde ve çarpışma denetimi bunu
      // görmezse masanın üstünden geçen her şey serbest sayılır.
      footprint: (node) => {
        const bench = node as unknown as BenchNode
        return {
          dimensions: [widthM(bench), overallHeightM(bench), depthM(bench)],
          rotation: bench.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    dragBounds: (node) => {
      const bench = node as unknown as BenchNode
      const height = overallHeightM(bench)
      return {
        size: [widthM(bench), height, depthM(bench)],
        centerY: height / 2,
      }
    },
  },

  parametrics: benchParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildBenchFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place bench' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Cycle bench type' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Packing Bench',
    description:
      'Packing and processing benches: dispatch and mail-order packing tables, a processing bench, a weighing-scale station, a mobile workbench and a plain eco table. Width, worktop height and depth are all adjustable.',
    icon: { kind: 'iconify', name: 'lucide:table' },
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'Packing / processing bench — **one table per node**, six catalogue variants selected by `variant`: `dispatch-packing` (2000×920×900 mm, roller top), `mail-order-packing` (1830×920×915, overhead shelf), `processing` (1600×900×750, tool board + drawers), `weighing-scale` (1400×900×750, recessed platform scale + monitor stand), `mobile-workbench` (1220×900×910, castors + drawers) and `eco` (1200×900×600, plain). Those envelopes come from the published spec; everything inside them (leg section, worktop thickness, drawer height, castor diameter) is a chosen default, not a catalogue figure. `width`, `height` and `depth` override the variant envelope and are OPTIONAL — leave a field out to use the catalogue figure. `height` is the WORKTOP level, not the overall height: a bench with an overhead shelf stands higher, and the placement envelope accounts for it. `overhead` (`none`/`shelf`/`toolboard`) and `under` (`none`/`shelf`/`drawers`) override the variant fitment. Castors do not raise the worktop — the legs shorten instead, so a mobile bench lines up with a fixed one. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof BenchNode>
