import * as THREE from 'three'

/**
 * A two-column atlas: blank on the left, the upright's punched slot pattern on
 * the right.
 *
 * The atlas is what keeps the whole rack on **one** material. Perforations are
 * only on the uprights, so the obvious build is a second material for those —
 * which doubles the draw calls, and at a thousand racks that is the difference
 * between one thing to draw per rack and two. Instead the geometry steers each
 * part's UVs into one column or the other, and a single material serves both.
 *
 * Geometry never touches this file: the builder only writes UV numbers, which
 * is pure maths and runs in the test environment. Creating a canvas needs
 * `document`, so this is reached solely from the material, which is itself only
 * loaded by the lazy renderer — the manifest barrel stays SSR-safe.
 */

/** Slot pitch is 50 mm, and the geometry repeats V once per pitch. So one tile
 *  of the pattern is exactly one slot pitch tall. */
const TILE = 64
const WIDTH = TILE * 2

let cached: THREE.Texture | null = null

export function getRackUprightTexture(): THREE.Texture {
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = TILE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('[warehouse:pallet-rack] 2D canvas unavailable for the slot atlas')

  // Left column: blank. Multiplied into the vertex colour it leaves every
  // non-perforated part exactly its own colour.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, WIDTH, TILE)

  // Right column: one slot pitch of the punched pattern. Two teardrop-ish
  // slots side by side, which is what a beam connector hooks into.
  const columnX = TILE
  const slotWidth = TILE * 0.16
  const slotHeight = TILE * 0.34
  const centreY = TILE / 2
  context.fillStyle = '#2b3442'
  for (const offset of [-0.22, 0.22]) {
    const x = columnX + TILE / 2 + offset * TILE - slotWidth / 2
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

  const texture = new THREE.CanvasTexture(canvas)
  // U is clamped so a part parked in one column can never bleed into the other;
  // V repeats so the slot pitch stays 50 mm however tall the post is.
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  cached = texture
  return texture
}
