import type { NodeDefinition } from '@pascal-app/core'
import { treeLabel } from '../tree-label'
import { buildToteCartFloorplan } from './floorplan'
import { cartLengthM, cartWidthM, overallHeightM } from './metrics'
import { toteCartParametrics } from './parametrics'
import { ToteCartNode } from './schema'

/** Araba her açıda itilir — 45°'lik adım, mobilya davranışı. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Sipariş toplama arabası — tekerlekli çerçeve, katlar hâlinde Euro kasa.
 *
 * ## Komşu mıknatısı YOK
 *
 * Arabalar yan yana park edilir ama çerçeve paylaşmazlar, ve bir mıknatıs
 * onları rafa yapıştırır gibi birbirine kilitlerse kullanıcı iki arabayı
 * ayrı ayrı taşıyamaz. Tezgâhta aynı gerekçe yazılı.
 *
 * ## Zarf yüksekliği TÜRETİLİYOR
 *
 * `overallHeightM` en üstteki kasanın tepesi ile itme kolunun büyüğü;
 * ikisinden yalnız birine bağlamak ötekini çarpışma denetiminin dışında
 * bırakırdı. Alçak bir arabada kol en yüksek nokta.
 */
export const toteCartDefinition = {
  kind: 'warehouse:tote-cart',
  schemaVersion: 1,
  schema: ToteCartNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  defaults: () => {
    const { id: _id, type: _type, ...rest } = ToteCartNode.parse({})
    return { ...rest, name: 'Tote cart' }
  },

  tree: {
    // Eğimli raflı toplama arabası ile düz olan ayrı iki üründür; kat sayısı
    // da adda, çünkü iki fiş kat sayısıyla da ayrılıyor.
    label: treeLabel<ToteCartNode>(
      (node) => `${node.tilt ? 'Tilted ' : ''}Tote Cart · ${node.tiers} tiers`,
    ),
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
        const cart = node as unknown as ToteCartNode
        return {
          dimensions: [cartLengthM(cart), overallHeightM(cart), cartWidthM(cart)],
          rotation: cart.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    dragBounds: (node) => {
      const cart = node as unknown as ToteCartNode
      const height = overallHeightM(cart)
      return {
        size: [cartLengthM(cart), height, cartWidthM(cart)],
        centerY: height / 2,
      }
    },
  },

  parametrics: toteCartParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildToteCartFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place tote cart' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Tier count' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Tote Cart',
    description:
      'Order-picking trolley: a wheeled steel frame carrying one Euro tote per tier. Tier count, tote size and castors are set from the inspector; the overall height follows from them.',
    icon: { kind: 'iconify', name: 'lucide:shopping-cart' },
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      "Order-picking tote cart — a wheeled frame carrying **one Euro tote per tier**. **`height` is NOT a field**: the cart's overall height is computed upward from the totes (bottom tier 170 mm + tiers x (tote height + 30 mm clearance)), because storing it would let a user squeeze the pitch below the tote height and get totes passing through each other with no error. Five tiers of 220 mm totes come out at 1.40 m — about 10 cm under the 1.50 m the old app published, because that app fixed the height and spread the shelves over it (a 180 mm gap above each tote); this one stacks the totes and lets the height follow, the way real carts are sized. `toteFootprint` is `600x400` (ISO 3394 module, heights 75/120/170/220/270/320/420 mm from AUER's EG ladder) or `400x300` (KLT, heights 147/213/280 mm from VDA 4500) — the two ladders are NOT interchangeable, and asking for a height the chosen family does not publish snaps to the nearest and raises a warning. `tiers` 1-8, `loadedTiers` optionally fewer to draw a part-picked cart, `castorDiameter` 100/125/160 mm (load per castor 110/125/200 kg, Blickle TPA), `tilt` gives the trays a 15 degree pick angle, `hasHandle` toggles the push bar. Note that **no standard specifies any dimension of a manual trolley** — EN 1757 governs forces, brakes and stability only — so every cart figure here is a manufacturer's choice, cited where one publishes it. Dimensions are metres.",
  },
} satisfies NodeDefinition<typeof ToteCartNode>
