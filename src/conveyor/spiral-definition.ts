import type { NodeDefinition } from '@pascal-app/core'
import { treeLabel } from '../tree-label'
import { snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'
import { buildSpiralFloorplan } from './spiral-floorplan'
import { footprintM, overallHeightM } from './spiral-metrics'
import { conveyorSpiralParametrics } from './spiral-parametrics'
import { ConveyorSpiralNode } from './spiral-schema'

const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Sarmal (spiral) konveyör.
 *
 * Merkezi kolon etrafında helis yörüngede yükselen taşıma yüzeyi. İki portu
 * FARKLI KOTTA (giriş altta, çıkış üstte) — bu paketin per-port Y taşıyan ilk
 * kind'ı, ve `transportHeightAt`'in port parametresini gerçekten okumasının
 * sebebi. Akış simülasyonuna GİRMEZ (helis 2D Route ile modellenemiyor; akış
 * işi beklemede), ama mıknatısa girer: iki soru ayrı (bkz. `flow-simulation.ts`).
 */
export const conveyorSpiralDefinition = {
  kind: 'warehouse:conveyor-spiral',
  schemaVersion: 1,
  schema: ConveyorSpiralNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  defaults: () => {
    const { id: _id, type: _type, ...rest } = ConveyorSpiralNode.parse({})
    return rest
  },

  tree: {
    label: treeLabel<ConveyorSpiralNode>(
      (node) =>
        `Spiral Conveyor (${node.loadClass === 'pallet' ? 'pallet' : 'carton'}) · ${node.travelHeight} m`,
    ),
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      // Ailenin port mıknatısı — diğer modüllerin birebir aynısı.
      groupMoveSnap: ({ node, candidatePosition, movingIds, nodes }) => {
        const spiral = node as unknown as ConveyorSpiralNode
        return snapToLineEnd(
          spiral,
          candidatePosition,
          spiral.rotation?.[1] ?? 0,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        )
      },
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },

    floorPlaced: {
      footprint: (node) => {
        const spiral = node as unknown as ConveyorSpiralNode
        return {
          dimensions: [footprintM(spiral), overallHeightM(spiral), footprintM(spiral)],
          rotation: spiral.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      // Kapalı: host'un testi plan dikdörtgenidir ve Y görmez. 3B doğruluk
      // `clash.ts`'te, ailenin geri kalanının yaptığının aynısı.
      collides: false,
    },

    dragBounds: (node) => {
      const spiral = node as unknown as ConveyorSpiralNode
      const height = overallHeightM(spiral)
      const foot = footprintM(spiral)
      return {
        size: [foot, height, foot],
        center: [0, height / 2, 0],
      }
    },
  },

  parametrics: conveyorSpiralParametrics,

  /**
   * İki port, farklı kotta — `localPorts` giriş (alt) ve çıkış (üst) uçlarını
   * üretiyor, rolleri akıştan. Simülasyona girmediği hâlde port bildiriyor:
   * geometrik birleşme (mıknatıs) ile kutu yönlendirme (rota) ayrı sorular.
   */
  ports: conveyorPorts,

  renderer: {
    kind: 'parametric',
    module: () => import('./spiral-renderer'),
  },

  floorplan: buildSpiralFloorplan,

  tool: () => import('./spiral-tool'),

  toolHints: [
    { key: 'Left click', label: 'Place spiral conveyor' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Spiral Conveyor',
    description:
      'A helical belt climbing around a central drive column. Two load classes — cartons (≤12.5°) and pallets (≥2400 mm diameter, ≤13°). Entry and exit sit at different heights.',
    icon: { kind: 'iconify', name: 'lucide:tornado' },
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'A spiral (helical) conveyor — a belt that climbs around a central drive column, raising or lowering goods in a small footprint (EN 619:2022). `loadClass` is `light` (cartons/totes, ≤12.5° incline) or `pallet` (minimum 2400 mm outer diameter, ≤13°). `outerDiameter` (1200/1500/1800/2400 mm) and `beltWidth` (400/500/650/800 mm) are millimetre string enums; the helix radius is (outerDiameter − beltWidth)/2. `travelHeight` is the vertical rise in metres (1–15). `inclineDeg` is the helix incline in degrees (3–13); the pitch per turn is 2π·R·tan(incline). `entryHeight` is the bottom belt height in metres (default 0.75, the family standard that lets it mate a roller line). `handedness` (cw/ccw) mirrors the helix. `flow` (up/down) sets which port is the inlet and the animation direction. `hasCage` shows a translucent safety cage; `hasHandrail` a rail following the helix. The two ports sit at different heights — inlet at entryHeight, outlet at entryHeight+travelHeight. Speed, capacity and motor power are not published as a table; the animation runs on a labelled per-class speed (light 0.5 m/s, pallet 5 m/min) and is visualisation only. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof ConveyorSpiralNode>
