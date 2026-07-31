import type { AnyNode, NodeDefinition } from '@pascal-app/core'
import { displayNameOf, TRUCK_MODELS } from '../handling/models'
import { buildTruckFloorplan } from './floorplan'
import { mastRowOf, modelOf, overallHeightM, planLengthM, planWidthM } from './metrics'
import { truckParametrics } from './parametrics'
import { TruckNode } from './schema'

/** Sekiz açı, elle yazılmış — pallet'in dersi: türetilmiş liste 0'ı da −0'ı
 *  da düşürmüştü. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

function envelopeOf(node: AnyNode): { dims: [number, number, number] } {
  const truck = node as unknown as TruckNode
  const model = modelOf(truck.model)
  return {
    dims: [
      planLengthM(model),
      overallHeightM(model, mastRowOf(truck.mastRowId)),
      planWidthM(model),
    ],
  }
}

export const truckDefinition = {
  kind: 'warehouse:truck',
  schemaVersion: 1,
  schema: TruckNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // facingIndicator YOK: host yalnız ±Z sunuyor, aracın ileri yönü +X.
  // Yön bilgisini plan sembolünün kendi ok başı taşır (§4.4).

  defaults: () => {
    const { id: _id, type: _type, ...rest } = TruckNode.parse({})
    return { ...rest, name: displayNameOf(TRUCK_MODELS[rest.model]) }
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    /**
     * Kopya, görevini bırakır: iki aracın aynı paleti/rotayı/yuvayı talep
     * etmesi, kopyalanan filo değil çatışan filodur. `presettable: false`
     * aynı gerekçenin preset yüzü.
     */
    duplicable: {
      prepareSubtreeClone: ({ root }) => ({
        root: {
          ...root,
          routeId: null,
          routeAnchor: 0,
          duty: 'parked',
          carryingPalletId: null,
        } as unknown as AnyNode,
      }),
    },
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      footprint: (node) => ({
        dimensions: envelopeOf(node).dims,
        rotation: (node as unknown as TruckNode).rotation ?? [0, 0, 0],
      }),
      applies: () => true,
      /**
       * `collides: false` bir tercih değil: host'un testi plan dikdörtgenidir
       * ve Y'yi görmez — doğru park pozunda bir aracın ÇATALLARI RAFIN
       * İÇİNDEDİR. Plan testi o pozu reddederdi. 3B doğruluk `clash.ts`'te,
       * konveyörün yaptığının aynısı.
       */
      collides: false,
    },

    dragBounds: (node) => {
      const { dims } = envelopeOf(node)
      return { size: dims, centerY: dims[1] / 2 }
    },

    hostRefFields: ['supportSlabId', 'routeId'],
    presettable: false,
  },

  parametrics: truckParametrics,

  // Pallet'in gerekçesiyle custom renderer: geometri modül seviyesi paylaşımlı
  // tekil, `<GeometrySystem>` yeniden inşada onu dispose ederdi.
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  /**
   * Filo, sahne başına BİR kez — `def.system` kind başına render edilir,
   * düğüm başına değil. Konveyörün akış sistemiyle aynı sözleşme; öncelik
   * onunkinden (5) sonra, ikisi de bağımsız.
   */
  system: { module: () => import('./fleet-system'), priority: 6 },

  floorplan: buildTruckFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place truck' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Handling truck',
    description:
      'Hand and electric pallet trucks, an electric forklift, a reach truck and a turret truck — each with its published aisle figures.',
    icon: { kind: 'iconify', name: 'lucide:forklift' },
    // Pallet'in gerekçesi: kind bu eklentinin kataloğundan erişilir, host'un
    // Build paletinden değil.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'A warehouse handling truck. `model` selects the machine (mpt = hand pallet truck, ept = electric pallet truck, forklift, rt = reach truck, tt = turret truck); every dimension is read from the catalogue, none is stored on the node. `referenceLoad` picks which published VDI aisle figure is quoted. `forkHeight` is the parked fork elevation in metres. Duty, route and slot fields are data for the fleet simulation and default to parked.',
  },
} satisfies NodeDefinition<typeof TruckNode>
