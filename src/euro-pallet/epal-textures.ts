import * as THREE from 'three'

export interface EPALTextureAtlas {
  map: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
  metalnessMap: THREE.CanvasTexture
}

let cachedAtlas: EPALTextureAtlas | null = null

/**
 * Creates a high-resolution 1024x1024 PBR Texture Atlas with STRICT DUAL-REGION ISOLATION:
 *
 * 1. CLEAN WOOD REGION (Canvas Y: 0 to 500 | Three.js V: 0.51 to 1.0):
 *    - 100% PURE natural wood grain texture with ZERO stamps, ZERO text, ZERO lines.
 *    - Mapped to ALL 5 Top Deckboards, 3 Cross Boards, 3 Bottom Deckboards, and ALL internal block tunnel faces!
 *
 * 2. STAMP REGION (Canvas Y: 600 to 1024 | Three.js V: 0.0 to 0.41):
 *    - EPAL, EUR, IPPC/HT stamps & metallic control nail seal.
 *    - Mapped EXCLUSIVELY to outward-facing outer perimeter vertical faces of the 9 blocks.
 */
export function getOrCreateEPALTextureAtlas(): EPALTextureAtlas {
  if (cachedAtlas) return cachedAtlas

  const size = 1024

  // Albedo Canvas
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Roughness Map Canvas
  const rCanvas = document.createElement('canvas')
  rCanvas.width = size
  rCanvas.height = size
  const rCtx = rCanvas.getContext('2d')!

  // Metalness Map Canvas
  const mCanvas = document.createElement('canvas')
  mCanvas.width = size
  mCanvas.height = size
  const mCtx = mCanvas.getContext('2d')!

  // 1. Fill Entire Canvas with Natural EPAL Light Pine Wood Tone
  ctx.fillStyle = '#dfab78'
  ctx.fillRect(0, 0, size, size)

  rCtx.fillStyle = '#bfab97' // ~0.75 roughness for raw pine wood
  rCtx.fillRect(0, 0, size, size)

  mCtx.fillStyle = '#000000' // 0.0 metalness for wood
  mCtx.fillRect(0, 0, size, size)

  // 2. Draw Realistic Horizontal Wood Grain Lines across Entire Canvas
  ctx.fillStyle = 'rgba(130, 75, 30, 0.09)'
  for (let i = 0; i < 240; i++) {
    const y = Math.random() * size
    const h = 1 + Math.random() * 3.5
    ctx.fillRect(0, y, size, h)
  }

  // 3. LOWER STAMP REGION (Canvas Y: 600 to 1024 ONLY)
  // Canvas Y: 0 to 550 remains 100% PURE CLEAN WOOD!

  const drawEPALOval = (x: number, y: number, w: number, h: number, text: string) => {
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

  // Stamp 1: Left Corner EPAL Stamp (Canvas X: 40 to 280, Y: 650 to 800)
  drawEPALOval(40, 650, 240, 150, 'EPAL')

  // Stamp 2: Right Corner EUR Stamp (Canvas X: 320 to 560, Y: 650 to 800)
  drawEPALOval(320, 650, 240, 150, 'EUR')

  // Stamp 3: Central IPPC + HT License Box (Canvas X: 600 to 960, Y: 650 to 950)
  ctx.save()
  ctx.strokeStyle = '#241205'
  ctx.lineWidth = 4
  ctx.strokeRect(600, 650, 360, 300)

  // IPPC Wheat Leaf Logo
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

  ctx.font = 'bold 20px monospace'
  ctx.fillStyle = '#241205'
  ctx.textAlign = 'left'
  ctx.fillText('IPPC', 618, 942)

  ctx.font = 'bold 26px monospace'
  ctx.fillText('DE -', 680, 705)
  ctx.fillText('XX490000', 680, 755)
  ctx.fillText('HT', 680, 805)
  ctx.font = 'bold 22px monospace'
  ctx.fillText('FOR50 095-3-09', 605, 982)

  // Metal Wire Staple (Prüfklammer)
  ctx.fillStyle = '#64748b'
  ctx.fillRect(685, 845, 80, 8)
  ctx.restore()

  // Control Nail Seal (Prüfnagel) — Metallic 1.0 & Roughness 0.2
  const nailX = 930
  const nailY = 780
  const nailR = 32

  // Albedo: Metallic Silver
  ctx.save()
  ctx.fillStyle = '#94a3b8'
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

  // Roughness Map for Control Nail: Dark ~0.20
  rCtx.fillStyle = '#333333'
  rCtx.beginPath()
  rCtx.arc(nailX, nailY, nailR, 0, Math.PI * 2)
  rCtx.fill()

  // Metalness Map for Control Nail: Pure Metallic 1.0
  mCtx.fillStyle = '#ffffff'
  mCtx.beginPath()
  mCtx.arc(nailX, nailY, nailR, 0, Math.PI * 2)
  mCtx.fill()

  // Create Three.js Canvas Textures
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 16

  const roughnessMap = new THREE.CanvasTexture(rCanvas)
  roughnessMap.anisotropy = 16

  const metalnessMap = new THREE.CanvasTexture(mCanvas)
  metalnessMap.anisotropy = 16

  cachedAtlas = { map, roughnessMap, metalnessMap }
  return cachedAtlas
}
