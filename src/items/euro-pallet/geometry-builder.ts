import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

let cachedEPALGeometry: THREE.BufferGeometry | null = null
let cachedEPALLOD1Geometry: THREE.BufferGeometry | null = null

// ─────────────────────────────────────────────────────────────────────────────
// Block definitions for per-triangle UV stamp classification.
// Each block is identified by its column (left/center/right) and row
// (back/center/front). Half-widths are used for containment testing and for
// computing per-face LOCAL UV normalization bounds (the key fix for Bug #3).
// ─────────────────────────────────────────────────────────────────────────────
interface BlockDef {
  cx: number
  cz: number
  hwx: number // half-width along X (always 0.0725 = 145mm / 2)
  hwz: number // half-width along Z (0.050 for outer rows, 0.0725 for center row)
  col: 'left' | 'center' | 'right'
  row: 'back' | 'center' | 'front'
}

const BLOCK_DEFS: BlockDef[] = [
  // Back row (Z = −0.350, block Z-width = 100mm → hwz = 0.050)
  { cx: -0.5275, cz: -0.350, hwx: 0.0725, hwz: 0.050, col: 'left',   row: 'back' },
  { cx:  0,      cz: -0.350, hwx: 0.0725, hwz: 0.050, col: 'center', row: 'back' },
  { cx:  0.5275, cz: -0.350, hwx: 0.0725, hwz: 0.050, col: 'right',  row: 'back' },
  // Center row (Z = 0, block Z-width = 145mm → hwz = 0.0725)
  { cx: -0.5275, cz: 0,      hwx: 0.0725, hwz: 0.0725, col: 'left',   row: 'center' },
  { cx:  0,      cz: 0,      hwx: 0.0725, hwz: 0.0725, col: 'center', row: 'center' },
  { cx:  0.5275, cz: 0,      hwx: 0.0725, hwz: 0.0725, col: 'right',  row: 'center' },
  // Front row (Z = +0.350, block Z-width = 100mm → hwz = 0.050)
  { cx: -0.5275, cz:  0.350, hwx: 0.0725, hwz: 0.050, col: 'left',   row: 'front' },
  { cx:  0,      cz:  0.350, hwx: 0.0725, hwz: 0.050, col: 'center', row: 'front' },
  { cx:  0.5275, cz:  0.350, hwx: 0.0725, hwz: 0.050, col: 'right',  row: 'front' },
]

/**
 * Finds which of the 9 blocks a given (x, z) centroid belongs to.
 * Returns null if the point is outside all block bounds (e.g., on a board or stringer).
 */
function findBlock(x: number, z: number): BlockDef | null {
  const tolerance = 0.012 // ~12mm tolerance for chamfered corners
  for (const b of BLOCK_DEFS) {
    if (Math.abs(x - b.cx) <= b.hwx + tolerance &&
        Math.abs(z - b.cz) <= b.hwz + tolerance) {
      return b
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Main geometry generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Procedurally generates the 1:1 official EPAL 1 (EUR 1) Euro Pallet.
 *
 * Total Height: 144mm (22 + 78 + 22 + 22).
 * Origin (0, 0, 0) = absolute bottom-center of pallet.
 *
 * Architecture:
 * - 20 individual sub-meshes (5 top + 3 stringers + 9 blocks + 3 bottom).
 * - 8 outer parts use ExtrudeGeometry with custom THREE.Shape for physical
 *   15mm 45° corner chamfers. 12 inner parts use BoxGeometry (sharp corners).
 * - Every sub-mesh is .toNonIndexed() BEFORE merging → separate vertices per
 *   face → zero UV shattering when projecting stamps.
 * - mergeGeometries concatenates without vertex deduplication.
 * - Per-TRIANGLE flat-normal UV classification → zero stamp bleeding onto
 *   top boards, stringers, bottom boards, or internal tunnel faces.
 */
export function getOrCreateEPALGeometry(): THREE.BufferGeometry {

  const geometries: THREE.BufferGeometry[] = []

  // Pallet dimensions (metres)
  const L = 1.2       // X axis (length)
  const W = 0.8       // Z axis (width)
  const boardH = 0.022
  const blockH = 0.078
  const CHAMFER = 0.015

  // Y-level centres
  const bottomY   = boardH / 2                             // 0.011
  const blockY    = boardH + blockH / 2                     // 0.061
  const stringerY = boardH + blockH + boardH / 2            // 0.111
  const topY      = boardH + blockH + boardH + boardH / 2   // 0.133

  // Column / row reference positions
  const crossX    = 0.5275   // X centre of left/right columns
  const blockZ    = 0.350    // Z centre of back/front rows
  const outerTopZ = 0.3275   // Z centre of outer top boards
  const innerTopZ = 0.16375  // Z centre of inner top boards

  // ── Helper: chamfered part via ExtrudeGeometry ──────────────────────────
  //
  // The shape is drawn in the 2D X-Y plane and extruded along +Z.
  // After  center() + rotateX(π/2)  the mapping becomes:
  //
  //   2D corner       2D coords       →  3D position
  //   ─────────       ─────────          ────────────
  //   TL              (−hw, −hl)      →  (−X, −Z)   Back-Left
  //   TR              (+hw, −hl)      →  (+X, −Z)   Back-Right
  //   BR              (+hw, +hl)      →  (+X, +Z)   Front-Right
  //   BL              (−hw, +hl)      →  (−X, +Z)   Front-Left
  //
  // Proof: rotateX(π/2) transforms  (x,y,z) → (x, −z, y).
  //        After centre(), extrusion spans  z ∈ [−h/2, +h/2].
  //        So  new_Y = −z  (symmetric),  new_Z = old_Y  (same sign).
  //        Shape Y  maps directly to  3D Z  with no sign flip.

  const addChamfered = (
    w: number, l: number, h: number,
    x: number, y: number, z: number,
    c: { tl: boolean; tr: boolean; br: boolean; bl: boolean },
  ) => {
    const s  = new THREE.Shape()
    const hw = w / 2, hl = l / 2, ch = CHAMFER

    // Start at TR position and walk counter-clockwise
    if (c.tr) { s.moveTo(hw - ch, -hl); s.lineTo(hw, -hl + ch) }
    else      { s.moveTo(hw, -hl) }

    if (c.br) { s.lineTo(hw, hl - ch); s.lineTo(hw - ch, hl) }
    else      { s.lineTo(hw, hl) }

    if (c.bl) { s.lineTo(-hw + ch, hl); s.lineTo(-hw, hl - ch) }
    else      { s.lineTo(-hw, hl) }

    if (c.tl) { s.lineTo(-hw, -hl + ch); s.lineTo(-hw + ch, -hl) }
    else      { s.lineTo(-hw, -hl) }

    s.closePath()

    const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false })
    geo.center()
    geo.rotateX(Math.PI / 2)
    geo.translate(x, y, z)
    geometries.push(geo.index ? geo.toNonIndexed() : geo)
  }

  // ── Helper: sharp box ──────────────────────────────────────────────────
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const geo = new THREE.BoxGeometry(w, h, d)
    geo.translate(x, y, z)
    geometries.push(geo.index ? geo.toNonIndexed() : geo)
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  LAYER 4 — Top Deckboards  (5 boards,  Y centre = 0.133)
  // ═══════════════════════════════════════════════════════════════════════
  // Back outer board: outer edge at Z = −0.400 → TL + TR
  addChamfered(L, 0.145, boardH, 0, topY, -outerTopZ,
    { tl: true, tr: true, br: false, bl: false })
  addBox(L, boardH, 0.100, 0, topY, -innerTopZ)
  addBox(L, boardH, 0.145, 0, topY, 0)
  addBox(L, boardH, 0.100, 0, topY,  innerTopZ)
  // Front outer board: outer edge at Z = +0.400 → BR + BL
  addChamfered(L, 0.145, boardH, 0, topY,  outerTopZ,
    { tl: false, tr: false, br: true, bl: true })

  // ═══════════════════════════════════════════════════════════════════════
  //  LAYER 3 — Cross Stringers  (3 boards,  Y centre = 0.111)
  // ═══════════════════════════════════════════════════════════════════════
  // Left stringer: outer corners at (−X,−Z)=TL  and  (−X,+Z)=BL
  addChamfered(0.145, W, boardH, -crossX, stringerY, 0,
    { tl: true, tr: false, br: false, bl: true })
  addBox(0.145, boardH, W, 0, stringerY, 0)
  // Right stringer: outer corners at (+X,−Z)=TR  and  (+X,+Z)=BR
  addChamfered(0.145, W, boardH,  crossX, stringerY, 0,
    { tl: false, tr: true, br: true, bl: false })

  // ═══════════════════════════════════════════════════════════════════════
  //  LAYER 2 — Blocks  (9 blocks,  Y centre = 0.061)
  // ═══════════════════════════════════════════════════════════════════════

  // ── Back row (Z = −0.350,  100mm Z-width) ──
  // Back-Left:  outer corner at (−X, −Z) = TL
  addChamfered(0.145, 0.100, blockH, -crossX, blockY, -blockZ,
    { tl: true, tr: false, br: false, bl: false })
  // Back-Centre: no chamfer, 100mm Z (matches outer row spec)
  addBox(0.145, blockH, 0.100, 0, blockY, -blockZ)
  // Back-Right: outer corner at (+X, −Z) = TR
  addChamfered(0.145, 0.100, blockH,  crossX, blockY, -blockZ,
    { tl: false, tr: true, br: false, bl: false })

  // ── Centre row (Z = 0,  145mm Z-width) ──
  addBox(0.145, blockH, 0.145, -crossX, blockY, 0)
  addBox(0.145, blockH, 0.145,  0,      blockY, 0)
  addBox(0.145, blockH, 0.145,  crossX, blockY, 0)

  // ── Front row (Z = +0.350,  100mm Z-width) ──
  // Front-Left: outer corner at (−X, +Z) = BL
  addChamfered(0.145, 0.100, blockH, -crossX, blockY,  blockZ,
    { tl: false, tr: false, br: false, bl: true })
  // Front-Centre: no chamfer, 100mm Z
  addBox(0.145, blockH, 0.100, 0, blockY,  blockZ)
  // Front-Right: outer corner at (+X, +Z) = BR
  addChamfered(0.145, 0.100, blockH,  crossX, blockY,  blockZ,
    { tl: false, tr: false, br: true, bl: false })

  // ═══════════════════════════════════════════════════════════════════════
  //  LAYER 1 — Bottom Deckboards  (3 boards,  Y centre = 0.011)
  // ═══════════════════════════════════════════════════════════════════════
  // Back outer board: TL + TR
  addChamfered(L, 0.100, boardH, 0, bottomY, -blockZ,
    { tl: true, tr: true, br: false, bl: false })
  addBox(L, boardH, 0.145, 0, bottomY, 0)
  // Front outer board: BR + BL
  addChamfered(L, 0.100, boardH, 0, bottomY,  blockZ,
    { tl: false, tr: false, br: true, bl: true })

  // ═══════════════════════════════════════════════════════════════════════
  //  Merge & UV projection
  // ═══════════════════════════════════════════════════════════════════════
  let merged = mergeGeometries(geometries, false)
  if (merged.index) merged = merged.toNonIndexed()
  merged.computeVertexNormals()
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  applyPerTriangleUVProjection(merged)

  return merged
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-triangle UV projection
//
// Key differences from the previous (broken) per-vertex approach:
//
// 1.  Classification is per-TRIANGLE, not per-vertex. The flat face normal
//     (identical for all 3 vertices in non-indexed geometry) determines whether
//     the entire triangle is a stamp face or a clean-wood face.  This makes
//     stamp bleeding onto adjacent faces mathematically impossible.
//
// 2.  UV normalisation uses the block's LOCAL geometric bounds
//     (e.g., a 145mm × 100mm block at a known centre position), not the
//     GLOBAL pallet bounds.  This maps the full stamp texture exactly onto
//     the face without stretching or fragmentation.
//
// 3.  V-axis is NOT inverted.  Block bottom Y=0.022 → stamp vMin,
//     block top Y=0.100 → stamp vMax.  This keeps text upright in WebGL
//     texture space where V=0 is the bottom of the image.
//
// 4.  U-axis is flipped for negative-normal faces (−X, −Z) so that text
//     always reads left-to-right from the viewer's perspective.
// ─────────────────────────────────────────────────────────────────────────────

function applyPerTriangleUVProjection(geo: THREE.BufferGeometry): void {
  const pos  = geo.attributes.position as THREE.BufferAttribute
  const norm = geo.attributes.normal   as THREE.BufferAttribute
  if (!pos || !norm) return

  const uvs = new Float32Array(pos.count * 2)

  // Stamp atlas UV bounds (with ~2 px inward padding to avoid sub-pixel bleed).
  // Derived from epal-textures.ts canvas pixel positions on a 1024 × 1024 atlas:
  //   EPAL oval  — Canvas X 40→280,  Y 650→800
  //   EUR  oval  — Canvas X 320→560, Y 650→800
  //   IPPC box   — Canvas X 600→960, Y 650→982
  const epalUV = { uMin: 0.042, uMax: 0.271, vMin: 0.221, vMax: 0.363 }
  const eurUV  = { uMin: 0.315, uMax: 0.544, vMin: 0.221, vMax: 0.363 }
  const ippcUV = { uMin: 0.588, uMax: 0.935, vMin: 0.043, vMax: 0.363 }

  const numTriangles = pos.count / 3

  for (let t = 0; t < numTriangles; t++) {
    const i0 = t * 3
    const i1 = i0 + 1
    const i2 = i0 + 2

    // Flat face normal (all 3 verts share the same normal in non-indexed geo)
    const nx = norm.getX(i0)
    const ny = norm.getY(i0)
    const nz = norm.getZ(i0)

    // Triangle centroid
    const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3
    const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3
    const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3

    // Classify this triangle
    let isStamp   = false
    let stamp     = epalUV
    let projAxis: 'X' | 'Z' = 'Z'
    let bMin = 0
    let bMax = 1
    let flipU = false

    // A triangle qualifies for stamping only if:
    //   (a) its centroid Y is within the block layer (0.022 – 0.100),
    //   (b) its face normal is predominantly horizontal (|ny| < 0.3), AND
    //   (c) it belongs to a known block whose outward face matches the normal.
    if (cy > 0.020 && cy < 0.102 && Math.abs(ny) < 0.3) {
      const block = findBlock(cx, cz)

      if (block) {
        // ── Left-column block, −X face → EPAL  (or IPPC for centre row) ──
        if (nx < -0.8 && block.col === 'left') {
          isStamp  = true
          stamp    = block.row === 'center' ? ippcUV : epalUV
          projAxis = 'Z'
          bMin     = block.cz - block.hwz
          bMax     = block.cz + block.hwz
          flipU    = true  // −X face: flip U so text reads L→R
        }
        // ── Right-column block, +X face → EUR  (or IPPC for centre row) ──
        else if (nx > 0.8 && block.col === 'right') {
          isStamp  = true
          stamp    = block.row === 'center' ? ippcUV : eurUV
          projAxis = 'Z'
          bMin     = block.cz - block.hwz
          bMax     = block.cz + block.hwz
          flipU    = false
        }
        // ── Back-row block, −Z face → EPAL / IPPC / EUR by column ──
        else if (nz < -0.8 && block.row === 'back') {
          isStamp  = true
          stamp    = block.col === 'center' ? ippcUV
                   : block.col === 'left'   ? epalUV
                   :                          eurUV
          projAxis = 'X'
          bMin     = block.cx - block.hwx
          bMax     = block.cx + block.hwx
          flipU    = true  // −Z face: flip U so text reads L→R
        }
        // ── Front-row block, +Z face → EPAL / IPPC / EUR by column ──
        else if (nz > 0.8 && block.row === 'front') {
          isStamp  = true
          stamp    = block.col === 'center' ? ippcUV
                   : block.col === 'left'   ? epalUV
                   :                          eurUV
          projAxis = 'X'
          bMin     = block.cx - block.hwx
          bMax     = block.cx + block.hwx
          flipU    = false
        }
        // All other faces (top, bottom, chamfer diagonals, tunnel-facing
        // sides) fall through and get clean wood.
      }
    }

    // Assign UVs for all 3 vertices of this triangle
    for (let v = 0; v < 3; v++) {
      const idx = i0 + v
      const px = pos.getX(idx)
      const py = pos.getY(idx)
      const pz = pos.getZ(idx)

      if (isStamp) {
        // Project position onto local block face UV space
        const rawU  = projAxis === 'X' ? px : pz
        let   normU = (rawU - bMin) / (bMax - bMin)
        if (flipU) normU = 1.0 - normU

        // V = vertical position within block, bottom→vMin, top→vMax
        let normV = (py - 0.022) / 0.078

        normU = Math.max(0.0, Math.min(1.0, normU))
        normV = Math.max(0.0, Math.min(1.0, normV))

        uvs[idx * 2]     = stamp.uMin + normU * (stamp.uMax - stamp.uMin)
        uvs[idx * 2 + 1] = stamp.vMin + normV * (stamp.vMax - stamp.vMin)
      } else {
        // Clean wood: deterministic hash projection into V ∈ [0.60, 0.95]
        uvs[idx * 2]     = 0.1  + (Math.abs(px * 3.7 + pz * 2.3) % 1) * 0.8
        uvs[idx * 2 + 1] = 0.60 + (Math.abs(py * 5.1 + px * 1.9) % 1) * 0.35
      }
    }
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}

// ─────────────────────────────────────────────────────────────────────────────

export function getOrCreateEPALLOD1Geometry(): THREE.BufferGeometry {
  if (cachedEPALLOD1Geometry) return cachedEPALLOD1Geometry
  cachedEPALLOD1Geometry = getOrCreateEPALGeometry().clone()
  return cachedEPALLOD1Geometry
}
