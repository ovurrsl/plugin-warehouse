import type { NodeDefinition } from '@pascal-app/core'
import { clashGuardedMove } from '../clash'
import { treeLabel } from '../tree-label'
import { circleOpening, crossesSurface, verticalOpening } from '../vertical-opening'
import { snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'
import { buildSpiralFloorplan } from './spiral-floorplan'
import { resolveSpiralRise } from './spiral-levels'
import { cageRadiusM, footprintM, overallHeightM } from './spiral-metrics'
import { conveyorSpiralParametrics } from './spiral-parametrics'
import { ConveyorSpiralNode } from './spiral-schema'

const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Kat deliğinin kafes yarıçapından dışarı payı, metre — host asansörünün
 * `ELEVATOR_OPENING_PADDING` değeriyle aynı.
 */
const OPENING_CLEARANCE_M = 0.08

/** Yuvarlak deliği yaklaştıran kenar sayısı — çap 2,4 m'de kenar ~0,47 m. */
const OPENING_SEGMENTS = 16

/**
 * Sarmal (spiral) konveyör.
 *
 * Merkezi kolon etrafında helis yörüngede yükselen taşıma yüzeyi. İki portu
 * FARKLI KOTTA (giriş altta, çıkış üstte) — bu paketin per-port Y taşıyan ilk
 * kind'ı, ve `transportHeightAt`'in port parametresini gerçekten okumasının
 * sebebi. Akış simülasyonuna GİRMEZ (helis 2D Route ile modellenemiyor; akış
 * işi beklemede), ama mıknatısa girer: iki soru ayrı (bkz. `flow-simulation.ts`).
 *
 * ## Katlar arası çalışır: geçtiği döşemeleri deler
 *
 * Sarmalın bütün amacı kot değiştirmek, dolayısıyla tipik kullanımı bir kat
 * döşemesinin İÇİNDEN geçmek. `verticalOpening` bildirdiği için host, merdiven
 * ve asansörde olduğu gibi geçtiği her kat döşemesini ve tavanını kesiyor.
 *
 * `fromLevelId`/`toLevelId` (veya `baseLevelId`/`topLevelId`) seçilmişse
 * toplam yükseliş bina katlarından dinamik türetilir. Seçilmemişse `travelHeight`
 * değerinden okunur.
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
      ...clashGuardedMove(),
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

    ...verticalOpening({
      // Gövde YUVARLAK: delik de yuvarlak. `footprintM` kareyi iki tanjant
      // güdüğünü de kapsayacak kadar büyütüyor, ama o güdükler giriş/çıkış
      // kotunda — döşemeden geçen şey kafes silindiri.
      polygon: (node) => {
        const spiral = node as ConveyorSpiralNode
        return circleOpening(
          spiral.position,
          cageRadiusM(spiral) + OPENING_CLEARANCE_M,
          OPENING_SEGMENTS,
        )
      },
      servesLevel: (node, levelId, nodes, surface) => {
        const spiral = node as ConveyorSpiralNode
        const height = resolveSpiralRise(nodes as Readonly<Record<string, unknown>>, spiral)
        // Taban 0: makine kendi döşemesinin üstünde duruyor, o döşeme
        // delinmiyor. Tepe, kafes/korkuluk payını da içeren toplam boy.
        return crossesSurface(nodes, spiral, levelId, surface, {
          bottom: 0,
          top: overallHeightM(spiral, height),
        })
      },
    }),
  },

  extensions: {
    'pascal:editor/floorplan': {
      linkedLevelIds: (node: ConveyorSpiralNode) => {
        const targetId = node.toLevelId ?? node.topLevelId
        return targetId && targetId !== node.parentId ? [targetId] : []
      },
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
    // Ailenin geri kalanı gibi GİZLİ: konveyörler host'un genel furnish
    // paletinden DEĞİL, eklentinin kendi katalog panelinden yerleştirilir.
    // Eksik olması sarmalı iki yoldan birden yerleştirilebilir yapıyordu ve
    // tek tık İKİ düğüm oluşturuyordu (host varsayılanı + eklenti aracı).
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'A spiral (helical) conveyor — a belt that climbs around a central drive column, raising or lowering goods in a small footprint (EN 619:2022). `loadClass` is `light` (cartons/totes, ≤12.5° incline) or `pallet` (minimum 2400 mm outer diameter, ≤13°). `outerDiameter` (1200/1500/1800/2400 mm) and `beltWidth` (400/500/650/800 mm) are millimetre string enums; the helix radius is (outerDiameter − beltWidth)/2. `travelHeight` is the vertical rise in metres (1–15). `inclineDeg` is the helix incline in degrees (3–13); the pitch per turn is 2π·R·tan(incline). `entryHeight` is the bottom belt height in metres (default 0.75, the family standard that lets it mate a roller line). `handedness` (cw/ccw) mirrors the helix. `flow` (up/down) sets which port is the inlet and the animation direction. `hasCage` shows a translucent safety cage; `hasHandrail` a rail following the helix. The two ports sit at different heights — inlet at entryHeight, outlet at entryHeight+travelHeight. It declares a vertical opening, so the host cuts a round hole through every floor slab and ceiling it climbs past — its own floor excluded, the floor it arrives at included. Which floors those are follows from `travelHeight`; there is no separate floor field. Speed, capacity and motor power are not published as a table; the animation runs on a labelled per-class speed (light 0.5 m/s, pallet 5 m/min) and is visualisation only. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof ConveyorSpiralNode>
