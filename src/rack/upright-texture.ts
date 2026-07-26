import * as THREE from 'three'

/**
 * A three-column atlas: blank, the upright's punched slot pattern, and a wire
 * deck's grid.
 *
 * The atlas is what keeps the whole rack on **one** material. Each pattern is
 * only on some parts, so the obvious build is a material per pattern — which
 * multiplies the draw calls, and at a thousand racks that is the difference
 * between one thing to draw per rack and three. Instead the geometry steers each
 * part's UVs into one column, and a single material serves them all. Adding a
 * column costs a UV constant and nothing else, which is the only reason a wire
 * deck could be made to look like a wire deck: modelling the mat as geometry
 * would be a few thousand boxes per bay.
 *
 * Geometry never touches this file: the builder only writes UV numbers, which
 * is pure maths and runs in the test environment. Creating a canvas needs
 * `document`, so this is reached solely from the material, which is itself only
 * loaded by the lazy renderer — the manifest barrel stays SSR-safe.
 */

/**
 * One tile is one pattern pitch tall — 50 mm of post for the slot column, 100 mm
 * of deck for the mesh column — because V repeats once per pitch in both cases.
 *
 * 128 rather than the 64 the slots alone needed: a grid of eleven wires has to
 * resolve, and a punched slot loses nothing by being drawn at twice the size.
 */
const TILE = 128
const WIDTH = TILE * 3

/**
 * Wires across one tile of the mesh column.
 *
 * Ten cells, so the tile is a 10 x 10 grid at a 100 mm pitch — the spacing a
 * catalogue wire deck actually uses. Eleven wires, because both edges are drawn:
 * a half-wire at each boundary is what makes the tile repeat seamlessly instead
 * of leaving a double-width gap at every seam.
 */
const MESH_CELLS = 10

let cached: THREE.Texture | null = null

export function getRackUprightTexture(): THREE.Texture {
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = TILE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('[warehouse:pallet-rack] 2D canvas unavailable for the rack atlas')

  // Left column: blank. Multiplied into the vertex colour it leaves every
  // unpatterned part exactly its own colour.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, WIDTH, TILE)

  // Middle column: one slot pitch of the punched pattern. Two teardrop-ish
  // slots side by side, which is what a beam connector hooks into.
  const slotX = TILE
  const slotWidth = TILE * 0.16
  const slotHeight = TILE * 0.34
  const centreY = TILE / 2
  context.fillStyle = '#2b3442'
  for (const offset of [-0.22, 0.22]) {
    const x = slotX + TILE / 2 + offset * TILE - slotWidth / 2
    context.beginPath()
    // A rounded rectangle reads as a punched slot at every distance the model
    // is actually looked at; the real teardrop shape is lost by two metres out.
    const radius = slotWidth / 2
    const y = centreY - slotHeight / 2
    context.moveTo(x + radius, y)
    context.lineTo(x + slotWidth - radius, y)
    context.quadraticCurveTo(x + slotWidth, y, x + slotWidth, y + radius)
    context.lineTo(x + slotWidth, y + slotHeight - radius)
    context.quadraticCurveTo(x + slotWidth, y + slotHeight, x + slotWidth - radius, y + slotHeight)
    context.lineTo(x + radius, y + slotHeight)
    context.quadraticCurveTo(x, y + slotHeight, x, y + slotHeight - radius)
    context.lineTo(x, y + radius)
    context.quadraticCurveTo(x, y, x + radius, y)
    context.closePath()
    context.fill()
  }

  // Right column: a wire deck seen from above — the openings dark, the wires
  // left at full white.
  //
  // White is not a colour choice, it is the only correct value: the material
  // multiplies this map into the part's vertex colour, so anything tinted here
  // would be tinted twice and the deck would come out darker than its own
  // palette entry. The openings carry the tint instead, which is also what they
  // physically are — you are looking through the mat at the shadow under it.
  const meshX = TILE * 2
  const wire = Math.max(2, Math.round(TILE / 48))
  context.fillStyle = '#5c6773'
  context.fillRect(meshX, 0, TILE, TILE)
  context.fillStyle = '#ffffff'
  for (let index = 0; index <= MESH_CELLS; index++) {
    const offset = (index * TILE) / MESH_CELLS
    context.fillRect(meshX + offset - wire / 2, 0, wire, TILE)
    context.fillRect(meshX, offset - wire / 2, TILE, wire)
  }

  const texture = new THREE.CanvasTexture(canvas)
  // U is clamped so a part parked in one column can never bleed into its
  // neighbour; V repeats so each pattern keeps its real pitch however large the
  // part is. That asymmetry is why the mesh column tiles along V and is mapped
  // once along U — see `ATLAS_MESH_*` in the geometry builder.
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  cached = texture
  return texture
}
