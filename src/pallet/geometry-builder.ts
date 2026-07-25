import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ATLAS, type AtlasRect } from './epal-textures'
import { type PalletPreset, specOf } from './presets'

/**
 * A dimensionally correct EPAL 1 built from 20 real boards, ~304 triangles and
 * ~29 KB — measured, not estimated. Origin is the bottom centre, so dropping it
 * at floor level needs no offset.
 *
 * Ported from earlier work with its known defects fixed rather than copied. The
 * substantive ones:
 *
 *   - The markings on the two 800 mm ends rendered mirrored. The horizontal UV
 *     flip was applied to the wrong X face: for a +X surface, screen-right is
 *     world −Z, and for −X it is +Z. Both branches had it backwards.
 *   - Clean wood took its UVs from a hash of vertex position, so the three
 *     corners of a triangle got unrelated coordinates and "grain" was noise. It
 *     only passed because the wood band is nearly featureless. Now each face is
 *     projected planar at a fixed world scale with the grain running along the
 *     board.
 *   - `mergeGeometries` returns null on an attribute mismatch and the result
 *     was dereferenced unguarded.
 *
 * Added: baked ambient occlusion as vertex colours. There is no AO map and the
 * scene's shadow map is far too coarse to darken a 22 mm joint, so without this
 * the parts read as pasted together rather than nailed. It is the single
 * highest-impact visual change available here — ahead of nails or a better wood
 * texture.
 */

// ── EPAL 1 reference dimensions, metres ──────────────────────────────────
const L = 1.2
const W = 0.8
const BOARD_H = 0.022
const BLOCK_H = 0.078
const CHAMFER = 0.015

const BOTTOM_Y = BOARD_H / 2
const BLOCK_Y = BOARD_H + BLOCK_H / 2
const STRINGER_Y = BOARD_H + BLOCK_H + BOARD_H / 2
const TOP_Y = BOARD_H + BLOCK_H + BOARD_H + BOARD_H / 2

const CROSS_X = 0.5275
const BLOCK_Z = 0.35
const OUTER_TOP_Z = 0.3275
const INNER_TOP_Z = 0.16375

/** Height of each horizontal joint. Vertices near one are darkened. */
const JOINT_PLANES = [BOARD_H, BOARD_H + BLOCK_H, BOARD_H + BLOCK_H + BOARD_H]
const JOINT_RADIUS = 0.028

/**
 * World span mapped across the atlas wood band, metres. Both are a little
 * larger than the pallet itself so no face reaches the band edge, and — because
 * every face divides by the same two numbers — grain sits at one consistent
 * world scale across boards, blocks and tunnel walls alike. That is the whole
 * point of projecting rather than hashing.
 */
const GRAIN_SPAN = 1.3
const CROSS_SPAN = 0.9

type BlockColumn = 'left' | 'center' | 'right'
type BlockRow = 'back' | 'center' | 'front'

type BlockDef = {
  cx: number
  cz: number
  /** Half-width along X — always 72.5 mm. */
  hwx: number
  /** Half-width along Z — 50 mm on the outer rows, 72.5 mm on the centre row. */
  hwz: number
  col: BlockColumn
  row: BlockRow
}

const BLOCK_DEFS: BlockDef[] = [
  { cx: -CROSS_X, cz: -BLOCK_Z, hwx: 0.0725, hwz: 0.05, col: 'left', row: 'back' },
  { cx: 0, cz: -BLOCK_Z, hwx: 0.0725, hwz: 0.05, col: 'center', row: 'back' },
  { cx: CROSS_X, cz: -BLOCK_Z, hwx: 0.0725, hwz: 0.05, col: 'right', row: 'back' },
  { cx: -CROSS_X, cz: 0, hwx: 0.0725, hwz: 0.0725, col: 'left', row: 'center' },
  { cx: 0, cz: 0, hwx: 0.0725, hwz: 0.0725, col: 'center', row: 'center' },
  { cx: CROSS_X, cz: 0, hwx: 0.0725, hwz: 0.0725, col: 'right', row: 'center' },
  { cx: -CROSS_X, cz: BLOCK_Z, hwx: 0.0725, hwz: 0.05, col: 'left', row: 'front' },
  { cx: 0, cz: BLOCK_Z, hwx: 0.0725, hwz: 0.05, col: 'center', row: 'front' },
  { cx: CROSS_X, cz: BLOCK_Z, hwx: 0.0725, hwz: 0.05, col: 'right', row: 'front' },
]

/** Which block a point sits in, with tolerance for the chamfered corners. */
function findBlock(x: number, z: number): BlockDef | null {
  const tolerance = 0.012
  for (const b of BLOCK_DEFS) {
    if (Math.abs(x - b.cx) <= b.hwx + tolerance && Math.abs(z - b.cz) <= b.hwz + tolerance) {
      return b
    }
  }
  return null
}

// ── Assembly ─────────────────────────────────────────────────────────────

type Corners = { tl: boolean; tr: boolean; br: boolean; bl: boolean }

function buildEPAL1(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  /**
   * A part with 45° corner chamfers, extruded from a 2D outline.
   *
   * The outline is drawn in X-Y and extruded along +Z; after `center()` and
   * `rotateX(π/2)` the mapping is (x, y, z) → (x, −z, y), so shape-Y becomes
   * world-Z with no sign flip.
   *
   * Note the argument order differs from `addBox` below — (X, Z, Y) here versus
   * (X, Y, Z) there. That asymmetry is inherited and load-bearing: unifying
   * them without re-deriving every call site silently mangles the pallet.
   */
  const addChamfered = (
    w: number,
    l: number,
    h: number,
    x: number,
    y: number,
    z: number,
    c: Corners,
  ) => {
    const s = new THREE.Shape()
    const hw = w / 2
    const hl = l / 2
    const ch = CHAMFER

    if (c.tr) {
      s.moveTo(hw - ch, -hl)
      s.lineTo(hw, -hl + ch)
    } else {
      s.moveTo(hw, -hl)
    }
    if (c.br) {
      s.lineTo(hw, hl - ch)
      s.lineTo(hw - ch, hl)
    } else {
      s.lineTo(hw, hl)
    }
    if (c.bl) {
      s.lineTo(-hw + ch, hl)
      s.lineTo(-hw, hl - ch)
    } else {
      s.lineTo(-hw, hl)
    }
    if (c.tl) {
      s.lineTo(-hw, -hl + ch)
      s.lineTo(-hw + ch, -hl)
    } else {
      s.lineTo(-hw, -hl)
    }
    s.closePath()

    const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false })
    geo.center()
    geo.rotateX(Math.PI / 2)
    geo.translate(x, y, z)
    parts.push(geo.index ? geo.toNonIndexed() : geo)
  }

  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const geo = new THREE.BoxGeometry(w, h, d)
    geo.translate(x, y, z)
    parts.push(geo.index ? geo.toNonIndexed() : geo)
  }

  // Layer 4 — top deck, 5 boards
  addChamfered(L, 0.145, BOARD_H, 0, TOP_Y, -OUTER_TOP_Z, {
    tl: true,
    tr: true,
    br: false,
    bl: false,
  })
  addBox(L, BOARD_H, 0.1, 0, TOP_Y, -INNER_TOP_Z)
  addBox(L, BOARD_H, 0.145, 0, TOP_Y, 0)
  addBox(L, BOARD_H, 0.1, 0, TOP_Y, INNER_TOP_Z)
  addChamfered(L, 0.145, BOARD_H, 0, TOP_Y, OUTER_TOP_Z, {
    tl: false,
    tr: false,
    br: true,
    bl: true,
  })

  // Layer 3 — cross stringers, 3 boards
  addChamfered(0.145, W, BOARD_H, -CROSS_X, STRINGER_Y, 0, {
    tl: true,
    tr: false,
    br: false,
    bl: true,
  })
  addBox(0.145, BOARD_H, W, 0, STRINGER_Y, 0)
  addChamfered(0.145, W, BOARD_H, CROSS_X, STRINGER_Y, 0, {
    tl: false,
    tr: true,
    br: true,
    bl: false,
  })

  // Layer 2 — nine blocks
  addChamfered(0.145, 0.1, BLOCK_H, -CROSS_X, BLOCK_Y, -BLOCK_Z, {
    tl: true,
    tr: false,
    br: false,
    bl: false,
  })
  addBox(0.145, BLOCK_H, 0.1, 0, BLOCK_Y, -BLOCK_Z)
  addChamfered(0.145, 0.1, BLOCK_H, CROSS_X, BLOCK_Y, -BLOCK_Z, {
    tl: false,
    tr: true,
    br: false,
    bl: false,
  })
  addBox(0.145, BLOCK_H, 0.145, -CROSS_X, BLOCK_Y, 0)
  addBox(0.145, BLOCK_H, 0.145, 0, BLOCK_Y, 0)
  addBox(0.145, BLOCK_H, 0.145, CROSS_X, BLOCK_Y, 0)
  addChamfered(0.145, 0.1, BLOCK_H, -CROSS_X, BLOCK_Y, BLOCK_Z, {
    tl: false,
    tr: false,
    br: false,
    bl: true,
  })
  addBox(0.145, BLOCK_H, 0.1, 0, BLOCK_Y, BLOCK_Z)
  addChamfered(0.145, 0.1, BLOCK_H, CROSS_X, BLOCK_Y, BLOCK_Z, {
    tl: false,
    tr: false,
    br: true,
    bl: false,
  })

  // Layer 1 — bottom deck, 3 boards
  addChamfered(L, 0.1, BOARD_H, 0, BOTTOM_Y, -BLOCK_Z, {
    tl: true,
    tr: true,
    br: false,
    bl: false,
  })
  addBox(L, BOARD_H, 0.145, 0, BOTTOM_Y, 0)
  addChamfered(L, 0.1, BOARD_H, 0, BOTTOM_Y, BLOCK_Z, {
    tl: false,
    tr: false,
    br: true,
    bl: true,
  })

  const merged = mergeGeometries(parts, false)
  if (!merged) {
    // Only happens if the parts disagree on attributes. Dispose what we built
    // rather than leaking it, and let the caller fall back.
    for (const p of parts) p.dispose()
    throw new Error('[warehouse:pallet] mergeGeometries returned null')
  }

  const geometry = merged.index ? merged.toNonIndexed() : merged
  geometry.computeVertexNormals()
  applyUVs(geometry)
  applyBakedOcclusion(geometry)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// ── UVs ──────────────────────────────────────────────────────────────────

/**
 * Classification is per triangle, using the flat face normal that all three
 * vertices share in non-indexed geometry. That is what makes marking bleed
 * impossible: a triangle is entirely a marking or entirely wood, so no
 * interpolation can ever carry the ink onto a neighbouring face.
 */
function applyUVs(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined
  const norm = geo.attributes.normal as THREE.BufferAttribute | undefined
  if (!pos || !norm) return

  const uvs = new Float32Array(pos.count * 2)
  const triangles = pos.count / 3

  for (let t = 0; t < triangles; t++) {
    const i0 = t * 3
    const nx = norm.getX(i0)
    const ny = norm.getY(i0)
    const nz = norm.getZ(i0)

    const cx = (pos.getX(i0) + pos.getX(i0 + 1) + pos.getX(i0 + 2)) / 3
    const cy = (pos.getY(i0) + pos.getY(i0 + 1) + pos.getY(i0 + 2)) / 3
    const cz = (pos.getZ(i0) + pos.getZ(i0 + 1) + pos.getZ(i0 + 2)) / 3

    const marking = classifyMarking(cx, cy, cz, nx, ny, nz)

    for (let v = 0; v < 3; v++) {
      const idx = i0 + v
      const px = pos.getX(idx)
      const py = pos.getY(idx)
      const pz = pos.getZ(idx)

      if (marking) {
        const raw = marking.axis === 'X' ? px : pz
        let u = (raw - marking.min) / (marking.max - marking.min)
        if (marking.flipU) u = 1 - u
        // The block's full 78 mm height maps to the mark's full height, so
        // text always sits upright regardless of which face it lands on.
        let vv = (py - BOARD_H) / BLOCK_H
        u = clamp01(u)
        vv = clamp01(vv)
        uvs[idx * 2] = lerp(marking.rect.uMin, marking.rect.uMax, u)
        uvs[idx * 2 + 1] = lerp(marking.rect.vMin, marking.rect.vMax, vv)
      } else {
        const [u, vv] = woodUV(px, py, pz, nx, ny, nz)
        uvs[idx * 2] = u
        uvs[idx * 2 + 1] = vv
      }
    }
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}

type Marking = {
  rect: AtlasRect
  axis: 'X' | 'Z'
  min: number
  max: number
  flipU: boolean
}

function classifyMarking(
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number,
): Marking | null {
  // Must sit in the block layer, face near-horizontally, and belong to a block.
  if (cy <= 0.02 || cy >= 0.102 || Math.abs(ny) >= 0.3) return null
  const block = findBlock(cx, cz)
  if (!block) return null

  const zSpan = { min: block.cz - block.hwz, max: block.cz + block.hwz }
  const xSpan = { min: block.cx - block.hwx, max: block.cx + block.hwx }

  // On an X-facing surface the screen-right direction is −Z for +X and +Z for
  // −X. The original had both branches inverted, which mirrored every mark on
  // the two short ends.
  if (nx < -0.8 && block.col === 'left') {
    return {
      rect: block.row === 'center' ? ATLAS.ippc : ATLAS.epal,
      axis: 'Z',
      ...zSpan,
      flipU: false,
    }
  }
  if (nx > 0.8 && block.col === 'right') {
    return {
      rect: block.row === 'center' ? ATLAS.ippc : ATLAS.eur,
      axis: 'Z',
      ...zSpan,
      flipU: true,
    }
  }
  if (nz < -0.8 && block.row === 'back') {
    return {
      rect: block.col === 'center' ? ATLAS.ippc : block.col === 'left' ? ATLAS.epal : ATLAS.eur,
      axis: 'X',
      ...xSpan,
      flipU: true,
    }
  }
  if (nz > 0.8 && block.row === 'front') {
    return {
      rect: block.col === 'center' ? ATLAS.ippc : block.col === 'left' ? ATLAS.epal : ATLAS.eur,
      axis: 'X',
      ...xSpan,
      flipU: false,
    }
  }
  return null
}

/**
 * Planar projection at a fixed world scale, with the grain axis chosen so it
 * runs along the board rather than across it.
 *
 * A single linear map, no tiling and no clamping. Tiling was the obvious first
 * try and it is wrong here: a 1200 mm deck board is longer than any tile small
 * enough to give the blocks useful density, so its outer vertices clamped and
 * the texture smeared along the last third of every board. Because the whole
 * pallet fits inside one span, one map covers it — and since every face divides
 * by the same two numbers, texel density is identical everywhere.
 */
function woodUV(
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
): [number, number] {
  const ax = Math.abs(nx)
  const ay = Math.abs(ny)
  const az = Math.abs(nz)

  let s: number
  let tt: number
  if (ay >= ax && ay >= az) {
    // Deck and underside: grain along the board's length (X).
    s = px
    tt = pz
  } else if (ax >= az) {
    // Short ends: the visible run is Z, height is Y.
    s = pz
    tt = py
  } else {
    // Long sides and tunnel walls: run along X, height Y.
    s = px
    tt = py
  }

  const u = s / GRAIN_SPAN + 0.5
  const v = tt / CROSS_SPAN + 0.5

  return [lerp(ATLAS.wood.uMin, ATLAS.wood.uMax, u), lerp(ATLAS.wood.vMin, ATLAS.wood.vMax, v)]
}

// ── Baked occlusion ──────────────────────────────────────────────────────

/**
 * Writes a greyscale `color` attribute that the material multiplies into the
 * albedo. Three cheap terms, chosen because they are the ones a viewer notices:
 * the dark line where a board meets a block, the shaded interior of the fork
 * tunnels, and the undersides.
 *
 * This is an approximation, not a raytraced bake — it costs one pass over the
 * vertices and needs no offline step, which is what keeps the asset a pure
 * function of its code.
 */
function applyBakedOcclusion(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined
  const norm = geo.attributes.normal as THREE.BufferAttribute | undefined
  if (!pos || !norm) return

  const colors = new Float32Array(pos.count * 3)
  const halfL = L / 2
  const halfW = W / 2

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const ny = norm.getY(i)

    let occ = 0

    // Contact shading at the three horizontal joints — but only on surfaces
    // that can actually see the crevice. The deck's top face lies 22 mm above
    // the stringer joint, well inside the falloff, yet it faces open sky and
    // must stay the brightest surface on the pallet.
    if (ny < 0.7) {
      for (const plane of JOINT_PLANES) {
        const d = Math.abs(y - plane)
        if (d < JOINT_RADIUS) occ += (1 - d / JOINT_RADIUS) * 0.45
      }
    }

    // Undersides see almost no sky.
    if (ny < -0.5) occ += 0.22

    // Interior surfaces — the tunnel walls and the middle of the underside —
    // are enclosed on more sides than the perimeter is.
    const edgeDistance = Math.min(halfL - Math.abs(x), halfW - Math.abs(z))
    if (edgeDistance > 0.12) occ += 0.18

    const shade = 1 - Math.min(0.62, occ)
    colors[i * 3] = shade
    colors[i * 3 + 1] = shade
    colors[i * 3 + 2] = shade
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

// ── Cache ────────────────────────────────────────────────────────────────

const cache = new Map<PalletPreset, THREE.BufferGeometry>()

/**
 * One cached geometry per preset, shared by every pallet in the scene.
 *
 * Non-EPAL-1 presets are the canonical build scaled to their footprint. A real
 * EPAL 2 has a different board count, so this is an approximation — but it is
 * dimensionally correct in silhouette and footprint, which is what a layout
 * tool is measured on, and it costs one clone instead of a second builder.
 *
 * Never dispose the returned geometry: it is shared. `renderer.tsx` mounts it
 * with `dispose={null}` for exactly this reason.
 */
export function getPalletGeometry(preset: PalletPreset): THREE.BufferGeometry {
  const cached = cache.get(preset)
  if (cached) return cached

  let base = cache.get('epal-1')
  if (!base) {
    base = buildEPAL1()
    cache.set('epal-1', base)
  }
  if (preset === 'epal-1') return base

  const spec = specOf(preset)
  const scaled = base.clone()
  scaled.scale(spec.length / L, spec.height / (BOARD_H * 3 + BLOCK_H), spec.width / W)
  scaled.computeBoundingBox()
  scaled.computeBoundingSphere()
  cache.set(preset, scaled)
  return scaled
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
