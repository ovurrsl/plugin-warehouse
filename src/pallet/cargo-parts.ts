import type { CargoRegionId } from './cargo-atlas-regions'
import {
  CARGO_COLORS,
  CARGO_PALETTE,
  type CargoColorId,
  CORNER_BOARD_M,
  CORNER_BOARD_MIN_FILL,
  CORNER_BOARD_THICKNESS_M,
  LABEL_M,
  LABEL_OFFSET_M,
  STRAP_OFFSET_M,
  STRAP_POSITIONS,
  STRAP_THICKNESS_M,
  STRAP_WIDTH_M,
} from './cargo-constants'
import {
  CARGO_TYPES,
  type CargoType,
  cargoHeightM,
  resolveVariant,
  unitCount,
  unitsPerLayer,
} from './cargo-types'
import type { PalletPreset } from './presets'
import type { PalletNode } from './schema'

/**
 * Everything a loaded pallet is made of, as plain data.
 *
 * Split from the builder for the reason the rack and the conveyor split theirs:
 * this half is arithmetic and can be tested without a canvas, a WebGL context or
 * a browser, and it is the half where the mistakes are. A part list is checkable
 * against a triangle budget, against a footprint, and against the rule below —
 * the merged buffer it turns into is not.
 *
 * Y is measured from **the top of the pallet deck**, not from the floor, so the
 * same list describes a load standing on a deck and one standing on the ground.
 */

export type CargoDetail = 'full' | 'simple'

export type CargoPartKind = 'carton' | 'drum' | 'drumLid' | 'strap' | 'cornerBoard' | 'label'

/** Which of a box's six faces to emit. */
export type FaceSet = {
  px: boolean
  nx: boolean
  py: boolean
  ny: boolean
  pz: boolean
  nz: boolean
}

export type CargoPart = {
  kind: CargoPartKind
  shape: 'box' | 'cylinder'
  /** Centre in metres, relative to the top of the deck. */
  center: readonly [number, number, number]
  /** Full extent in metres. A cylinder reads `[diameter, height, diameter]`. */
  size: readonly [number, number, number]
  /** On a cylinder only `py` and `ny` are read; the shell is always drawn. */
  faces: FaceSet
  sideRegion: CargoRegionId
  topRegion: CargoRegionId
  color: string
  /**
   * Split the four side faces into this many stacked bands, each mapping the
   * side region once.
   *
   * The far tier's whole stack is one box, and one box gets one copy of the
   * carton row — four cartons across and, whatever the fill, exactly one layer
   * tall. An atlas region cannot tile, because tiling addresses the sheet
   * outside the region. Cutting the face into bands instead costs two triangles
   * per layer per face and keeps the layer count readable, which is the thing
   * the tier exists to preserve.
   */
  vRepeat?: number
}

export type CargoInput = {
  type: CargoType
  preset: PalletPreset
  /** Already resolved from the node's id — see `./cargo-types`. */
  variant: number
  detail: CargoDetail
  strapped: boolean
  labelled: boolean
  /** The goods' own colour, from the prepared set. Hardware keeps the palette's. */
  color: CargoColorId
}

const ALL_FACES: FaceSet = { px: true, nx: true, py: true, ny: true, pz: true, nz: true }

/**
 * What a node is carrying, in the form the builder wants — or `null` for the
 * plain block a pallet has always been able to hold.
 *
 * **The one place a node becomes a load.** The fill is resolved here, from the
 * node's own id, so the renderer, the preview and the placement check all ask
 * the same question and get the same answer. Resolving it at each call site is
 * how a ghost ends up a different height from the pallet it commits to.
 */
export function cargoInputOf(node: PalletNode, detail: CargoDetail): CargoInput | null {
  if (node.cargo === 'none') return null
  const type = CARGO_TYPES[node.cargo]
  return {
    type,
    preset: node.preset,
    variant: resolveVariant(type, node.id, node.fillRange),
    detail,
    strapped: node.strapped,
    labelled: node.labelled,
    color: node.cargoColor,
  }
}

/** The block the goods occupy: `[along X, height, along Z]`, metres. */
export function loadExtent(input: CargoInput): readonly [number, number, number] {
  const { type, preset, variant } = input
  const height = cargoHeightM(type, variant)
  if (type.fill === 'layers') {
    const perLayer = unitsPerLayer(type, preset)
    return [perLayer.alongX * type.unitM[0], height, perLayer.alongZ * type.unitM[2]]
  }
  const count = unitCount(type, preset, variant)
  return [count * type.unitM[0], height, type.unitM[2]]
}

/** Layers a variant resolves to. Both tiers need it — one to stack boxes, the
 *  other to band the far tier's single face — and deriving it twice is how the
 *  two tiers end up disagreeing about how tall the load is. */
function layerCount(input: CargoInput): number {
  return Math.max(1, Math.round(input.variant * input.type.variants.length))
}

/**
 * The cartons, as a solid block with **its interior faces never built.**
 *
 * A full Euro pallet is forty cartons; drawn as forty boxes that is 240 quads
 * and 480 triangles. Of those quads 164 face another carton and 8 face the deck
 * — 172 that nothing can ever see from anywhere. Emitting only the block's
 * boundary leaves 68 quads and **136 triangles against 480**, under a third of
 * the cost and the single largest saving available anywhere in this kind.
 *
 * ## Why the cartons touch
 *
 * Removing an interior face is only safe if nothing can see through to where it
 * was, so the cartons are built flush rather than with a modelled gap between
 * them. A 4 mm gap would be sub-pixel past a couple of metres — it would not
 * read as a seam at the distance that matters — but it *would* be a hole with a
 * culled backface behind it, so a stack would go transparent in slots when
 * viewed from the side.
 *
 * The seams come from the texture instead: `cartonFace` carries a shaded rim
 * several per cent of its width, which survives the same distance a 4 mm gap
 * does not. That is why the atlas draws them, and it is what makes this
 * optimisation free rather than a trade.
 */
function cartonParts(input: CargoInput): CargoPart[] {
  const { type, preset } = input
  const color = CARGO_COLORS[input.color]
  const perLayer = unitsPerLayer(type, preset)
  const layers = layerCount(input)
  const [cellX, cellY, cellZ] = type.unitM
  const parts: CargoPart[] = []

  for (let ix = 0; ix < perLayer.alongX; ix++) {
    for (let iz = 0; iz < perLayer.alongZ; iz++) {
      for (let iy = 0; iy < layers; iy++) {
        parts.push({
          kind: 'carton',
          shape: 'box',
          center: [
            (ix - (perLayer.alongX - 1) / 2) * cellX,
            (iy + 0.5) * cellY,
            (iz - (perLayer.alongZ - 1) / 2) * cellZ,
          ],
          size: [cellX, cellY, cellZ],
          faces: {
            px: ix === perLayer.alongX - 1,
            nx: ix === 0,
            pz: iz === perLayer.alongZ - 1,
            nz: iz === 0,
            py: iy === layers - 1,
            // The bottom layer stands on the deck. Seeing it would mean looking
            // up through the deck's own board gaps from under the pallet.
            ny: false,
          },
          // Taped faces deterministically scattered rather than every carton
          // sealed identically, which is the "one box copied" look again.
          sideRegion: (ix + iy * 2 + iz * 3) % 3 === 0 ? 'cartonFaceTaped' : 'cartonFace',
          topRegion: 'cartonTop',
          color,
        })
      }
    }
  }
  return parts
}

/**
 * The drums: a shell for the body and a short one for the head.
 *
 * Two parts rather than one because the head is a different surface — pressed
 * rings and two bungs, seen from above where the body never is. The body's own
 * caps are dropped: the top is under the head and the bottom is on the deck.
 */
function drumParts(input: CargoInput): CargoPart[] {
  const { type, preset, variant } = input
  const color = CARGO_COLORS[input.color]
  const count = unitCount(type, preset, variant)
  const [diameter, height] = type.unitM
  const lidHeight = height * 0.035
  const parts: CargoPart[] = []

  for (let index = 0; index < count; index++) {
    const x = (index - (count - 1) / 2) * diameter
    parts.push({
      kind: 'drum',
      shape: 'cylinder',
      center: [x, height / 2, 0],
      size: [diameter, height, diameter],
      faces: { ...ALL_FACES, py: false, ny: false },
      sideRegion: 'drumBody',
      topRegion: 'drumLid',
      color,
    })
    parts.push({
      kind: 'drumLid',
      shape: 'cylinder',
      center: [x, height - lidHeight / 2, 0],
      size: [diameter, lidHeight, diameter],
      faces: { ...ALL_FACES, py: true, ny: false },
      sideRegion: 'drumBody',
      topRegion: 'drumLid',
      color: CARGO_PALETTE.drumLid,
    })
  }
  return parts
}

/**
 * Two bands over the load — up one side, across the top, down the other.
 *
 * Not wrapped underneath: a strap that passed under the deck would cut through
 * the pallet's own boards, and the real thing is threaded through the void
 * between them or not at all.
 */
function strapParts(extent: readonly [number, number, number]): CargoPart[] {
  const [loadX, loadY, loadZ] = extent
  const stand = STRAP_OFFSET_M + STRAP_THICKNESS_M / 2
  const parts: CargoPart[] = []

  for (const fraction of STRAP_POSITIONS) {
    const x = (fraction - 0.5) * loadX
    parts.push({
      kind: 'strap',
      shape: 'box',
      center: [x, loadY + stand, 0],
      size: [STRAP_WIDTH_M, STRAP_THICKNESS_M, loadZ + stand * 2],
      faces: ALL_FACES,
      sideRegion: 'strap',
      topRegion: 'strap',
      color: CARGO_PALETTE.strapGreen,
    })
    for (const side of [-1, 1]) {
      parts.push({
        kind: 'strap',
        shape: 'box',
        center: [x, loadY / 2, side * (loadZ / 2 + stand)],
        size: [STRAP_WIDTH_M, loadY, STRAP_THICKNESS_M],
        faces: ALL_FACES,
        sideRegion: 'strap',
        topRegion: 'strap',
        color: CARGO_PALETTE.strapGreen,
      })
    }
  }
  return parts
}

/**
 * Kraft L-profiles up the four vertical corners.
 *
 * They sit **under** the straps, which is the order they are fitted in: the
 * boards go on to stop the strap crushing the corner, then the strap goes over
 * them. Drawn the other way round the load looks like it was assembled by
 * someone who had never seen one.
 */
function cornerBoardParts(extent: readonly [number, number, number]): CargoPart[] {
  const [loadX, loadY, loadZ] = extent
  const thickness = CORNER_BOARD_THICKNESS_M
  const parts: CargoPart[] = []

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cornerX = (sx * loadX) / 2
      const cornerZ = (sz * loadZ) / 2
      parts.push({
        kind: 'cornerBoard',
        shape: 'box',
        center: [cornerX - (sx * CORNER_BOARD_M) / 2, loadY / 2, cornerZ + (sz * thickness) / 2],
        size: [CORNER_BOARD_M, loadY, thickness],
        faces: ALL_FACES,
        sideRegion: 'cornerBoard',
        topRegion: 'cornerBoard',
        color: CARGO_PALETTE.kraft,
      })
      parts.push({
        kind: 'cornerBoard',
        shape: 'box',
        center: [cornerX + (sx * thickness) / 2, loadY / 2, cornerZ - (sz * CORNER_BOARD_M) / 2],
        size: [thickness, loadY, CORNER_BOARD_M],
        faces: ALL_FACES,
        sideRegion: 'cornerBoard',
        topRegion: 'cornerBoard',
        color: CARGO_PALETTE.kraft,
      })
    }
  }
  return parts
}

/** One quad on the +X face — the only part here that is a single triangle pair. */
function labelPart(extent: readonly [number, number, number]): CargoPart {
  const [loadX, loadY] = extent
  const [labelWidth, labelHeight] = LABEL_M
  return {
    kind: 'label',
    shape: 'box',
    center: [loadX / 2 + LABEL_OFFSET_M, Math.min(loadY * 0.55, loadY - labelHeight / 2), 0],
    size: [0, labelHeight, labelWidth],
    faces: { ...ALL_FACES, px: true, nx: false, py: false, ny: false, pz: false, nz: false },
    sideRegion: 'label',
    topRegion: 'label',
    color: CARGO_PALETTE.labelWhite,
  }
}

/**
 * The whole load.
 *
 * At `simple` the goods collapse to one box wearing the carton-row texture and
 * every detail is dropped. That is not only a triangle saving: **it is what
 * keeps the detail flags out of the far tier's cache key.** A flag that cannot
 * move a vertex at a tier must not be named in that tier's key, or dragging it
 * mints a second buffer byte-identical to the first — the same mistake the
 * conveyor's guides made, found by a sweep rather than by eye.
 */
export function cargoParts(input: CargoInput): CargoPart[] {
  const extent = loadExtent(input)
  const [loadX, loadY, loadZ] = extent

  if (input.detail === 'simple') {
    const cartons = input.type.fill === 'layers'
    return [
      {
        kind: cartons ? 'carton' : 'drum',
        shape: cartons ? 'box' : 'cylinder',
        center: [0, loadY / 2, 0],
        size: [loadX, loadY, loadZ],
        faces: { ...ALL_FACES, ny: false },
        sideRegion: cartons ? 'cartonRow' : 'drumBody',
        topRegion: cartons ? 'cartonTop' : 'drumLid',
        color: CARGO_COLORS[input.color],
        vRepeat: cartons ? layerCount(input) : 1,
      },
    ]
  }

  const parts = input.type.fill === 'layers' ? cartonParts(input) : drumParts(input)

  if (input.strapped) parts.push(...strapParts(extent))
  if (input.type.defaults.cornerBoards && input.variant >= CORNER_BOARD_MIN_FILL) {
    parts.push(...cornerBoardParts(extent))
  }
  if (input.labelled) parts.push(labelPart(extent))

  return parts
}

/** Triangles a part list will produce. Counted here so a budget can be asserted
 *  without building a buffer. */
export function triangleCount(parts: readonly CargoPart[], radialSegments: number): number {
  let total = 0
  for (const part of parts) {
    if (part.shape === 'cylinder') {
      total += radialSegments * 2
      if (part.faces.py) total += radialSegments
      if (part.faces.ny) total += radialSegments
      continue
    }
    for (const on of Object.values(part.faces)) if (on) total += 2
  }
  return total
}
