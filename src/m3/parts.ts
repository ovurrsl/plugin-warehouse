import {
  crossBraceSets,
  crossTieCount,
  dividerDepth,
  dividerHeightAt,
  doorHeight,
  drawerCount,
  drawerDepthM,
  drawerHeightM,
  drawerWidthM,
  fittedLevels,
  frameCentersX,
  levelElevation,
  UPRIGHT_SECTION,
} from './bays'
import type { M3Level, M3ShelvingNode } from './schema'
import {
  BACK_PANEL_THICKNESS,
  CROSS_BRACE_SECTION,
  CROSS_TIE_SECTION,
  DIVIDER_THICKNESS,
  DOOR_LEAF_THICKNESS,
  DOOR_LEAVES,
  FOOTPLATE_THICKNESS,
  FRAME_VARIANTS,
  SHELF_MODELS,
  SHELF_SUPPORT_SIZE,
} from './standards'

/**
 * Every piece of steel, sheet and plastic in an M3 bay, as a list of boxes.
 *
 * One list, three consumers: the 3D builder extrudes it, the floorplan projects
 * it, the tests measure it.
 *
 * ## Orientation
 *
 * **+Z is the picking face, −Z the back** — the convention `drivein/schema.ts`
 * states and this package follows throughout. It is why the back panel sits at
 * −Z and the doors hang at +Z, and getting it backwards would put the doors
 * against the wall.
 *
 * ## The trap this file inherits
 *
 * A shelf sized to the bay PITCH would run frame-centre to frame-centre and
 * bury half an upright at each end. Every span here is the CLEAR length.
 */

export type M3PartRole =
  | 'upright'
  | 'footplate'
  | 'cross-tie'
  | 'frame-diagonal'
  | 'frame-panel'
  | 'shelf'
  | 'shelf-support'
  | 'brace'
  | 'back-panel'
  | 'divider'
  | 'drawer'
  | 'door-leaf'
  | 'door-beam'

export type M3Part = {
  role: M3PartRole
  center: [number, number, number]
  size: [number, number, number]
  tiltX?: number
  tiltZ?: number
  pattern?: 'slots' | 'mesh'
  /** Which shelf model this panel is, so the builder can shade the heavier
   *  gauge apart without asking the node a second time. */
  shelfModel?: M3Level['model']
}

export type M3Detail = 'full' | 'simple'

export type FrameOmission = { omitRight: boolean }

/**
 * ASSUMPTION. Sheet thickness of a frame infill panel, across the frame plane.
 */
const FRAME_PANEL_THICKNESS = 0.004

export function m3Parts(
  bay: M3ShelvingNode,
  detail: M3Detail = 'full',
  omission: FrameOmission = { omitRight: false },
): M3Part[] {
  const parts: M3Part[] = []
  const [leftX, rightX] = frameCentersX(bay)
  const lines = omission.omitRight ? [leftX] : [leftX, rightX]
  const { width: postWidth, depth: postDepth } = UPRIGHT_SECTION
  const postZ = [-bay.shelfDepth / 2 + postDepth / 2, bay.shelfDepth / 2 - postDepth / 2]
  const innerDepth = Math.max(0.05, bay.shelfDepth - postDepth)
  const variant = FRAME_VARIANTS[bay.frameVariant]

  // ── Frames ────────────────────────────────────────────────────────────────
  //
  // Two posts per frame line. The 25 mm perforations are texture, not geometry:
  // a 2 m upright punched at 25 mm is eighty slots per face, and drawing them
  // as boxes would outweigh the whole rest of the bay.
  for (const x of lines) {
    for (const z of postZ) {
      parts.push({
        role: 'upright',
        center: [x, bay.frameHeight / 2, z],
        size: [postWidth, bay.frameHeight, postDepth],
        pattern: 'slots',
      })
      parts.push({
        role: 'footplate',
        center: [x, FOOTPLATE_THICKNESS / 2, z],
        size: [postWidth * 1.8, FOOTPLATE_THICKNESS, postDepth * 1.6],
      })
    }

    // CATALOG: at least two cross-ties per frame; a taller frame takes a third
    // at mid-height. The count is derived from the height, so a frame raised
    // past the threshold grows one without anyone ticking a box.
    const ties = crossTieCount(bay)
    for (let index = 0; index < ties; index++) {
      const fraction = ties === 1 ? 0.5 : 0.06 + (index / (ties - 1)) * 0.88
      parts.push({
        role: 'cross-tie',
        center: [x, bay.frameHeight * fraction, 0],
        size: [CROSS_TIE_SECTION, CROSS_TIE_SECTION, innerDepth],
      })
    }

    if (variant.diagonal && detail === 'full') {
      const rise = bay.frameHeight * 0.85
      parts.push({
        role: 'frame-diagonal',
        center: [x, bay.frameHeight / 2, 0],
        size: [CROSS_TIE_SECTION * 0.8, CROSS_TIE_SECTION * 0.8, Math.hypot(innerDepth, rise)],
        tiltX: Math.atan2(rise, innerDepth),
      })
    }

    if (variant.infill) {
      /**
       * A sheet or mesh panel in the frame's own plane.
       *
       * The **mesh** variant carries the atlas's punched column rather than its
       * wire-deck column, and that is a considered substitution: the deck
       * pattern is authored for a horizontal surface — it maps U across the
       * depth and V along the run, both of which collapse on a panel that is
       * millimetres thick in X. The punched column reads as a perforated
       * vertical sheet from any angle a layout is worked at, and the real
       * 50 × 50 mm weld grid is reported in the panel instead of drawn.
       */
      const coverage = variant.infill.coverage === 'central' ? 0.5 : 0.9
      parts.push({
        role: 'frame-panel',
        center: [x, bay.frameHeight / 2, 0],
        size: [FRAME_PANEL_THICKNESS, bay.frameHeight * coverage, innerDepth],
        pattern: variant.infill.pattern === 'mesh' ? 'slots' : undefined,
      })
    }
  }

  // ── Levels ────────────────────────────────────────────────────────────────
  const levels = fittedLevels(bay)
  levels.forEach((level, index) => {
    const surface = levelElevation(level)
    const shelf = SHELF_MODELS[level.model]

    parts.push({
      role: 'shelf',
      center: [0, surface - shelf.thickness / 2, 0],
      size: [bay.shelfLength, shelf.thickness, bay.shelfDepth],
      shelfModel: level.model,
    })

    // CATALOG names the shelf support as a basic component; four per shelf,
    // hooked into the upright's side slots. Full tier only — four boxes per
    // level per bay, each a few centimetres across.
    if (detail === 'full') {
      /**
       * Taşıyıcılar HER İKİ çerçeve çizgisinde — `lines` değil.
       *
       * Braket çerçevenin değil RAFIN parçası: paylaşılan çerçeveye takılıp
       * BU gözün rafını taşıyor, komşununkini değil. `lines` üzerinde
       * dönerken sıraya eklenen her göz dört rafını yalnız sol uçtan braketli
       * çiziyordu — rafın sağ ucu havada duruyordu. Çerçeve paylaşımı
       * dikme, taban plakası ve kuşak için geçerli; kata ait bağlantı
       * elemanları için değil.
       */
      for (const x of frameCentersX(bay)) {
        for (const sign of [-1, 1] as const) {
          parts.push({
            role: 'shelf-support',
            center: [
              x +
                (x < 0 ? postWidth : -postWidth) / 2 +
                ((x < 0 ? 1 : -1) * SHELF_SUPPORT_SIZE) / 2,
              surface - shelf.thickness / 2,
              sign * (bay.shelfDepth / 2 - postDepth),
            ],
            size: [SHELF_SUPPORT_SIZE, shelf.thickness * 1.4, SHELF_SUPPORT_SIZE],
          })
        }
      }
    }

    if (level.structure === 'drawers') {
      parts.push(...drawerGrid(bay, level, surface))
      return
    }

    // Dividers stand on the shelf, spaced across it. The height is the tallest
    // published divider that fits the opening above — derived, so lowering the
    // shelf above cannot leave a divider taller than the gap.
    const dividerHeight = dividerHeightAt(bay, index)
    if (dividerHeight !== null && detail === 'full') {
      const count = level.dividers
      const depth = dividerDepth(bay)
      for (let slot = 1; slot <= count; slot++) {
        parts.push({
          role: 'divider',
          center: [
            -bay.shelfLength / 2 + (bay.shelfLength * slot) / (count + 1),
            surface + dividerHeight / 2,
            bay.shelfDepth / 2 - depth / 2,
          ],
          size: [DIVIDER_THICKNESS, dividerHeight, depth],
        })
      }
    }
  })

  // ── Down-aisle bracing ────────────────────────────────────────────────────
  //
  // CATALOG: one set up to 2.5 m, two above it, none behind a back panel. The
  // count is derived from the height and the panel — see `crossBraceSets` — so
  // the steel and the rule cannot drift apart.
  const braceSets = crossBraceSets(bay)
  if (braceSets > 0 && detail === 'full') {
    /**
     * Çapraz arka dikmelerin ARKA yüzüne cıvatalanır ve gözün arkasında kalır.
     *
     * `-shelfDepth/2 + postDepth` onu arka dikmenin ÖN yüzüne koyuyordu, yani
     * rafın derinlik ayak izinin tam içine: 18 mm'lik çubuk dört katın hepsini
     * kesiyordu. Sayılar örtüşmeyi kanıtlıyor — çapraz Z ∈ [−0,169, −0,151],
     * raf paneli Z ∈ [−0,200, +0,200].
     */
    const zRear = -bay.shelfDepth / 2 - CROSS_BRACE_SECTION / 2
    for (let set = 0; set < braceSets; set++) {
      const bandBottom = (bay.frameHeight * set) / braceSets
      const bandHeight = bay.frameHeight / braceSets
      const rise = bandHeight * 0.86
      const angle = Math.atan2(rise, bay.shelfLength)
      for (const direction of [1, -1] as const) {
        parts.push({
          role: 'brace',
          center: [0, bandBottom + bandHeight / 2, zRear],
          size: [Math.hypot(bay.shelfLength, rise), CROSS_BRACE_SECTION, CROSS_BRACE_SECTION],
          tiltZ: direction * angle,
        })
      }
    }
  }

  // ── Back panel ────────────────────────────────────────────────────────────
  if (bay.backPanel !== 'none') {
    parts.push({
      role: 'back-panel',
      center: [0, bay.frameHeight / 2, -bay.shelfDepth / 2 + postDepth + BACK_PANEL_THICKNESS / 2],
      size: [bay.shelfLength, bay.frameHeight, BACK_PANEL_THICKNESS],
      pattern: bay.backPanel === 'mesh' ? 'slots' : undefined,
    })
  }

  // ── Doors ─────────────────────────────────────────────────────────────────
  //
  // Drawn wherever the user asked for them, including on a bay length the
  // catalogue does not sell them for. The panel reports the mismatch; silently
  // dropping the door would leave the user believing they had one.
  const door = doorHeight(bay)
  if (door !== null) {
    const zFront = bay.shelfDepth / 2 - DOOR_LEAF_THICKNESS / 2
    const leafWidth = bay.shelfLength / DOOR_LEAVES
    const clear = Math.max(0, door - CROSS_TIE_SECTION * 2)
    for (let leaf = 0; leaf < DOOR_LEAVES; leaf++) {
      parts.push({
        role: 'door-leaf',
        center: [
          -bay.shelfLength / 2 + leafWidth * (leaf + 0.5),
          CROSS_TIE_SECTION + clear / 2,
          zFront,
        ],
        size: [leafWidth * 0.98, clear, DOOR_LEAF_THICKNESS],
      })
    }
    // CATALOG: the door set includes a top and a bottom beam.
    for (const y of [CROSS_TIE_SECTION / 2, door - CROSS_TIE_SECTION / 2]) {
      parts.push({
        role: 'door-beam',
        center: [0, y, zFront],
        size: [bay.shelfLength, CROSS_TIE_SECTION, DOOR_LEAF_THICKNESS],
      })
    }
  }

  return parts
}

/**
 * The drawer grid on a level.
 *
 * The count is `floor(clear length / drawer width)` and is not a field: the
 * catalogue's two published rows — 4 or 8 in a 1,000 mm level, 5 or 10 in a
 * 1,250 mm one — are exactly that division, which means the same rule answers
 * for the lengths it does not list and for a bay cut to fit a wall.
 */
function drawerGrid(bay: M3ShelvingNode, level: M3Level, surface: number): M3Part[] {
  const parts: M3Part[] = []
  const count = drawerCount(bay, level)
  if (count <= 0) return parts

  const width = drawerWidthM(level)
  const height = drawerHeightM(level)
  const depth = drawerDepthM(bay)
  // Centred as a block, so a level whose length is not an exact multiple of the
  // drawer width leaves an equal margin at both ends rather than a gap on one.
  const span = count * width
  let cursor = -span / 2

  for (let index = 0; index < count; index++) {
    parts.push({
      role: 'drawer',
      center: [cursor + width / 2, surface + height / 2, bay.shelfDepth / 2 - depth / 2],
      size: [width * 0.96, height, depth],
    })
    cursor += width
  }

  return parts
}
