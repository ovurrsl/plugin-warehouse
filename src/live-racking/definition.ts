import type { NodeDefinition } from '@pascal-app/core'
import { buildLiveRackingFloorplan } from './floorplan'
import { bayWidthM, channelDepthM, frameHeightM } from './metrics'
import { liveRackingParametrics } from './parametrics'
import { LiveRackingNode } from './schema'

const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Mecalux Canlı Palet Rafı — bir yerçekimi kanalı sütunu.
 *
 * Selective rafla aynı yerleşim davranışı (bir düğüm bir bay, yan yana
 * dizilir) ama komşu MIKNATISI yok: canlı raf kanalları çerçeve
 * paylaşmıyor, her kanal kendi dikmelerini taşıyor.
 */
export const liveRackingDefinition = {
  kind: 'warehouse:live-rack',
  schemaVersion: 1,
  schema: LiveRackingNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // Kanalın bir yönü var: çıkış ucu operatörün durduğu yer.
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = LiveRackingNode.parse({})
    return { ...rest, name: 'Live Racking' }
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
        const live = node as unknown as LiveRackingNode
        return {
          dimensions: [bayWidthM(live), frameHeightM(live), channelDepthM(live)],
          rotation: live.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    dragBounds: (node) => {
      const live = node as unknown as LiveRackingNode
      const height = frameHeightM(live)
      return {
        size: [bayWidthM(live), height, channelDepthM(live)],
        centerY: height / 2,
      }
    },
  },

  parametrics: liveRackingParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  /**
   * Baked `/viewer` sözleşmesi — rafla ve öteki raf kind'larıyla aynı.
   *
   * Politikasız kind baked sahnede donmuş mesh olarak kalıyor: on kanallık bir
   * sıra on ayrı mesh, hepsi aynı şekli çiziyor. `replace` baked mesh'i
   * gizletip seviyenin kanallarını canlı statik instancing'le çizdiriyor, yani
   * sıra şekil başına tek çizim çağrısına iniyor. Eklenti yüklü değilse
   * politika `static`'e düşer ve baked mesh görünür kalır — veri kaybı yok.
   */
  bake: 'replace',
  bakeReplaceRenderer: { module: () => import('./bake-replace') },

  floorplan: buildLiveRackingFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place channel' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Pallets deep' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Live Pallet Racking',
    description:
      'A gravity-flow channel: pallets load at the high end and roll to the exit. FIFO or LIFO push-back, up to 30 pallets deep.',
    icon: { kind: 'iconify', name: 'lucide:chevrons-down' },
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'Mecalux live (gravity-flow) pallet racking — **one channel column**, not a block. A run is a line of these nodes side by side along their shared rotation, spaced one bay width apart; unlike selective racking they do NOT share frames. Depth runs along local +Z with the INLET high: pallets load at +Z and roll down to the exit at −Z at `gradient` (catalogue ~4%). `palletsDeep` is the channel depth in pallets (catalogue maximum 30), `levels` the stacked channels. Bay width is derived, not set: E = pallet face width + 160 mm, and roller length D = face width + 30 mm — both catalogue formulas. `variant` is FIFO (separate load and pick aisles) or LIFO push-back (one aisle, load and pick at the same end). `withRetainers` adds the pedal-operated pallet retainer and ~300 mm between pallets, which lengthens the channel. Brake rollers appear only when deeper than 2 pallets. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof LiveRackingNode>
