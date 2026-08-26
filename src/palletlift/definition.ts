import type { NodeDefinition } from '@pascal-app/core'
import { clashGuardedMove } from '../clash'
import { treeLabel } from '../tree-label'
import { crossesSurface, rectOpening, verticalOpening } from '../vertical-opening'
import { buildPalletLiftFloorplan } from './floorplan'
import { liftOpeningSpan } from './levels'
import { enclosureXZ, fallbackEnvelopeHeightM, footprintM } from './metrics'
import { palletLiftParametrics } from './parametrics'
import { PalletLiftNode } from './schema'

/** Asansör bir duvara/hatta yaslanıyor: dört açı, ara adım yok. */
const SNAP_ANGLES = Array.from({ length: 4 }, (_, i) => (i * Math.PI) / 2)

/**
 * Kat deliğinin muhafaza zarfından dışarı payı, metre — host asansörünün
 * `ELEVATOR_OPENING_PADDING` değeriyle aynı, iki mekanizma yan yana durunca
 * delikler aynı cömertlikte olsun diye.
 */
const OPENING_CLEARANCE_M = 0.08

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
 *
 * ## Kuyu, host asansörünün açtığı deliğin aynısını açar
 *
 * `verticalOpening` bildirildiği için host, asansörün geçtiği her kat döşemesini
 * ve tavanını kesiyor — OTURDUĞU döşemeyi değil, VARDIĞI döşemeyi (bkz.
 * `vertical-opening.ts crossesSurface`). Delik muhafaza zarfı + boşluk payı;
 * `footprintM` DEĞİL, çünkü o kontrol panosunun taşmasını da sarıyor ve pano
 * tek katta kafesin dışında duruyor — kuyudan geçmiyor.
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
    movable: { axes: ['x', 'z'], gridSnap: true, ...clashGuardedMove() },
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

    ...verticalOpening({
      polygon: (node) => {
        const lift = node as PalletLiftNode
        const [width, depth] = enclosureXZ(lift)
        return rectOpening(
          lift.position,
          lift.rotation?.[1] ?? 0,
          width / 2 + OPENING_CLEARANCE_M,
          depth / 2 + OPENING_CLEARANCE_M,
        )
      },
      servesLevel: (node, levelId, nodes, surface) => {
        const lift = node as PalletLiftNode
        const span = liftOpeningSpan(nodes, lift)
        return span !== null && crossesSurface(nodes, lift, levelId, surface, span)
      },
    }),
  },

  extensions: {
    'pascal:editor/floorplan': {
      floorplanScope: 'building',
      linkedLevelIds: (node: PalletLiftNode) => {
        const from = node.fromLevelId ?? node.baseLevelId
        const to = node.toLevelId ?? node.topLevelId
        const ids: string[] = []
        if (from && from !== node.parentId) ids.push(from)
        if (to && to !== node.parentId) ids.push(to)
        return ids
      },
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
  },

  mcp: {
    description:
      'Pallet lift — a mast-guided (2 or 4 columns), chain-driven vertical pallet transport with an integrated roller conveyor on its carrying platform (EN 1570-1/-2). **Floors are NOT a field: the served levels are derived from the building the lift sits in (its `level` children, stacked by ordinal), exactly as the host elevator does.** `fromLevelId` / `toLevelId` (level ids, nullable) clamp the service range; both null serves the whole stack. The shaft declares a vertical opening, so the host cuts the enclosure footprint through every served floor slab and ceiling exactly as it does for its own elevator — the floor the lift stands on excluded, the top served floor included. A lift outside a building, or clamped to a single level, cuts nothing. `fallbackTravelM` (metres, 1.5–12) is only used when fewer than two levels resolve (placed outside a building / single-level). `capacityClass` is `1000` / `1500` / `4500` kg — it sets the published vertical speed (80 / 60 m/min; 4500 is an assumption) and the mast section (150 / 200 / 250 mm). `mastCount` is `2` or `4`; the 4500 kg class requires 4. `palletPreset` picks the pallet family preset and sizes the platform (pallet + 2×0.15 m clearance). `hasEnclosure` (a translucent safety guard), `hasDoors` (single up-sliding floor doors), `hasControlPanel` toggle those parts. `mastColor` / `platformColor` / `doorColor` are the finishes. The platform, doors and cycle animate only while the flow simulation runs. All dimensions are metres.',
  },
} satisfies NodeDefinition<typeof PalletLiftNode>
