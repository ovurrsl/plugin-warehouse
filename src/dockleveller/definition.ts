import type { NodeDefinition } from '@pascal-app/core'
import { treeLabel } from '../tree-label'
import { buildDockLevellerFloorplan } from './floorplan'
import { aboveFloorHeightM, platformLengthM, widthM } from './metrics'
import { dockLevellerParametrics } from './parametrics'
import { DockLevellerNode } from './schema'

/** Rampa kapının içine oturuyor ve kapı duvarda: dört açı, ara adım yok. */
const SNAP_ANGLES = Array.from({ length: 4 }, (_, i) => (i * Math.PI) / 2)

/**
 * Yükleme rampası — depo kapısının çukuruna gömülü hidrolik köprü.
 *
 * ## Zarf neden bu kadar ince
 *
 * Makinenin gövdesi ZEMİNİN ALTINDA. `floorPlaced.footprint`'in yüksekliği
 * bu yüzden `aboveFloorHeightM`: dinlenmede tabla sacı kadar (12 mm), tabla
 * kalkınca burnunun yüksekliği kadar. Çerçevenin 585 mm'sini zarfa yazmak,
 * döşemenin içindeki bir hacmi çarpışma denetimine sokardı ve rampanın
 * üstünden geçen her şey — forklift rotası, palet, konveyör ayağı — çakışık
 * sayılırdı. Oysa rampanın ÜSTÜNDEN geçmek onun işi.
 *
 * ## İz dudağı içermiyor
 *
 * Açık dudak binanın dışında, dorsenin üstünde. İze katmak rampayı kapının
 * dışındaki her şeyle çarpıştırırdı, ve orada zaten bir tır var.
 */
export const dockLevellerDefinition = {
  kind: 'warehouse:dock-leveller',
  schemaVersion: 1,
  schema: DockLevellerNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  defaults: () => {
    const { id: _id, type: _type, ...rest } = DockLevellerNode.parse({})
    return { ...rest, name: 'Dock leveller' }
  },

  tree: {
    // Dudak türü ile platform boyu: iki fişi ayıran şey bu ikisi, ve ikisi de
    // sipariş edilen ürünün parçası.
    label: treeLabel<DockLevellerNode>(
      (node) =>
        `${node.lip === 'telescopic' ? 'Telescopic' : 'Hinged'} Dock Leveller · ${node.length} mm`,
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
        const leveller = node as unknown as DockLevellerNode
        return {
          dimensions: [platformLengthM(leveller), aboveFloorHeightM(leveller), widthM(leveller)],
          rotation: leveller.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    dragBounds: (node) => {
      const leveller = node as unknown as DockLevellerNode
      const height = aboveFloorHeightM(leveller)
      return {
        size: [platformLengthM(leveller), height, widthM(leveller)],
        centerY: height / 2,
      }
    },
  },

  parametrics: dockLevellerParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildDockLevellerFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place dock leveller' },
    { key: 'R / T', label: 'Rotate 90°' },
    { key: '[ / ]', label: 'Platform length' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Dock Leveller',
    description:
      'Pit-mounted hydraulic dock leveller: flush with the floor at rest, hinged or telescopic lip onto the trailer bed. Platform, lip, capacity and incline are all set from the inspector.',
    icon: { kind: 'iconify', name: 'lucide:import' },
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'Dock leveller — the pit-mounted hydraulic bridge at a loading door. **At rest (`inclination: 0`) the deck is flush with the finished floor and traffic drives over it**; the whole machine is below floor level and only the deck plate is visible. `inclination` runs −1 … +1 as a FRACTION of the published working range, not metres: positive is above dock, negative below, and the two are not symmetric (a 2.5 m platform reaches roughly +295 mm / −305 mm). `width` (1750/1830/2000/2110/2250 mm), `length` (2000…4500 mm, excluding the lip), `lipLength` (350/400/405/500 mm), `capacity` (60/80/100 kN) and `frameHeight` (585/700 mm) are catalogue options, not free numbers — the machine is built to the pit. `lip` chooses `hinged` (folds at the nose, hangs in its keeper at rest) or `telescopic` (slides from a pocket under the deck; `lipExtension` 0–1, maximum reach 1000 mm, or 785 mm on a 2000–2200 mm platform). The lip is always retracted at rest whatever `lipExtension` says. Dimensions are metres; the working-range figures come from Stertil’s published table and the 12.5% gradient limit from EN 1398.',
  },
} satisfies NodeDefinition<typeof DockLevellerNode>
