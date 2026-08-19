import type { NodeDefinition } from '@pascal-app/core'
import { treeLabel } from '../tree-label'
import { buildPalletLiftFloorplan } from './floorplan'
import { fallbackEnvelopeHeightM, footprintM } from './metrics'
import { palletLiftParametrics } from './parametrics'
import { PalletLiftNode } from './schema'

/** Asansör bir duvara/hatta yaslanıyor: dört açı, ara adım yok. */
const SNAP_ANGLES = Array.from({ length: 4 }, (_, i) => (i * Math.PI) / 2)

/**
 * Palet asansörü — mastlı, zincir tahrikli, platformunda entegre rulo konveyör
 * taşıyan çok katlı dikey palet taşıma sistemi (EN 1570-1/-2).
 *
 * ## KAT SAYISI ŞEMA ALANI DEĞİL
 *
 * Servis edilen katlar host editörünün asansör kind'ından türetiliyor: bina
 * (`parentId`) + `level` çocukları ordinal sırasıyla istifleniyor
 * (`levels.ts`). `fromLevelId`/`toLevelId` yalnız aralığı kısıtlar. Bu yüzden
 * mast yüksekliği düğümde tutulmaz; binadan çıkar.
 *
 * ## `floorPlaced` yüksekliği yaklaşık
 *
 * Zarf `[genişlik, mastYüksekliği, derinlik]` ama mast yüksekliği sahne
 * bilgisi — tanım onu göremiyor, o yüzden düğümün yedek seyahatinden kararlı
 * bir tahmin (`fallbackEnvelopeHeightM`) kullanılıyor; renderer koliderı
 * gerçek çözülmüş yüksekliği taşır. `collides: false` — host'un testi plan
 * dikdörtgeni ve Y görmüyor, 3B doğruluk `clash.ts`'te.
 */
export const palletLiftDefinition = {
  kind: 'warehouse:pallet-lift',
  schemaVersion: 1,
  schema: PalletLiftNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  defaults: () => {
    const { id: _id, type: _type, ...rest } = PalletLiftNode.parse({})
    return rest
  },

  tree: {
    // Kapasite kademesi ile: iki fişi ayıran şey bu (standart / ağır).
    label: treeLabel<PalletLiftNode>((node) => `Pallet Lift · ${node.capacityClass} kg`),
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
        const lift = node as unknown as PalletLiftNode
        const foot = footprintM(lift)
        return {
          dimensions: [foot[0], fallbackEnvelopeHeightM(lift), foot[1]],
          rotation: lift.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: false,
    },

    dragBounds: (node) => {
      const lift = node as unknown as PalletLiftNode
      const foot = footprintM(lift)
      const height = fallbackEnvelopeHeightM(lift)
      return {
        size: [foot[0], height, foot[1]],
        center: [0, height / 2, 0],
      }
    },
  },

  parametrics: palletLiftParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildPalletLiftFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place pallet lift' },
    { key: 'R / T', label: 'Rotate 90°' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Pallet Lift',
    description:
      'A mast-guided, chain-driven vertical pallet lift with an integrated roller conveyor on the platform. Serves the building’s levels (floors are derived, not a field); capacity, mast count, enclosure and doors are set from the inspector.',
    icon: { kind: 'iconify', name: 'lucide:arrow-up-down' },
    paletteSection: 'furnish',
    // Out of the host's auto-derived Build palette, reachable from this
    // plugin's catalog alone. With both surfaces armed, one click commits
    // twice — the host default and this plugin's tool.
    hidden: true,
  },

  mcp: {
    description:
      'Pallet lift — a mast-guided (2 or 4 columns), chain-driven vertical pallet transport with an integrated roller conveyor on its carrying platform (EN 1570-1/-2). **Floors are NOT a field: the served levels are derived from the building the lift sits in (its `level` children, stacked by ordinal), exactly as the host elevator does.** `fromLevelId` / `toLevelId` (level ids, nullable) clamp the service range; both null serves the whole stack. `fallbackTravelM` (metres, 1.5–12) is only used when fewer than two levels resolve (placed outside a building / single-level). `capacityClass` is `1000` / `1500` / `4500` kg — it sets the published vertical speed (80 / 60 m/min; 4500 is an assumption) and the mast section (150 / 200 / 250 mm). `mastCount` is `2` or `4`; the 4500 kg class requires 4. `palletPreset` picks the pallet family preset and sizes the platform (pallet + 2×0.15 m clearance). `hasEnclosure` (a translucent safety guard), `hasDoors` (single up-sliding floor doors), `hasControlPanel` toggle those parts. `mastColor` / `platformColor` / `doorColor` are the finishes. The platform, doors and cycle animate only while the flow simulation runs. All dimensions are metres.',
  },
} satisfies NodeDefinition<typeof PalletLiftNode>
