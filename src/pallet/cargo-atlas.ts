import * as THREE from 'three'
import {
  ATLAS_SIZE,
  CARGO_REGION_IDS,
  CARGO_REGIONS,
  type CargoRegionId,
  type PixelRect,
} from './cargo-atlas-regions'

/**
 * The cargo sheet, drawn at runtime like the pallet's own.
 *
 * Procedural for the same reason `./epal-textures` is: the package ships no
 * image files, so it drops into any host without an asset pipeline. Layout is
 * not decided here — `./cargo-atlas-regions` owns that, and this module asks it
 * where to draw.
 *
 * ## Two sheets, not three
 *
 * Albedo at 2048², roughness and metalness **packed into one sheet at 1024²**.
 * Three's standard material reads roughness from a texture's green channel and
 * metalness from its blue, expressly so one map can serve both (see three's
 * `roughnessmap_fragment` / `metalnessmap_fragment` — the glTF ORM convention).
 * Three full-size sheets would be 50 MB of VRAM; this is 21 MB, and the half
 * resolution costs nothing visible because a surface property has no text and no
 * barcode to keep legible.
 *
 * ## Why almost everything here is grey
 *
 * Colour arrives as a vertex attribute, not from these pixels. The details merge
 * into the cargo's own geometry — one mesh, one material, one `instanceColor` —
 * so a per-instance tint multiplies the straps and the label along with the
 * cartons. Painting kraft into the texture and then multiplying by kraft gives
 * kraft squared, and multiplying a green strap by kraft gives olive. Carrying
 * hue on the geometry leaves `instanceColor` doing only the job it is good at:
 * the few per cent of variation that stops ten thousand pallets reading as one
 * pallet copied, which is invisible on a green strap and correct on a brown box.
 *
 * The exceptions are marks whose colour is intrinsic rather than inherited — the
 * barcode is black on any label, and a FRAGILE band is red or it is not a
 * warning.
 */

export type CargoAtlas = {
  map: THREE.CanvasTexture
  /** Roughness in G, metalness in B. Assign to `roughnessMap` *and*
   *  `metalnessMap`; each reads only its own channel. */
  orm: THREE.CanvasTexture
}

const ORM_SIZE = 1024

let cached: CargoAtlas | null = null

/** Deterministic value noise, matching `./epal-textures`: a `Math.random()`
 *  grain would differ per session and make screenshots irreproducible. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

type Canvas2D = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

function makeCanvas(size: number): Canvas2D {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  // Every drawing below works in the region table's 2048 space; the smaller
  // sheet is scaled once, here, so no coordinate is ever written twice.
  const scale = size / ATLAS_SIZE
  ctx.scale(scale, scale)
  return { canvas, ctx }
}

/**
 * Draws one region, in its own coordinates, unable to escape it.
 *
 * The clip is the point. A drawing that overruns its rectangle would otherwise
 * land in the gutter or on a neighbour, and the symptom — a drum's grey creeping
 * onto a carton at distance, once the mip levels average them together — gives
 * no hint of where it came from. Clipped, the same mistake truncates inside its
 * own box, where it is obvious in the debug sheet.
 */
function withRegion(
  ctx: CanvasRenderingContext2D,
  rect: PixelRect,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()
  ctx.translate(rect.x, rect.y)
  draw(ctx, rect.w, rect.h)
  ctx.restore()
}

/**
 * Darkens a region's rim.
 *
 * **This is what makes a stack of cartons read as a stack.** The modelled gap
 * between them is 4 mm, which at the ten to fifteen metres a layout is judged
 * from is a fraction of a pixel — geometry alone gives a smooth brown block and
 * the layer count vanishes. A shaded edge is several per cent of the face, so it
 * survives the same distance and the seams stay countable.
 */
function shadeEdges(ctx: CanvasRenderingContext2D, w: number, h: number, depth: number) {
  const edges: [number, number, number, number, number, number][] = [
    [0, 0, w, depth, 0, 1],
    [0, h - depth, w, depth, 0, -1],
    [0, 0, depth, h, 1, 0],
    [w - depth, 0, depth, h, -1, 0],
  ]
  for (const [x, y, rw, rh, dx, dy] of edges) {
    const x0 = dx > 0 ? x : dx < 0 ? x + rw : x
    const y0 = dy > 0 ? y : dy < 0 ? y + rh : y
    const grad = ctx.createLinearGradient(x0, y0, x0 + dx * rw, y0 + dy * rh)
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.38)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(x, y, rw, rh)
  }
}

// ── Albedo ──────────────────────────────────────────────────────────────────

function drawKraftBase(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#d8d8d8'
  ctx.fillRect(0, 0, w, h)
  // Corrugated liner: fine fibres, and the flutes showing faintly through it.
  for (let i = 0; i < 90; i++) {
    const y = hash(i + seed) * h
    ctx.fillStyle = `rgba(90, 90, 90, ${0.03 + hash(i + seed + 0.3) * 0.05})`
    ctx.fillRect(0, y, w, 1 + hash(i + seed + 0.6) * 2)
  }
  const flutePitch = w / 34
  for (let x = 0; x < w; x += flutePitch) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.035)'
    ctx.fillRect(x, 0, flutePitch * 0.45, h)
  }
}

function drawCartonFace(ctx: CanvasRenderingContext2D, w: number, h: number, taped: boolean) {
  drawKraftBase(ctx, w, h, 1)
  if (taped) {
    const tapeW = w * 0.11
    ctx.fillStyle = 'rgba(240, 240, 240, 0.75)'
    ctx.fillRect(w / 2 - tapeW / 2, 0, tapeW, h)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
    ctx.fillRect(w / 2 - tapeW / 2, 0, 2, h)
    ctx.fillRect(w / 2 + tapeW / 2 - 2, 0, 2, h)
  }
  shadeEdges(ctx, w, h, w * 0.06)
}

function drawCartonTop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  drawKraftBase(ctx, w, h, 4)
  // Four flaps: the long seam across the middle, the two short ones meeting it.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
  ctx.fillRect(0, h / 2 - 1.5, w, 3)
  ctx.fillRect(w * 0.25 - 1.5, 0, 3, h / 2)
  ctx.fillRect(w * 0.75 - 1.5, 0, 3, h / 2)
  const tapeW = h * 0.1
  ctx.fillStyle = 'rgba(240, 240, 240, 0.72)'
  ctx.fillRect(0, h / 2 - tapeW / 2, w, tapeW)
  shadeEdges(ctx, w, h, w * 0.05)
}

function drawCartonRow(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cell = w / 4
  for (let i = 0; i < 4; i++) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(i * cell, 0, cell, h)
    ctx.clip()
    ctx.translate(i * cell, 0)
    drawKraftBase(ctx, cell, h, 7 + i)
    shadeEdges(ctx, cell, h, cell * 0.07)
    ctx.restore()
  }
}

function drawDrumBody(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#cfcfcf'
  ctx.fillRect(0, 0, w, h)
  // The two rolling hoops. They are what says "drum" at any distance where the
  // bungs have stopped being legible.
  for (const centre of [0.3, 0.68]) {
    const y = h * centre
    const band = h * 0.075
    const grad = ctx.createLinearGradient(0, y - band, 0, y + band)
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.30)')
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.28)')
    grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.16)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.32)')
    ctx.fillStyle = grad
    ctx.fillRect(0, y - band, w, band * 2)
  }
  // Rolled edges top and bottom, and the vertical weld seam.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.fillRect(0, 0, w, h * 0.035)
  ctx.fillRect(0, h * 0.965, w, h * 0.035)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
  ctx.fillRect(w * 0.5, 0, 2.5, h)
  for (let i = 0; i < 40; i++) {
    const x = hash(i + 30) * w
    const y = hash(i + 60) * h
    ctx.fillStyle = `rgba(60, 60, 60, ${0.04 + hash(i + 90) * 0.06})`
    ctx.fillRect(x, y, 3 + hash(i + 120) * 9, 2)
  }
}

function drawDrumLid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#c9c9c9'
  ctx.fillRect(0, 0, w, h)
  const cx = w / 2
  const cy = h / 2
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.30)'
  ctx.lineWidth = w * 0.02
  // Rolled rim, then the two concentric stiffening rings pressed into the head.
  for (const r of [0.47, 0.4, 0.27]) {
    ctx.beginPath()
    ctx.arc(cx, cy, w * r, 0, Math.PI * 2)
    ctx.stroke()
  }
  // Bung and vent, offset like the real thing rather than centred.
  for (const [dx, radius] of [
    [-0.24, 0.085],
    [0.24, 0.055],
  ] as const) {
    ctx.beginPath()
    ctx.arc(cx + w * dx, cy, w * radius, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.32)'
    ctx.fill()
    ctx.stroke()
  }
  shadeEdges(ctx, w, h, w * 0.05)
}

function drawFilm(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#efefef'
  ctx.fillRect(0, 0, w, h)
  // Wrinkles run round the load, so they run across this region. Faint: the
  // film's job is to show what is behind it.
  for (let i = 0; i < 70; i++) {
    const y = hash(i + 200) * h
    const lean = (hash(i + 260) - 0.5) * h * 0.12
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + hash(i + 230) * 0.3})`
    ctx.lineWidth = 0.8 + hash(i + 290) * 2.2
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y + lean)
    ctx.stroke()
  }
}

function drawCornerBoard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  drawKraftBase(ctx, w, h, 12)
  // The crease the L is folded on, with the two wings shaded away from it.
  const grad = ctx.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.22)')
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.16)')
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.22)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.fillRect(w / 2 - 1, 0, 2, h)
}

function drawStrap(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#e8e8e8'
  ctx.fillRect(0, 0, w, h)
  // Embossed ribs along the band, and the gloss line PET carries down its middle.
  for (let x = 0; x < w; x += h * 0.5) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.10)'
    ctx.fillRect(x, 0, h * 0.16, h)
  }
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.25)')
  grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.45)')
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.25)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

function drawLabel(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f7f7f7'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#3a3a3a'
  ctx.lineWidth = 2
  ctx.strokeRect(3, 3, w - 6, h - 6)

  ctx.fillStyle = '#2a2a2a'
  ctx.font = `bold ${Math.round(h * 0.055)}px sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('SHIP TO', w * 0.07, h * 0.07)
  ctx.font = `${Math.round(h * 0.042)}px sans-serif`
  for (let line = 0; line < 3; line++) {
    ctx.fillStyle = 'rgba(40, 40, 40, 0.55)'
    ctx.fillRect(w * 0.07, h * (0.16 + line * 0.05), w * (0.72 - line * 0.13), h * 0.022)
  }

  // Code 128-ish: deterministic bar widths, because a barcode with a random
  // pattern per reload would flicker between screenshots of the same scene.
  const barTop = h * 0.4
  const barH = h * 0.3
  let x = w * 0.07
  const right = w * 0.93
  for (let i = 0; x < right; i++) {
    const bar = 2 + Math.floor(hash(i + 400) * 4)
    const gap = 2 + Math.floor(hash(i + 700) * 4)
    ctx.fillStyle = '#101010'
    ctx.fillRect(x, barTop, Math.min(bar, right - x), barH)
    x += bar + gap
  }
  ctx.fillStyle = '#101010'
  ctx.font = `${Math.round(h * 0.048)}px monospace`
  ctx.textAlign = 'center'
  ctx.fillText('4 006381 333931', w / 2, h * 0.73)
  ctx.font = `bold ${Math.round(h * 0.07)}px sans-serif`
  ctx.fillText('PAL 0042', w / 2, h * 0.85)
}

function drawWarningBand(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f2f2f2'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#c62828'
  for (let x = -h; x < w; x += h * 0.9) {
    ctx.beginPath()
    ctx.moveTo(x, h)
    ctx.lineTo(x + h * 0.45, h)
    ctx.lineTo(x + h * 0.45 + h, 0)
    ctx.lineTo(x + h, 0)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(w * 0.3, h * 0.18, w * 0.4, h * 0.64)
  ctx.fillStyle = '#c62828'
  ctx.font = `bold ${Math.round(h * 0.46)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('FRAGILE', w * 0.5, h * 0.52)
}

function drawLod2Facade(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // A whole loaded pallet in one rectangle: wrapped load above, feet below. The
  // split is where a 144 mm pallet sits under a load of roughly a metre.
  const deck = h * 0.86
  ctx.fillStyle = '#e4e4e4'
  ctx.fillRect(0, 0, w, deck)
  for (let i = 0; i < 40; i++) {
    const y = hash(i + 500) * deck
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + hash(i + 530) * 0.22})`
    ctx.lineWidth = 1 + hash(i + 560) * 2
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y + (hash(i + 590) - 0.5) * h * 0.05)
    ctx.stroke()
  }
  // The seams that survive the wrap — the reason a far pallet still reads as
  // boxes rather than as a monolith.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.10)'
  for (let i = 1; i < 4; i++) ctx.fillRect((w * i) / 4 - 1.5, 0, 3, deck)
  shadeEdges(ctx, w, deck, w * 0.045)

  ctx.fillStyle = '#b9b9b9'
  ctx.fillRect(0, deck, w, h - deck)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  const footW = w * 0.16
  for (const at of [0.06, 0.42, 0.78]) {
    ctx.clearRect(w * at + footW, deck + (h - deck) * 0.35, w * 0.2, (h - deck) * 0.65)
    ctx.fillRect(w * at + footW, deck + (h - deck) * 0.35, w * 0.2, (h - deck) * 0.65)
  }
}

const ALBEDO_DRAWERS: Record<
  CargoRegionId,
  (ctx: CanvasRenderingContext2D, w: number, h: number) => void
> = {
  cartonFace: (ctx, w, h) => drawCartonFace(ctx, w, h, false),
  cartonFaceTaped: (ctx, w, h) => drawCartonFace(ctx, w, h, true),
  cartonTop: drawCartonTop,
  cartonRow: drawCartonRow,
  drumBody: drawDrumBody,
  drumLid: drawDrumLid,
  film: drawFilm,
  lod2Facade: drawLod2Facade,
  cornerBoard: drawCornerBoard,
  label: drawLabel,
  strap: drawStrap,
  warningBand: drawWarningBand,
}

// ── Roughness + metalness ───────────────────────────────────────────────────

/**
 * How each region behaves in light: `[roughness, metalness]`, 0–1.
 *
 * Kraft is matte and dielectric; steel is neither. Film is the interesting one —
 * smooth enough to catch a highlight is precisely what makes a wrapped pallet
 * look wrapped, and at roughness 0.9 it would read as another cardboard box.
 */
const SURFACE: Record<CargoRegionId, readonly [number, number]> = {
  cartonFace: [0.92, 0],
  cartonFaceTaped: [0.9, 0],
  cartonTop: [0.92, 0],
  cartonRow: [0.92, 0],
  drumBody: [0.42, 1],
  drumLid: [0.45, 1],
  film: [0.22, 0],
  lod2Facade: [0.55, 0],
  cornerBoard: [0.94, 0],
  label: [0.6, 0],
  strap: [0.3, 0],
  warningBand: [0.55, 0],
}

const channel = (value: number) => Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255)

function drawOrmRegion(ctx: CanvasRenderingContext2D, w: number, h: number, id: CargoRegionId) {
  const [roughness, metalness] = SURFACE[id]
  // R is glTF's occlusion channel. Nothing here bakes AO, so it stays white
  // rather than being left at zero — a black R would darken the surface for any
  // host that does wire this sheet up as an `aoMap`.
  ctx.fillStyle = `rgb(255, ${channel(roughness)}, ${channel(metalness)})`
  ctx.fillRect(0, 0, w, h)

  if (id === 'cartonFaceTaped') {
    const tapeW = w * 0.11
    ctx.fillStyle = `rgb(255, ${channel(0.35)}, 0)`
    ctx.fillRect(w / 2 - tapeW / 2, 0, tapeW, h)
  }
  if (id === 'cartonTop') {
    ctx.fillStyle = `rgb(255, ${channel(0.35)}, 0)`
    ctx.fillRect(0, h / 2 - h * 0.05, w, h * 0.1)
  }
  if (id === 'drumBody') {
    // The rolling hoops are polished by handling where the rest of the drum is
    // not, and that difference is most of what makes them read as raised.
    for (const centre of [0.3, 0.68]) {
      ctx.fillStyle = `rgb(255, ${channel(0.28)}, 255)`
      ctx.fillRect(0, h * centre - h * 0.075, w, h * 0.15)
    }
  }
  if (id === 'label') {
    ctx.fillStyle = `rgb(255, ${channel(0.45)}, 0)`
    ctx.fillRect(w * 0.04, h * 0.04, w * 0.92, h * 0.92)
  }
}

// ── Assembly ────────────────────────────────────────────────────────────────

export function getOrCreateCargoAtlas(): CargoAtlas {
  if (cached) return cached

  const albedo = makeCanvas(ATLAS_SIZE)
  const orm = makeCanvas(ORM_SIZE)

  // The gutter is drawn mid-grey rather than left transparent: a region whose
  // UVs are wrong then samples something plainly neutral instead of picking up
  // whatever the canvas was initialised to, and the debug sheet can show it.
  albedo.ctx.fillStyle = '#7f7f7f'
  albedo.ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
  orm.ctx.fillStyle = `rgb(255, ${channel(0.8)}, 0)`
  orm.ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)

  for (const id of CARGO_REGION_IDS) {
    const rect = CARGO_REGIONS[id]
    withRegion(albedo.ctx, rect, ALBEDO_DRAWERS[id])
    withRegion(orm.ctx, rect, (ctx, w, h) => drawOrmRegion(ctx, w, h, id))
  }

  const map = new THREE.CanvasTexture(albedo.canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 16

  const ormTexture = new THREE.CanvasTexture(orm.canvas)
  ormTexture.anisotropy = 8

  cached = { map, orm: ormTexture }
  return cached
}

/**
 * The same sheet, labelled — every region filled with its own hue, numbered,
 * named, and carrying an arrow that points **up in UV space**.
 *
 * It exists because the flip is the one part of an atlas that cannot be checked
 * by looking at the atlas. A region drawn correctly and sampled upside down
 * looks, on the sheet, exactly like a region drawn correctly. Put this on the
 * cargo and the arrows either point at the sky or they do not, and the answer
 * takes one glance rather than an afternoon.
 */
export function createCargoDebugAtlas(): THREE.CanvasTexture {
  const debug = makeCanvas(ATLAS_SIZE)
  const { ctx } = debug

  ctx.fillStyle = '#101014'
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)

  CARGO_REGION_IDS.forEach((id, index) => {
    withRegion(ctx, CARGO_REGIONS[id], (regionCtx, w, h) => {
      regionCtx.fillStyle = `hsl(${(index * 47) % 360}, 62%, 58%)`
      regionCtx.fillRect(0, 0, w, h)
      regionCtx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
      regionCtx.lineWidth = 4
      regionCtx.strokeRect(2, 2, w - 4, h - 4)

      const unit = Math.min(w, h)
      regionCtx.strokeStyle = '#0b0b0f'
      regionCtx.fillStyle = '#0b0b0f'
      regionCtx.lineWidth = Math.max(3, unit * 0.03)
      // Toward smaller canvas Y, which after the upload's flip is toward larger
      // V — "up" as the mesh will see it.
      const tip = h * 0.16
      const tail = h * 0.62
      regionCtx.beginPath()
      regionCtx.moveTo(w / 2, tail)
      regionCtx.lineTo(w / 2, tip)
      regionCtx.stroke()
      regionCtx.beginPath()
      regionCtx.moveTo(w / 2, tip - unit * 0.02)
      regionCtx.lineTo(w / 2 - unit * 0.09, tip + unit * 0.11)
      regionCtx.lineTo(w / 2 + unit * 0.09, tip + unit * 0.11)
      regionCtx.closePath()
      regionCtx.fill()

      regionCtx.textAlign = 'center'
      regionCtx.textBaseline = 'middle'
      regionCtx.font = `bold ${Math.round(unit * 0.2)}px sans-serif`
      regionCtx.fillText(String(index), w / 2, h * 0.76)
      regionCtx.font = `bold ${Math.round(Math.min(unit * 0.1, w * 0.085))}px monospace`
      regionCtx.fillText(id, w / 2, h * 0.93)
    })
  })

  const texture = new THREE.CanvasTexture(debug.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
