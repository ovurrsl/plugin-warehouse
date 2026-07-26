import * as THREE from 'three'

/**
 * A two-column atlas: blank, and one pitch of roller bed.
 *
 * The atlas is what keeps the whole conveyor family on **one** material. Only
 * the bed carries a pattern, so the obvious build is a second material for it —
 * which doubles the draw calls, and at two hundred modules that is the
 * difference between one thing to draw per module and two.
 *
 * **This is the file that decides whether the kind is affordable.** Six hundred
 * metres of bed at 75 mm pitch is eight thousand rollers. Drawn as twelve-sided
 * prisms — twenty-four side and twenty-four cap triangles each — that is nearly
 * four hundred thousand triangles for one kind, against the four hundred
 * thousand the whole two-thousand-bay rack scene is budgeted at. Painted
 * instead, the entire bed of a module is one box.
 *
 * Its own atlas rather than the rack's: the rack's mesh column is authored at
 * ten cells for a 100 mm wire-deck grid, and a roller is a different pitch, a
 * different aspect and a different shading. The *layout* maths is shared — a 4%
 * column inset, blank at the column centre — and the ink is not.
 *
 * Geometry never touches this file: the builder only writes UV numbers, which
 * is pure maths and runs in the test environment. Creating a canvas needs
 * `document`, so this is reached solely from the material, which is itself only
 * loaded by the lazy renderer — the manifest barrel stays SSR-safe.
 */

/**
 * One tile is one roller pitch, because V repeats once per pitch. 128 across so
 * the cylindrical shading has somewhere to live; a flat two-tone band reads as
 * a painted stripe rather than as steel.
 */
const TILE = 128
const WIDTH = TILE * 2

/**
 * How much of a pitch the roller itself occupies.
 *
 * A 50 mm roller on a 75 mm pitch is two thirds, and the third that is left is
 * the gap you can see the floor through. Fixed rather than derived from the
 * node: the pitch varies but the roller diameter does not, and 0.66 is right
 * within a few percent across the whole pitch set — close enough that no camera
 * distance this bed is ever seen from could tell.
 */
const ROLLER_SPAN = 0.66

let cached: THREE.Texture | null = null

export function getConveyorTexture(): THREE.Texture {
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = TILE
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('[warehouse:conveyor-roller] 2D canvas unavailable for the roller atlas')
  }

  // Left column: blank. Multiplied into the vertex colour it leaves every
  // unpatterned part exactly its own colour.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, WIDTH, TILE)

  // Right column: one pitch. The gap first, then the roller over it.
  //
  // The values are multipliers, not colours: the material multiplies this map
  // into the part's vertex colour, so anything tinted here would be tinted
  // twice and the bed would come out darker than its own palette entry. The gap
  // is dark because you are looking past the rollers at the floor; the roller
  // runs from a shaded lower edge through a highlight to a shaded upper one,
  // which is what makes a flat box read as a row of cylinders.
  const rollerX = TILE
  context.fillStyle = '#43484e'
  context.fillRect(rollerX, 0, TILE, TILE)

  const span = TILE * ROLLER_SPAN
  const start = (TILE - span) / 2
  const shading = context.createLinearGradient(0, start, 0, start + span)
  shading.addColorStop(0, '#6c737b')
  shading.addColorStop(0.18, '#c8ced6')
  shading.addColorStop(0.45, '#ffffff')
  shading.addColorStop(0.72, '#cdd3da')
  shading.addColorStop(1, '#767d85')
  context.fillStyle = shading
  context.fillRect(rollerX, start, TILE, span)

  // The seam where one roller meets the next, so a bed at a shallow angle does
  // not turn into a single smear of grey.
  context.fillStyle = '#2f343a'
  context.fillRect(rollerX, 0, TILE, Math.max(1, Math.round(TILE / 64)))

  const texture = new THREE.CanvasTexture(canvas)
  // U is clamped so a part parked in one column can never bleed into the other
  // under filtering; V repeats so the pitch stays the real 50/75/100 mm however
  // long the module is. That asymmetry is why the bed maps U across its width
  // once and tiles V along its length — see `ATLAS_ROLLER_*` in the builder.
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  cached = texture
  return texture
}
