import * as THREE from 'three'

/**
 * A procedural PBR atlas for the pallet — three 1024² canvases drawn at runtime,
 * so the package ships no image files at all. That property is the asset's best
 * feature and the reason this is ported rather than replaced: a texture pack
 * would trade it for megabytes plus a host asset-pipeline dependency that the
 * reference plugin does not solve for non-Next hosts.
 *
 * The atlas is split into two bands that never mix:
 *
 *   Clean wood   canvas Y 0…550    (V 0.463…1.0)  — every board, stringer,
 *                                                   tunnel wall and chamfer
 *   Markings     canvas Y 650…1024 (V 0…0.365)   — only the outward vertical
 *                                                   faces of the nine blocks
 *
 * `geometry-builder` decides which band a triangle samples, per triangle, from
 * its flat face normal. See the note there on why that makes bleed impossible.
 */

export type EPALTextureAtlas = {
  map: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
  metalnessMap: THREE.CanvasTexture
}

let cachedAtlas: EPALTextureAtlas | null = null

/** Deterministic value noise, so the grain is identical across reloads and
 * across every client — a `Math.random()` grain would differ per session and
 * make screenshots irreproducible. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

function drawOvalMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
) {
  ctx.save()
  ctx.strokeStyle = '#241205'
  ctx.lineWidth = 6
  ctx.fillStyle = '#241205'
  ctx.beginPath()
  ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 5, h / 2 - 5, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.font = 'bold 32px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, y + h / 2)
  ctx.restore()
}

export function getOrCreateEPALTextureAtlas(): EPALTextureAtlas {
  if (cachedAtlas) return cachedAtlas

  const size = 1024
  const make = () => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D }
  }

  const albedo = make()
  const rough = make()
  const metal = make()

  // ── Base coats ──────────────────────────────────────────────────────────
  albedo.ctx.fillStyle = '#dfab78'
  albedo.ctx.fillRect(0, 0, size, size)

  // Mid-grey: raw pine. The material's `roughness` scalar is 1.0 so this map
  // drives the value directly — see the note in `renderer.tsx` about the
  // multiply that made the original render glossier than intended.
  rough.ctx.fillStyle = '#bfab97'
  rough.ctx.fillRect(0, 0, size, size)

  metal.ctx.fillStyle = '#000000'
  metal.ctx.fillRect(0, 0, size, size)

  // ── Grain ───────────────────────────────────────────────────────────────
  // Stripes run along canvas X. `geometry-builder` orients each board's UVs so
  // this axis follows the board's length, which is why the grain reads as sawn
  // timber rather than as noise.
  for (let i = 0; i < 260; i++) {
    const y = hash(i) * size
    const h = 1 + hash(i + 0.5) * 3.5
    const alpha = 0.05 + hash(i + 0.25) * 0.09
    albedo.ctx.fillStyle = `rgba(130, 75, 30, ${alpha})`
    albedo.ctx.fillRect(0, y, size, h)
    // Grain lines sit slightly proud of the surrounding fibre, so they catch
    // light differently. Without this the wood reads as flat paint up close.
    rough.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.5})`
    rough.ctx.fillRect(0, y, size, h)
  }

  // A few knots, at deterministic positions inside the clean band.
  for (let i = 0; i < 7; i++) {
    const kx = hash(i + 10) * size
    const ky = hash(i + 20) * 520
    const kr = 6 + hash(i + 30) * 12
    const grad = albedo.ctx.createRadialGradient(kx, ky, 0, kx, ky, kr)
    grad.addColorStop(0, 'rgba(90, 50, 20, 0.55)')
    grad.addColorStop(1, 'rgba(90, 50, 20, 0)')
    albedo.ctx.fillStyle = grad
    albedo.ctx.beginPath()
    albedo.ctx.arc(kx, ky, kr, 0, Math.PI * 2)
    albedo.ctx.fill()
  }

  // ── Marking band (canvas Y 650+) ────────────────────────────────────────
  drawOvalMark(albedo.ctx, 40, 650, 240, 150, 'EPAL')
  drawOvalMark(albedo.ctx, 320, 650, 240, 150, 'EUR')

  const ctx = albedo.ctx
  ctx.save()
  ctx.strokeStyle = '#241205'
  ctx.lineWidth = 4
  ctx.strokeRect(600, 650, 360, 300)

  // IPPC / ISPM-15 wheat ear.
  ctx.beginPath()
  ctx.moveTo(640, 675)
  ctx.lineTo(640, 925)
  ctx.stroke()
  for (let l = 0; l < 4; l++) {
    const ly = 715 + l * 40
    ctx.beginPath()
    ctx.moveTo(640, ly)
    ctx.lineTo(620, ly - 20)
    ctx.moveTo(640, ly)
    ctx.lineTo(660, ly - 20)
    ctx.stroke()
  }

  ctx.fillStyle = '#241205'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = 'bold 20px monospace'
  ctx.fillText('IPPC', 618, 942)
  ctx.font = 'bold 26px monospace'
  ctx.fillText('DE -', 680, 705)
  ctx.fillText('XX490000', 680, 755)
  ctx.fillText('HT', 680, 805)
  ctx.font = 'bold 22px monospace'
  ctx.fillText('FOR50 095-3-09', 605, 982)

  // Crimped wire staple (Prüfklammer).
  ctx.fillStyle = '#64748b'
  ctx.fillRect(685, 845, 80, 8)
  ctx.restore()

  // ── Control nail (Prüfnagel) ────────────────────────────────────────────
  const nailX = 930
  const nailY = 780
  const nailR = 32

  ctx.save()
  const nailGrad = ctx.createRadialGradient(nailX - 10, nailY - 10, 2, nailX, nailY, nailR)
  nailGrad.addColorStop(0, '#e2e8f0')
  nailGrad.addColorStop(1, '#7c8899')
  ctx.fillStyle = nailGrad
  ctx.beginPath()
  ctx.arc(nailX, nailY, nailR, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('EPAL', nailX, nailY - 5)
  ctx.fillText('2026', nailX, nailY + 8)
  ctx.restore()

  // Glossy, and genuinely metallic — the material's `metalness` scalar is 1.0
  // so this white disc reads as steel while the black elsewhere keeps the wood
  // dielectric.
  rough.ctx.fillStyle = '#333333'
  rough.ctx.beginPath()
  rough.ctx.arc(nailX, nailY, nailR, 0, Math.PI * 2)
  rough.ctx.fill()

  metal.ctx.fillStyle = '#ffffff'
  metal.ctx.beginPath()
  metal.ctx.arc(nailX, nailY, nailR, 0, Math.PI * 2)
  metal.ctx.fill()

  /**
   * Anizotropi: renkte 4, yüzey verisinde 1.
   *
   * Anizotropik filtreleme örnek başına doku okumasını KATLIYOR — 16x'te tek
   * bir örnekleme on altı bilineer sondaya kadar çıkabilir. `MeshStandardMaterial`
   * bir palet fragmanında üç harita birden örnekliyor, yani 16 üç kez ödeniyordu.
   * Ve palet sahnenin en kalabalık yüzeyi.
   *
   * Depoda kamera açıları tam da bunun ateşlendiği açılar: uzun koridorlar,
   * yayvan görülen paletler. Tümleşik GPU'da bu, gizlenen fragmanlar için de
   * ödeniyor — immediate-mode rasterizer derinlik testini kaybedecek fragmanı
   * da gölgeliyor ve dokusunu okuyor. Apple TBDR'da gizli yüzey elemesi
   * gölgelemeden önce olduğu için aynı ayar orada neredeyse bedava; farkın
   * yaşandığı yer tam olarak burası.
   *
   * 4, rafın kendi dokusunun zaten kullandığı değer (`rack/upright-texture.ts`).
   * Pürüzlülük ve metaliklik RENK değil, yüzey verisi: yayvan bir açıda
   * yumuşamaları görünür bir şey değiştirmiyor, tap sayısını ikiye katlaması
   * ise ölçülebilir.
   */
  const map = new THREE.CanvasTexture(albedo.canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4

  const roughnessMap = new THREE.CanvasTexture(rough.canvas)
  roughnessMap.anisotropy = 1

  const metalnessMap = new THREE.CanvasTexture(metal.canvas)
  metalnessMap.anisotropy = 1

  cachedAtlas = { map, roughnessMap, metalnessMap }
  return cachedAtlas
}

/** Atlas sub-rectangles, in UV space, shared with the geometry builder. */
export const ATLAS = {
  /** Clean wood. Canvas Y 0…550 → V 0.463…1.0, inset to avoid the band edge. */
  wood: { uMin: 0.02, uMax: 0.98, vMin: 0.5, vMax: 0.97 },
  /** Canvas X 40→280, Y 650→800. */
  epal: { uMin: 0.042, uMax: 0.271, vMin: 0.221, vMax: 0.363 },
  /** Canvas X 320→560, Y 650→800. */
  eur: { uMin: 0.315, uMax: 0.544, vMin: 0.221, vMax: 0.363 },
  /** Canvas X 600→960, Y 650→982. */
  ippc: { uMin: 0.588, uMax: 0.935, vMin: 0.043, vMax: 0.363 },
} as const

export type AtlasRect = (typeof ATLAS)[keyof typeof ATLAS]
