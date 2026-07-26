import type { PalletRackNode } from './schema'
import { bayPitch, rowDepth } from './slots'

/**
 * Laying a run down from one bay.
 *
 * A bay is a node, so a run is a line of nodes and "20 bays" is a command that
 * places nineteen more beside the one you configured. Every sibling is an
 * ordinary node from that moment on — selectable, movable, deletable,
 * copyable — which is the whole reason the kind is shaped this way.
 *
 * Everything here is pure: it returns the positions, it does not create
 * anything. That keeps the arithmetic — which is where the sign errors live —
 * testable without a store.
 */

export type MultiplySpec = {
  /** Bays along the run, counting the source. 1 places nothing. */
  bays: number
  /** Parallel runs, counting the source. */
  rows: number
  /**
   * Whether rows pair up spine to spine.
   *
   * A switch, not a count: a run either has another run against its back or it
   * does not. When set, rows alternate — pair, aisle, pair — and the second run
   * of each pair is **turned around**, because back to back means two runs
   * served from *opposite* aisles. Without the turn the second run's open face
   * would look into the spine gap, and every capacity figure that distinguishes
   * a directly reachable position from one behind it would be wrong.
   */
  backToBack: boolean
  /** Gap between the two runs of a back-to-back pair. */
  backToBackGap: number
  /**
   * Working aisle between runs that are not paired.
   *
   * 3.2 m is a reach truck. A counterbalanced forklift wants about 3.5 m and a
   * turret truck as little as 1.6 m, which is the swing that decides how much
   * of a building is racking and how much is floor.
   */
  aisleWidth: number
}

export const DEFAULT_MULTIPLY: MultiplySpec = {
  bays: 1,
  rows: 1,
  backToBack: false,
  backToBackGap: 0.2,
  aisleWidth: 3.2,
}

/** One sibling to place: where it goes and which way it looks. */
export type MultiplyPlacement = {
  position: [number, number, number]
  rotation: [number, number, number]
}

/**
 * Local +X offsets, one per bay.
 *
 * The pitch is `bayClearWidth + uprightWidth` — the distance at which one bay's
 * right frame lands exactly on the next one's left frame, which is what lets
 * `./neighbours` drop the duplicate post and show a run of N bays on N+1
 * frames.
 */
export function bayOffsets(rack: PalletRackNode, bays: number): number[] {
  const pitch = bayPitch(rack)
  const count = Math.max(1, Math.floor(bays))
  return Array.from({ length: count }, (_, index) => index * pitch)
}

/**
 * Local Z offsets and facings, one per row.
 *
 * Rows march along local **−Z** because a bay's open face is at local +Z: the
 * first run keeps the aisle it was placed against and the rest go in behind it.
 *
 * `flipped` is the back-to-back turn. It only ever applies to the second run of
 * a pair, so an unpaired layout returns all-false and every run faces the same
 * way.
 */
export function rowOffsets(
  rack: PalletRackNode,
  spec: MultiplySpec,
): Array<{ z: number; flipped: boolean }> {
  const depth = rowDepth(rack)
  const count = Math.max(1, Math.floor(spec.rows))
  const rows: Array<{ z: number; flipped: boolean }> = [{ z: 0, flipped: false }]

  let z = 0
  for (let row = 1; row < count; row++) {
    // Odd rows close a pair, even rows open the next one. Without pairing every
    // gap is an aisle, which is exactly what `backToBack: false` should mean.
    const closesPair = spec.backToBack && row % 2 === 1
    z -= depth + (closesPair ? spec.backToBackGap : spec.aisleWidth)
    rows.push({ z, flipped: closesPair })
  }
  return rows
}

/**
 * The rectangle the whole run occupies, and where its middle sits relative to
 * the source bay.
 *
 * One derivation, three consumers: the placement box the tool collides and
 * draws, the length and depth the panel reports, and the tests. Computing it
 * twice is how a run that reads 57.0 m in the panel ends up refusing to fit a
 * 57.5 m building.
 *
 * `centerLocal` is needed because the source bay is an *end* of the run, not its
 * middle: bays grow along +X and rows along −Z, so the centre is half a run
 * along each.
 */
export type RunExtent = {
  /**
   * Overall steel length — N pitches plus the closing post. The figure you would
   * measure against a wall, and the one the panel reports.
   */
  width: number
  /**
   * What the run occupies in the spatial grid, which is **not** the same number.
   *
   * A bay's declared footprint is one pitch wide (see `definition.ts`), so N
   * bays tile exactly N pitches and the half-post at each end overhangs — the
   * same overhang a single bay already has, and the same one the footplates
   * have. Using the steel length here instead would make a run refuse to sit
   * against the run beside it, which is the bug this pair of numbers exists to
   * keep fixed.
   */
  collisionWidth: number
  depth: number
  centerLocal: [number, number]
}

export function runExtent(rack: PalletRackNode, spec: MultiplySpec): RunExtent {
  const pitch = bayPitch(rack)
  const bays = Math.max(1, Math.floor(spec.bays))
  const rows = rowOffsets(rack, spec)
  const lastRowZ = rows[rows.length - 1]?.z ?? 0
  const bay = rowDepth(rack)

  return {
    width: pitch * bays + rack.uprightWidth,
    collisionWidth: pitch * bays,
    depth: bay - lastRowZ,
    centerLocal: [((bays - 1) * pitch) / 2, lastRowZ / 2],
  }
}

/**
 * Where a local-frame offset lands in world space.
 *
 * A +Y rotation carries local +X onto world (cos, −sin) and local +Z onto
 * (sin, cos). The sign on X is the one that is easy to get backwards, and
 * getting it backwards lays the run down mirrored — which looks right until the
 * scene is rotated.
 */
export function localToWorld(
  rack: PalletRackNode,
  localX: number,
  localZ: number,
): [number, number, number] {
  const [x, y, z] = rack.position
  const rotationY = rack.rotation?.[1] ?? 0
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [x + localX * cos + localZ * sin, y, z - localX * sin + localZ * cos]
}

/**
 * Every sibling the spec asks for, **excluding the source bay itself**.
 *
 * The source keeps its own position, so multiplying never moves what the user
 * already placed and aligned. Reducing a count later deletes nothing either —
 * the siblings are nodes, and nodes go when you delete them.
 */
export function multiplyPlacements(rack: PalletRackNode, spec: MultiplySpec): MultiplyPlacement[] {
  const [tiltX, rotationY, rollZ] = rack.rotation ?? [0, 0, 0]
  const rows = rowOffsets(rack, spec)
  const bays = bayOffsets(rack, spec.bays)
  const placements: MultiplyPlacement[] = []

  rows.forEach((row, rowIndex) => {
    bays.forEach((localX, bayIndex) => {
      if (rowIndex === 0 && bayIndex === 0) return
      placements.push({
        position: localToWorld(rack, localX, row.z),
        rotation: [tiltX, rotationY + (row.flipped ? Math.PI : 0), rollZ],
      })
    })
  })
  return placements
}
