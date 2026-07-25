import * as THREE from 'three'
import type { PalletRackNode } from './schema'
import {
  bayCenterX,
  bayPitch,
  depthPositionZ,
  frameCentersX,
  levelBeamHeight,
  levelHasShelf,
  levelSurfaceY,
  palletSupportBarCount,
  rowCount,
  slotOffsetsX,
  storageLevels,
} from './slots'

/**
 * One merged BufferGeometry per rack *shape*.
 *
 * The whole performance story of this node is in that word. A 10-bay 4-level
 * run is roughly 250 separate steel parts; drawing them as 250 meshes — which
 * is what the version being replaced did, each with its own inline material —
 * costs 250 draw calls per rack, so a thousand racks is a quarter of a million
 * and the frame never lands. Merging them costs one.
 *
 * The cache key is derived from the fields that change the shape and
 * deliberately *not* from the node's id, name, position or rotation. That is
 * what makes a warehouse cheap rather than merely survivable: real layouts
 * repeat the same rack hundreds of times, so a thousand racks resolve to a
 * handful of geometries that they share, and memory stays flat as the rack
 * count grows. Keying on the node would give a thousand identical meshes.
 *
 * Part colours ride in the vertex colour attribute, so every rack in the scene
 * — blue uprights, orange beams, galvanised shelves — draws from a single
 * shared material.
 */

// ── Box emitter ─────────────────────────────────────────────────────────────

type Sink = {
  positions: number[]
  normals: number[]
  colors: number[]
  indices: number[]
}

/** Unit-cube faces as outward normal plus four CCW corners in half-extents. */
const FACES: Array<{ n: [number, number, number]; c: Array<[number, number, number]> }> = [
  {
    n: [0, 0, 1],
    c: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  {
    n: [0, 0, -1],
    c: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
  },
  {
    n: [1, 0, 0],
    c: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
  },
  {
    n: [-1, 0, 0],
    c: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  {
    n: [0, 1, 0],
    c: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  },
  {
    n: [0, -1, 0],
    c: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
]

/**
 * Append an axis-aligned box.
 *
 * Written straight into flat arrays rather than built from `BoxGeometry` and
 * merged: a merge allocates one geometry per part and then throws all 250 away,
 * where this touches only the arrays it fills. Flat normals need four vertices
 * per face, which is why the corners are not shared.
 */
function emitBox(
  sink: Sink,
  center: readonly [number, number, number],
  size: readonly [number, number, number],
  color: readonly [number, number, number],
): void {
  const [cx, cy, cz] = center
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2]

  for (const face of FACES) {
    const base = sink.positions.length / 3
    for (const corner of face.c) {
      sink.positions.push(cx + corner[0] * hx, cy + corner[1] * hy, cz + corner[2] * hz)
      sink.normals.push(face.n[0], face.n[1], face.n[2])
      sink.colors.push(color[0], color[1], color[2])
    }
    sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

/**
 * Append a box rotated about X, for frame bracing.
 *
 * Bracing runs diagonally in the frame's depth/height plane, so a single X
 * rotation covers it and a full matrix would be dead weight.
 */
function emitTiltedBox(
  sink: Sink,
  center: readonly [number, number, number],
  size: readonly [number, number, number],
  angleX: number,
  color: readonly [number, number, number],
): void {
  const [cx, cy, cz] = center
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2]
  const cos = Math.cos(angleX)
  const sin = Math.sin(angleX)

  for (const face of FACES) {
    const base = sink.positions.length / 3
    const ny = face.n[1] * cos - face.n[2] * sin
    const nz = face.n[1] * sin + face.n[2] * cos
    for (const corner of face.c) {
      const y = corner[1] * hy
      const z = corner[2] * hz
      sink.positions.push(cx + corner[0] * hx, cy + y * cos - z * sin, cz + y * sin + z * cos)
      sink.normals.push(face.n[0], ny, nz)
      sink.colors.push(color[0], color[1], color[2])
    }
    sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

// ── Palette ─────────────────────────────────────────────────────────────────

const colorCache = new Map<string, [number, number, number]>()

/**
 * Hex to the renderer's working colour space.
 *
 * `THREE.Color` treats a hex literal as sRGB and converts on assignment when
 * colour management is on, which is what the material expects from a vertex
 * colour. Writing the raw hex bytes straight into the attribute — the obvious
 * shortcut — renders every part visibly too bright.
 */
function toLinear(hex: string): [number, number, number] {
  const cached = colorCache.get(hex)
  if (cached) return cached
  const color = new THREE.Color(hex)
  const linear: [number, number, number] = [color.r, color.g, color.b]
  colorCache.set(hex, linear)
  return linear
}

const BRACING_COLOR = '#94a3b8'
const FOOTPLATE_COLOR = '#334155'
const SHELF_COLOR = '#9aa5b1'
const SUPPORT_BAR_COLOR = '#cbd5e1'

// ── Detail ──────────────────────────────────────────────────────────────────

/**
 * How much of the rack to build.
 *
 * `simple` keeps the silhouette — posts and beams — and drops the bracing,
 * footplates, decking and support bars, which is around two thirds of the
 * parts and none of the readable shape past a few tens of metres. In a
 * warehouse most racks are always far away, so this is the difference between
 * the far field costing more than the near one and it costing almost nothing.
 */
export type RackDetail = 'full' | 'simple'

// ── Builder ─────────────────────────────────────────────────────────────────

function buildRack(rack: PalletRackNode, detail: RackDetail): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], indices: [] }
  const uprightColor = toLinear(rack.uprightColor)
  const beamColor = toLinear(rack.beamColor)
  const bracingColor = toLinear(BRACING_COLOR)
  const footplateColor = toLinear(FOOTPLATE_COLOR)
  const shelfColor = toLinear(SHELF_COLOR)
  const barColor = toLinear(SUPPORT_BAR_COLOR)

  const frames = frameCentersX(rack)
  const levels = storageLevels(rack).filter((level) => level > 0)
  const rows = rowCount(rack)
  const { uprightWidth, uprightDepth, depth, uprightHeight } = rack
  const halfPost = depth / 2 - uprightDepth / 2

  for (let row = 1; row <= rows; row++) {
    for (let position = 1; position <= rack.depthPositions; position++) {
      const centerZ = depthPositionZ(rack, row, position)
      const postZ = [centerZ + halfPost, centerZ - halfPost]

      // Frames: two posts per line per depth position.
      for (const x of frames) {
        for (const z of postZ) {
          emitBox(
            sink,
            [x, uprightHeight / 2, z],
            [uprightWidth, uprightHeight, uprightDepth],
            uprightColor,
          )
          if (detail === 'full') {
            // Catalogue footplates are wider than the post they carry — 175 ×
            // 119 mm under a 122 × 80 upright — so they overhang it by about
            // 26 mm each side. Real, and the reason the built mesh is slightly
            // wider at the floor than the declared footprint.
            emitBox(
              sink,
              [x, 0.01, z],
              [uprightWidth + 0.053, 0.02, uprightDepth + 0.039],
              footplateColor,
            )
          }
        }

        // Frame bracing zig-zags between the two posts, in the depth/height
        // plane. Panel count follows the height so tall frames do not end up
        // with a handful of very shallow diagonals.
        if (detail === 'full' && rack.bracing !== 'open') {
          // Bracing runs between nodes clear of both ends of the post: the
          // lowest sits above the footplate and the highest below the top beam,
          // which is how a frame is actually built. It also keeps the diagonals
          // — whose rotated cross-section reaches a centimetre past their end
          // nodes — from poking through the floor.
          const braceBottom = 0.15
          const braceTop = Math.max(braceBottom + 0.3, uprightHeight - 0.1)
          const bracedHeight = braceTop - braceBottom
          const panels = Math.max(3, Math.round(bracedHeight / 0.9))
          const step = bracedHeight / panels
          const span = depth - uprightDepth
          const length = Math.hypot(step, span)
          // The brace's local +Y must land on the (step, span) diagonal, so the
          // rotation is atan2(span, step). Using its complement instead — the
          // easy slip — swaps the two projections: the brace then spans the
          // frame's depth vertically, overshooting one panel's height, and the
          // bottom one drives 10 cm through the floor.
          const angle = Math.atan2(span, step)
          for (let panel = 0; panel < panels; panel++) {
            const midY = braceBottom + (panel + 0.5) * step
            const sign = panel % 2 === 0 ? 1 : -1
            emitTiltedBox(
              sink,
              [x, midY, centerZ],
              [0.03, length, 0.03],
              sign * angle,
              bracingColor,
            )
            if (rack.bracing === 'x-bracing') {
              emitTiltedBox(
                sink,
                [x, midY, centerZ],
                [0.03, length, 0.03],
                -sign * angle,
                bracingColor,
              )
            }
          }
        }
      }

      // Beams, shelves and support bars, per bay per level.
      for (let bay = 1; bay <= rack.bayCount; bay++) {
        const centerX = bayCenterX(rack, bay)
        for (const level of levels) {
          const beamHeight = levelBeamHeight(rack, level)
          const surface = levelSurfaceY(rack, level)
          const beamY = surface - beamHeight / 2
          for (const z of postZ) {
            emitBox(
              sink,
              [centerX, beamY, z],
              [bayPitch(rack), beamHeight, rack.beamThickness],
              beamColor,
            )
          }

          // Decking is a thin plate tucked between the beams — invisible past a
          // few tens of metres, and nine of them on a three-bay rack. Dropping
          // it from the far tier is most of what makes that tier cheap.
          if (detail === 'full' && levelHasShelf(rack, level)) {
            const thickness =
              levelBeamHeight(rack, level) === rack.pickingBeamHeight
                ? rack.pickingShelfThickness
                : 0.02
            emitBox(
              sink,
              [centerX, surface + thickness / 2, centerZ],
              [rack.bayClearWidth, thickness, depth - uprightDepth],
              shelfColor,
            )
          }

          if (detail === 'full') {
            const bars = palletSupportBarCount(rack)
            if (bars > 0) {
              for (const offset of slotOffsetsX(rack)) {
                const inset = ((bars - 1) / 2) * 0.25
                for (let bar = 0; bar < bars; bar++) {
                  emitBox(
                    sink,
                    [centerX + offset - inset + bar * 0.25, surface + 0.015, centerZ],
                    [0.04, 0.03, depth - uprightDepth],
                    barColor,
                  )
                }
              }
            }
          }
        }
      }
    }
  }

  // Row spacers tie a back-to-back pair together. Two ties per frame line is
  // what the catalogue shows, near the base and near the top.
  if (detail === 'full' && rack.backToBack) {
    const innerZ1 = depthPositionZ(rack, 1, rack.depthPositions) - depth / 2
    const innerZ2 = depthPositionZ(rack, 2, rack.depthPositions) + depth / 2
    const spanZ = innerZ1 - innerZ2
    const midZ = (innerZ1 + innerZ2) / 2
    for (const x of frames) {
      for (const y of [uprightHeight * 0.15, uprightHeight * 0.85]) {
        emitBox(sink, [x, y, midZ], [uprightWidth * 0.6, 0.05, spanZ], bracingColor)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sink.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(sink.normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(sink.colors, 3))
  geometry.setIndex(sink.indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// ── Cache ───────────────────────────────────────────────────────────────────

/**
 * Identity of a rack's *shape*.
 *
 * Every field that changes a vertex, and nothing else. Id, name, position,
 * rotation, `supportSlabId` and the ghost-fill fraction are all excluded, which
 * is the entire point: two racks that look the same must produce the same key
 * so they share one geometry. Including the node itself would give every rack
 * in the warehouse a private mesh and defeat the cache silently — it would
 * still be correct, just slow, which is the worst way for this to fail.
 */
export function rackGeometryKey(rack: PalletRackNode, detail: RackDetail): string {
  return [
    detail,
    rack.bayCount,
    rack.bayClearWidth,
    rack.depth,
    rack.uprightHeight,
    rack.backToBack ? 1 : 0,
    rack.backToBackGap,
    rack.depthPositions,
    rack.depthGap,
    rack.levels,
    rack.firstLevelClear,
    rack.levelClear,
    rack.groundLevelStorage ? 1 : 0,
    rack.pickingLevels,
    rack.levelTypes?.join('') ?? '',
    rack.pickingLevelClear,
    rack.pickingBeamHeight,
    rack.pickingShelfThickness,
    rack.uprightWidth,
    rack.uprightDepth,
    rack.beamHeight,
    rack.beamThickness,
    rack.bracing,
    rack.decking,
    rack.palletPreset,
    rack.palletOrientation,
    rack.palletsPerLevel ?? '',
    rack.palletSupportBars ?? '',
    rack.clearanceToUpright,
    rack.clearanceBetweenPallets,
    rack.uprightColor,
    rack.beamColor,
  ].join('|')
}

const cache = new Map<string, THREE.BufferGeometry>()

/**
 * Shared geometry for a rack shape.
 *
 * Never disposed while the app lives. That is deliberate rather than a leak:
 * the geometry belongs to the shape, not to any node, so disposing it when one
 * rack is deleted would blank every other rack that shares it — the same trap
 * the pallet renderer documents around `<GeometrySystem>`. A warehouse's worth
 * of distinct shapes is a few dozen meshes.
 */
export function getRackGeometry(rack: PalletRackNode, detail: RackDetail): THREE.BufferGeometry {
  const key = rackGeometryKey(rack, detail)
  const cached = cache.get(key)
  if (cached) return cached
  const geometry = buildRack(rack, detail)
  cache.set(key, geometry)
  return geometry
}

/** Distinct shapes built so far. Test and diagnostic hook for the sharing that
 *  the whole design depends on. */
export function rackGeometryCacheSize(): number {
  return cache.size
}

export function clearRackGeometryCache(): void {
  for (const geometry of cache.values()) geometry.dispose()
  cache.clear()
}
