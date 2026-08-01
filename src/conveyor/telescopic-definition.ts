import type { NodeDefinition } from '@pascal-app/core'
import { snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'
import { TELESCOPIC_MODELS } from './telescopic-catalog'
import { buildTelescopicFloorplan } from './telescopic-floorplan'
import {
  currentLengthM,
  footprintCenterX,
  frameWidthM,
  telescopicModelOf,
} from './telescopic-metrics'
import { conveyorTelescopicParametrics } from './telescopic-parametrics'
import { ConveyorTelescopicNode } from './telescopic-schema'

const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Teleskopik bant konveyör.
 *
 * Ailenin diğer şekillerinden üç farkı var ve üçü de kasıtlı:
 *
 * - **Tek port, kuyrukta.** Bir zamanlar hiç port yoktu ("uç makinedir")
 *   ve sonuç, kuyruğundan bir hatta bağlanamamasıydı — oysa bu makinenin
 *   kuyruğu tam da bir hatta beslenir. Şimdi sabit uç port taşıyor, uzayan
 *   bom ucu taşımıyor: orası dorsenin içine giren uç.
 * - **`distributionRole` YOK.** Bağlı hat sürüklendiğinde teleskopik
 *   YERİNDE kalır (kullanıcı kararı). Bu bir uç makinesi: rampaya
 *   sabitlenir, hat ona gelir. Rol bildirmek onu host'un bağlantı-takip
 *   analizine sokar ve 60 metrelik bir hattın peşine takardı.
 * - **Taban izi uzamayla büyür.** `footprint` anlık boyu okur; kapalı bir
 *   bomun yeri A, açık bomunki C'dir ve ikisi arasındaki fark rampanın
 *   önündeki manevra alanının ta kendisidir.
 */
export const conveyorTelescopicDefinition = {
  kind: 'warehouse:conveyor-telescopic',
  schemaVersion: 1,
  schema: ConveyorTelescopicNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // Boşaltma ucu +X — ama host'un facing göstergesi ±Z'ye kilitli, bu yüzden
  // yön bilgisini plan sembolünün kendi oku taşır (aracın §4.4 kuralı).

  defaults: () => {
    const { id: _id, type: _type, ...rest } = ConveyorTelescopicNode.parse({})
    return { ...rest, name: `Telescopic ${TELESCOPIC_MODELS[rest.model].label}` }
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      /**
       * Ailenin port mıknatısı — diğer altı modülün birebir aynısı.
       *
       * Bu kanca YOKTU ve mıknatısın hiç çağrılmamasının üç bağımsız
       * sebebinden biriydi (diğer ikisi: `ports` bildirilmemesi ve
       * `CONVEYOR_KINDS` setinde bulunmaması). Host `groupMoveSnap`'i
       * okuyamayınca hizalama dalına hiç girmiyordu.
       */
      groupMoveSnap: ({ node, candidatePosition, movingIds, nodes }) => {
        const tele = node as unknown as ConveyorTelescopicNode
        return snapToLineEnd(
          tele,
          candidatePosition,
          tele.rotation?.[1] ?? 0,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        )
      },
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },

    floorPlaced: {
      footprint: (node) => {
        const tele = node as unknown as ConveyorTelescopicNode
        return {
          dimensions: [
            currentLengthM(tele),
            telescopicModelOf(tele.model).heightM,
            frameWidthM(tele),
          ],
          rotation: tele.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      /**
       * Kapalı: host'un testi plan dikdörtgenidir ve Y görmez — uzamış bir
       * bom rampanın/aracın üstüne uzanır ve o poz doğrudur. 3B doğruluk
       * `clash.ts`'te, ailenin geri kalanının yaptığının aynısı.
       */
      collides: false,
    },

    dragBounds: (node) => {
      const tele = node as unknown as ConveyorTelescopicNode
      const height = telescopicModelOf(tele.model).heightM + 0.12
      return {
        size: [currentLengthM(tele), height, frameWidthM(tele)],
        // Taban izi uzamayla ÖNE kayar: merkez artık origin değil.
        center: [footprintCenterX(tele), height / 2, 0],
      }
    },
  },

  parametrics: conveyorTelescopicParametrics,

  /**
   * Tek port, kuyrukta — `localPorts` orada tek bir giriş üretiyor.
   *
   * `distributionRole` bilinçli olarak YOK: host'un bağlantı-takip analizi
   * yalnız `'run'` ya da `'fitting'` bildiren kind'ları aday alıyor, yani
   * teleskopik bağlı bir hat sürüklendiğinde yerinde kalıyor. Bu bir uç
   * makinesi — rampaya sabitlenir, hat ona gelir.
   */
  ports: conveyorPorts,

  renderer: {
    kind: 'parametric',
    module: () => import('./telescopic-renderer'),
  },

  floorplan: buildTelescopicFloorplan,

  tool: () => import('./telescopic-tool'),

  toolHints: [
    { key: 'Left click', label: 'Place telescopic conveyor' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Retract / extend boom' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Telescopic Belt Conveyor',
    description:
      'A truck-loading boom: a fixed body whose belt telescopes into the trailer. Ten catalogue models, 14–25 m fully extended.',
    icon: { kind: 'iconify', name: 'lucide:move-horizontal' },
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'A telescopic belt conveyor — the truck/container loading boom. `model` selects a catalogue row (A3–A6 series): **A** is the fixed body, **B** the telescoping extension, **C = A + B** the fully extended length, and the belt height is a property of the model ("Fixed Type" — it is not adjustable). `extension` is a 0–1 ratio, not metres, so it keeps its meaning when the model changes; the footprint grows with it, which is the whole point of the machine on a layout. `beltWidth` is 600/800/1000 mm. Belt speed, capacity and motor power are NOT published in this table — the box animation runs on a labelled 0.4 m/s estimate and is visualisation only. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof ConveyorTelescopicNode>
