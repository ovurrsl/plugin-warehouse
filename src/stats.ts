import {
  allLevels,
  asBuilding,
  asLevel,
  asSlab,
  ringSelfIntersects,
  type SlabLike,
  slabArea,
  walkSubtree,
} from './host-adapter'
import { KIND_PREFIX } from './plugin-id'
import { PalletRackNode } from './rack/schema'
import {
  levelTypeOf,
  palletSlotsOf,
  palletsPerLevel,
  pickingSlotsOf,
  storageLevels,
  storageLevelsPresent,
} from './rack/slots'
import type { StatsScope } from './store'

/**
 * What the warehouse holds, as three numbers a user can defend.
 *
 * **Storage** is pallet positions, **Picking** is container positions, and
 * **Footprint** is floor area. Nothing on this screen adds the first two
 * together, because a pallet location and a carton location are not the same
 * unit and a total of them is a number with no meaning.
 *
 * ## Why this is a module and not a component
 *
 * `useScene` is plain zustand: a selector's result is compared with `Object.is`,
 * so a selector that walks the node map and returns a fresh object re-renders
 * its component on **every store write** — every drag tick of every unrelated
 * node. The index below is memoised on the store's `nodes` object identity, so
 * the panel's selector is one reference comparison and the walk happens once per
 * commit. The same pattern the rack's occupancy index and the conveyor's line
 * index already use, for the same reason.
 *
 * ## The rule this file follows
 *
 * **Never subtract from the pure functions — disclose.** `palletSlotsOf` and
 * `pickingSlotsOf` are the single authority on what a bay holds, and the
 * renderer draws exactly those slots. Where a figure is arguably overstated —
 * a mezzanine counted alongside the floor beneath it — the number stays as
 * enumerated and a qualification says so. A second opinion about a number the
 * renderer already owns is the disease the version this replaces had, where a
 * capacity read from an untyped metadata blob disagreed with the rack on screen.
 *
 * The one exception is a value that is not a quantity at all: a self-crossing
 * outline has no area, so it is withheld rather than disclosed.
 */

export type FigureId = 'storage' | 'picking' | 'footprint'
export type FigureStatus = 'exact' | 'qualified' | 'unavailable'

export type QualificationSeverity = 'blocking' | 'overstates' | 'note'

export type QualificationCode =
  | 'slabs-unreadable'
  | 'slab-self-intersecting'
  | 'racks-unreadable'
  | 'elevation-bands'
  | 'tunnelled-bay'
  | 'floor-pallets'
  | 'ghost-fill'
  | 'hidden-nodes'
  | 'nodes-outside-levels'

export type Qualification = {
  code: QualificationCode
  severity: QualificationSeverity
  figure: FigureId
  /** How many things are affected — racks, slabs or nodes, per code. */
  count: number
  /** The size of the effect where one can be stated: m² or positions. */
  amount?: number
}

export type SlabFigure = {
  id: string
  levelId: string
  label: string
  /** Outline less its holes, m². Zero when the outline crosses itself. */
  area: number
  /** Outline alone, m². */
  gross: number
  elevation: number | undefined
  selfIntersecting: boolean
}

export type LevelFigures = {
  id: string
  name: string | undefined
  ordinal: number
  buildingId: string | null
  rackCount: number
  palletPositions: number
  directPositions: number
  containerPositions: number
  tunnelledRacks: number
  tunnelRemoved: number
  ghostRacks: number
  /** Pallets standing in a slot of a rack on this level. */
  occupiedPositions: number
  floorPallets: number
  hiddenNodes: number
  unreadableRacks: number
  slabs: readonly SlabFigure[]
  slabNodesPresent: number
  slabNodesReadable: number
}

export type SceneStats = {
  levels: readonly LevelFigures[]
  levelsById: ReadonlyMap<string, LevelFigures>
  levelIdsByBuilding: ReadonlyMap<string, readonly string[]>
  /** Display name per building — never `undefined`, so two unnamed buildings
   *  cannot present two identical level labels. */
  buildingNameById: ReadonlyMap<string, string>
  /** Every node this plugin owns, for the panel header's chip. */
  placed: number
  /** Plugin nodes reached from no level at all — silent loss, made visible. */
  outsideLevels: number
}

export type StatsScopeResolution = {
  requested: StatsScope
  resolved: StatsScope
  buildingId: string | null
  levelId: string | null
  levelIds: readonly string[]
  levelChoices: readonly { id: string; label: string }[]
  label: string
  /** Set when the request could not be honoured and a wider scope was used. */
  widenedNote: string | null
}

export type StatsReport = {
  palletPositions: number
  directPositions: number
  containerPositions: number
  occupiedPositions: number
  rackCount: number
  /** Sum over the slabs the filter admits, m². */
  area: number
  /** Sum over every slab in scope, ignoring the filter, m². */
  areaAllSlabs: number
  slabs: readonly SlabFigure[]
  countedSlabs: number
  status: Readonly<Record<FigureId, FigureStatus>>
  qualifications: readonly Qualification[]
}

const EMPTY_STATS: SceneStats = {
  levels: [],
  levelsById: new Map(),
  levelIdsByBuilding: new Map(),
  buildingNameById: new Map(),
  placed: 0,
  outsideLevels: 0,
}

// ── Per-node memos ──────────────────────────────────────────────────────────

type RackFigures = {
  palletPositions: number
  directPositions: number
  containerPositions: number
  /** Pallet positions a tunnel removed from this bay. */
  tunnelRemoved: number
  ghost: boolean
}

/**
 * Keyed on the rack node object, so nudging one rack re-enumerates one rack.
 *
 * The scene index rebuilds on every store write, and `palletSlotsOf` allocates a
 * slot object and formats an address string per position. Without this, one drag
 * tick in a two-thousand-bay warehouse allocates about twenty-four thousand
 * strings; with it, twelve.
 */
const rackFigureCache = new WeakMap<object, RackFigures | null>()

function rackFiguresOf(node: object): RackFigures | null {
  const hit = rackFigureCache.get(node)
  if (hit !== undefined) return hit

  const parsed = PalletRackNode.safeParse(node)
  if (!parsed.success) {
    // A hand-edited file with `bayClearWidth: "wide"` used to cascade into NaN
    // with no complaint. Excluded and counted, never measured.
    rackFigureCache.set(node, null)
    return null
  }

  const rack = parsed.data
  const pallets = palletSlotsOf(rack)
  const present = new Set(storageLevelsPresent(rack))
  // Closed form rather than a second enumeration: the levels a tunnel opened are
  // exactly the pallet levels the bay would otherwise have had.
  const tunnelRemoved =
    storageLevels(rack).filter(
      (level) => !present.has(level) && levelTypeOf(rack, level) === 'pallet',
    ).length *
    palletsPerLevel(rack) *
    rack.depthPositions

  const figures: RackFigures = {
    palletPositions: pallets.length,
    directPositions: pallets.filter((slot) => slot.directAccess).length,
    containerPositions: pickingSlotsOf(rack).length,
    tunnelRemoved,
    ghost: rack.ghostFill > 0,
  }
  rackFigureCache.set(node, figures)
  return figures
}

type SlabAudit = { area: number; gross: number; selfIntersecting: boolean }

/** Keyed on the raw host slab node, so a rack nudge does no slab geometry. */
const slabAuditCache = new WeakMap<object, SlabAudit>()

function slabAuditOf(node: object, slab: SlabLike): SlabAudit {
  const hit = slabAuditCache.get(node)
  if (hit) return hit
  const selfIntersecting = ringSelfIntersects(slab.polygon)
  const audit: SlabAudit = {
    area: selfIntersecting ? 0 : slabArea(slab),
    gross: selfIntersecting ? 0 : Math.max(0, slabArea({ ...slab, holes: [] })),
    selfIntersecting,
  }
  slabAuditCache.set(node, audit)
  return audit
}

// ── The scene index ─────────────────────────────────────────────────────────

let indexedFrom: unknown = null
let index: SceneStats = EMPTY_STATS

/**
 * Everything the panel reads, built once per store write.
 *
 * Returns the **same object** until `nodes` changes, which is what lets the
 * panel subscribe with a plain selector without re-rendering on every unrelated
 * write.
 */
export function sceneStats(nodes: Readonly<Record<string, unknown>>): SceneStats {
  if (indexedFrom === nodes) return index
  indexedFrom = nodes
  index = buildIndex(nodes)
  return index
}

/** Drops the memos. Tests only — the same contract the occupancy index has. */
export function resetStatsIndex(): void {
  indexedFrom = null
  index = EMPTY_STATS
}

function buildIndex(nodes: Readonly<Record<string, unknown>>): SceneStats {
  const buildingNameById = new Map<string, string>()
  const buildingOfLevel = new Map<string, string>()
  let placed = 0
  let unnamedBuildings = 0

  for (const node of Object.values(nodes)) {
    const record = node as { type?: unknown } | null
    if (record && typeof record.type === 'string' && record.type.startsWith(KIND_PREFIX)) {
      placed += 1
    }
    const building = asBuilding(node)
    if (!building) continue
    // An unnamed building still needs to be distinguishable: two of them each
    // with a "Ground" would otherwise offer the user two identical rows in the
    // level picker and no way to tell which storey they were about to scope to.
    // Numbered in discovery order, which is the node map's insertion order and
    // therefore stable for a given file.
    if (building.name) {
      buildingNameById.set(building.id, building.name)
    } else {
      unnamedBuildings += 1
      buildingNameById.set(building.id, `Building ${unnamedBuildings}`)
    }
    for (const childId of building.children) {
      if (asLevel(nodes[childId])) buildingOfLevel.set(childId, building.id)
    }
  }

  // Scene-wide, so a node reachable from two levels through a malformed graph
  // is counted once rather than twice.
  const counted = new Set<string>()
  const levels: LevelFigures[] = []
  const levelsById = new Map<string, LevelFigures>()
  const levelIdsByBuilding = new Map<string, string[]>()

  for (const level of allLevels(nodes)) {
    const figures = levelFigures(nodes, level.id, counted)
    const built: LevelFigures = {
      ...figures,
      id: level.id,
      name: level.name,
      ordinal: level.level,
      buildingId: buildingOfLevel.get(level.id) ?? null,
    }
    levels.push(built)
    levelsById.set(level.id, built)
    const buildingId = built.buildingId
    if (buildingId) {
      const list = levelIdsByBuilding.get(buildingId)
      if (list) list.push(level.id)
      else levelIdsByBuilding.set(buildingId, [level.id])
    }
  }

  levels.sort((a, b) => a.ordinal - b.ordinal)

  // Racks only, for the same reason the hidden count is: a rack under no level
  // contributes its positions to nothing and the storage figure is quietly
  // short, which is a fact about storage. A conveyor in the same state is a
  // fact about the scene graph, and this screen has no figure it belongs to.
  let outsideLevels = 0
  for (const [id, node] of Object.entries(nodes)) {
    if (counted.has(id)) continue
    const record = node as { type?: unknown } | null
    if (record?.type === 'warehouse:pallet-rack') outsideLevels += 1
  }

  return {
    levels,
    levelsById,
    levelIdsByBuilding,
    buildingNameById,
    placed,
    outsideLevels,
  }
}

type LevelTally = Omit<LevelFigures, 'id' | 'name' | 'ordinal' | 'buildingId'>

function levelFigures(
  nodes: Readonly<Record<string, unknown>>,
  levelId: string,
  counted: Set<string>,
): LevelTally {
  let rackCount = 0
  let palletPositions = 0
  let directPositions = 0
  let containerPositions = 0
  let tunnelledRacks = 0
  let tunnelRemoved = 0
  let ghostRacks = 0
  let floorPallets = 0
  const rackIds = new Set<string>()
  const racked: { rackId: string; address: string }[] = []
  let hiddenNodes = 0
  let unreadableRacks = 0
  let slabNodesPresent = 0
  const slabs: SlabFigure[] = []

  // `walkSubtree`, not the level's direct children: the host resolves a node's
  // level by walking the whole parent chain, so a rack or a slab tucked under a
  // group is genuinely on this level. Counting only direct children is the exact
  // bug that made a grouped run contribute nothing to its own capacity figure.
  walkSubtree(nodes, levelId, (node, id) => {
    if (id === levelId) return
    counted.add(id)
    const record = node as { type?: unknown; visible?: unknown } | null
    if (!record || typeof record.type !== 'string') return

    if (record.type === 'slab') {
      slabNodesPresent += 1
      const slab = asSlab(node)
      if (!slab) return
      const audit = slabAuditOf(node as object, slab)
      slabs.push({
        id: slab.id,
        levelId,
        label: slab.name ?? `Slab ${slabs.length + 1}`,
        area: audit.area,
        gross: audit.gross,
        elevation: slab.elevation,
        selfIntersecting: audit.selfIntersecting,
      })
      return
    }

    if (!record.type.startsWith(KIND_PREFIX)) return

    if (record.type === 'warehouse:pallet-rack') {
      rackCount += 1
      rackIds.add(id)
      // **Racks only.** The three figures on this screen are storage, picking
      // and floor area, and hiding a conveyor changes none of them — filing it
      // under storage put a sentence about pallet positions on screen because
      // somebody hid a roller bed. A hidden rack is the one case where the
      // qualification is true: its positions are still counted and the run is
      // not on screen to explain why.
      if (record.visible === false) hiddenNodes += 1
      const figures = rackFiguresOf(node as object)
      if (!figures) {
        unreadableRacks += 1
        return
      }
      palletPositions += figures.palletPositions
      directPositions += figures.directPositions
      containerPositions += figures.containerPositions
      if (figures.tunnelRemoved > 0) {
        tunnelledRacks += 1
        tunnelRemoved += figures.tunnelRemoved
      }
      if (figures.ghost) ghostRacks += 1
      return
    }

    /**
     * A pallet is stock, and where it is stored is a fact it carries rather than
     * one inferred from where it happens to sit.
     *
     * Nothing here tests a pallet's position against a rack's box: a pallet
     * visually inside a bay is not in that bay unless the placement chain put it
     * there and wrote the address down. That is why the slot fields exist.
     */
    if (record.type === 'warehouse:pallet') {
      const claim = record as { slotRackId?: unknown; slotAddress?: unknown }
      if (typeof claim.slotRackId === 'string' && typeof claim.slotAddress === 'string') {
        racked.push({ rackId: claim.slotRackId, address: claim.slotAddress })
      } else {
        floorPallets += 1
      }
    }
  })

  // Counted only against racks on this level, so a pallet whose rack was
  // deleted, or whose claim names a bay somewhere else, cannot inflate the
  // figure. It falls to the floor count instead, which is what it now is.
  let occupiedPositions = 0
  for (const claim of racked) {
    if (rackIds.has(claim.rackId)) occupiedPositions += 1
    else floorPallets += 1
  }

  return {
    rackCount,
    palletPositions,
    directPositions,
    containerPositions,
    tunnelledRacks,
    tunnelRemoved,
    ghostRacks,
    occupiedPositions,
    floorPallets,
    hiddenNodes,
    unreadableRacks,
    slabs,
    slabNodesPresent,
    slabNodesReadable: slabs.length,
  }
}

// ── Scope ───────────────────────────────────────────────────────────────────

/**
 * Which levels the figures cover, and whether the request could be honoured.
 *
 * The request widens rather than emptying: `'building'` is the store's default
 * while the viewer's building selection starts `null`, so the honest first run
 * shows the whole project and says it did — not `0 m²` over a scene full of
 * slabs, which is what a scope that silently resolved to nothing would print.
 */
export function resolveStatsScope(
  stats: SceneStats,
  request: { scope: StatsScope; buildingId: string | null; levelId: string | null },
): StatsScopeResolution {
  const levelChoices = stats.levels.map((level) => ({
    id: level.id,
    label: levelLabel(stats, level),
  }))

  const allIds = stats.levels.map((level) => level.id)
  const project = (widenedNote: string | null): StatsScopeResolution => ({
    requested: request.scope,
    resolved: 'project',
    buildingId: null,
    levelId: null,
    levelIds: allIds,
    levelChoices,
    label: projectLabel(stats),
    widenedNote,
  })

  if (request.scope === 'level') {
    const level = request.levelId ? stats.levelsById.get(request.levelId) : undefined
    if (level) {
      return {
        requested: 'level',
        resolved: 'level',
        buildingId: level.buildingId,
        levelId: level.id,
        levelIds: [level.id],
        levelChoices,
        label: levelLabel(stats, level),
        widenedNote: null,
      }
    }
  }

  if (request.scope === 'building' || request.scope === 'level') {
    const buildingId = request.buildingId
    if (buildingId && stats.buildingNameById.has(buildingId)) {
      const ids = stats.levelIdsByBuilding.get(buildingId) ?? []
      const name = stats.buildingNameById.get(buildingId) ?? 'Building'
      return {
        requested: request.scope,
        resolved: 'building',
        buildingId,
        levelId: null,
        levelIds: ids,
        levelChoices,
        label: `${name} · ${ids.length} ${ids.length === 1 ? 'level' : 'levels'}`,
        widenedNote:
          request.scope === 'level' ? 'That level is gone — showing the building.' : null,
      }
    }
    return project(
      request.scope === 'building'
        ? 'No building selected — showing the whole project.'
        : 'That level is gone — showing the whole project.',
    )
  }

  return project(null)
}

function levelLabel(stats: SceneStats, level: LevelFigures): string {
  const own = level.name ?? `Level ${level.ordinal}`
  const buildingName = level.buildingId ? stats.buildingNameById.get(level.buildingId) : undefined
  // Two buildings each with a ground floor are two rows, not one.
  return buildingName ? `${buildingName} · ${own}` : own
}

function projectLabel(stats: SceneStats): string {
  const levels = stats.levels.length
  const buildings = stats.levelIdsByBuilding.size
  const levelPart = `${levels} ${levels === 1 ? 'level' : 'levels'}`
  if (buildings === 0) return levelPart
  return `${levelPart} in ${buildings} ${buildings === 1 ? 'building' : 'buildings'}`
}

// ── The report ──────────────────────────────────────────────────────────────

/** Elevations within this of each other are the same floor datum. */
const BAND_EPSILON = 1e-4

/**
 * The figures for a scope, with everything that qualifies them.
 *
 * Allocates, so this belongs in a `useMemo` and never in a selector.
 */
export function statsReport(
  stats: SceneStats,
  levelIds: readonly string[],
  slabFilter: ReadonlySet<string> | null,
): StatsReport {
  let palletPositions = 0
  let directPositions = 0
  let containerPositions = 0
  let rackCount = 0
  let unreadableRacks = 0
  let tunnelledRacks = 0
  let tunnelRemoved = 0
  let ghostRacks = 0
  let occupiedPositions = 0
  let floorPallets = 0
  let hiddenNodes = 0
  let slabNodesPresent = 0
  const slabs: SlabFigure[] = []

  for (const levelId of levelIds) {
    const level = stats.levelsById.get(levelId)
    if (!level) continue
    palletPositions += level.palletPositions
    directPositions += level.directPositions
    containerPositions += level.containerPositions
    rackCount += level.rackCount
    unreadableRacks += level.unreadableRacks
    tunnelledRacks += level.tunnelledRacks
    tunnelRemoved += level.tunnelRemoved
    ghostRacks += level.ghostRacks
    occupiedPositions += level.occupiedPositions
    floorPallets += level.floorPallets
    hiddenNodes += level.hiddenNodes
    slabNodesPresent += level.slabNodesPresent
    slabs.push(...level.slabs)
  }

  let area = 0
  let areaAllSlabs = 0
  let countedSlabs = 0
  let selfIntersecting = 0
  for (const slab of slabs) {
    if (slab.selfIntersecting) {
      selfIntersecting += 1
      continue
    }
    areaAllSlabs += slab.area
    if (slabFilter !== null && !slabFilter.has(slab.id)) continue
    area += slab.area
    countedSlabs += 1
  }

  const qualifications: Qualification[] = []
  const unreadableSlabs = slabNodesPresent - slabs.length

  if (unreadableRacks > 0) {
    qualifications.push({
      code: 'racks-unreadable',
      severity: 'blocking',
      figure: 'storage',
      count: unreadableRacks,
    })
  }
  if (unreadableSlabs > 0) {
    qualifications.push({
      code: 'slabs-unreadable',
      severity: 'blocking',
      figure: 'footprint',
      count: unreadableSlabs,
    })
  }
  if (selfIntersecting > 0) {
    qualifications.push({
      code: 'slab-self-intersecting',
      severity: 'blocking',
      figure: 'footprint',
      count: selfIntersecting,
    })
  }

  const bands = elevationBands(slabs, slabFilter)
  if (bands.count > 1) {
    qualifications.push({
      code: 'elevation-bands',
      severity: 'overstates',
      figure: 'footprint',
      count: bands.count,
      amount: bands.aboveLowest,
    })
  }
  if (tunnelledRacks > 0) {
    qualifications.push({
      code: 'tunnelled-bay',
      severity: 'note',
      figure: 'storage',
      count: tunnelledRacks,
      amount: tunnelRemoved,
    })
  }
  if (ghostRacks > 0) {
    qualifications.push({
      code: 'ghost-fill',
      severity: 'note',
      figure: 'storage',
      count: ghostRacks,
    })
  }
  if (floorPallets > 0) {
    qualifications.push({
      code: 'floor-pallets',
      severity: 'note',
      figure: 'storage',
      count: floorPallets,
    })
  }
  if (hiddenNodes > 0) {
    qualifications.push({
      code: 'hidden-nodes',
      severity: 'note',
      figure: 'storage',
      count: hiddenNodes,
    })
  }
  if (stats.outsideLevels > 0) {
    qualifications.push({
      code: 'nodes-outside-levels',
      severity: 'note',
      figure: 'storage',
      count: stats.outsideLevels,
    })
  }

  return {
    palletPositions,
    directPositions,
    containerPositions,
    occupiedPositions,
    rackCount,
    area,
    areaAllSlabs,
    slabs,
    countedSlabs,
    status: {
      storage: statusOf(qualifications, 'storage', rackCount > 0 || unreadableRacks > 0),
      picking: statusOf(qualifications, 'picking', rackCount > 0 || unreadableRacks > 0),
      footprint: statusOf(qualifications, 'footprint', slabs.length > 0 || unreadableSlabs === 0),
    },
    qualifications,
  }
}

/**
 * How many distinct floor datums the summed slabs span, and how much area sits
 * above the lowest one.
 *
 * A mezzanine deck and the floor under it are two real slabs whose areas are
 * both real and whose sum is not a floor anyone drives on. No union is computed
 * — that needs a polygon clipper this package does not have — but naming the sum
 * as gross and pointing at the deck is the honest answer available now.
 */
function elevationBands(
  slabs: readonly SlabFigure[],
  slabFilter: ReadonlySet<string> | null,
): { count: number; aboveLowest: number } {
  const bands = new Map<string, number>()
  for (const slab of slabs) {
    if (slab.selfIntersecting) continue
    if (slabFilter !== null && !slabFilter.has(slab.id)) continue
    // `undefined` is its own band: an unknown datum is not the ground floor.
    const key =
      slab.elevation === undefined ? 'unknown' : String(Math.round(slab.elevation / BAND_EPSILON))
    bands.set(key, (bands.get(key) ?? 0) + slab.area)
  }
  if (bands.size <= 1) return { count: bands.size, aboveLowest: 0 }

  let lowest = Number.POSITIVE_INFINITY
  for (const slab of slabs) {
    if (slab.selfIntersecting || slab.elevation === undefined) continue
    if (slabFilter !== null && !slabFilter.has(slab.id)) continue
    lowest = Math.min(lowest, slab.elevation)
  }
  let aboveLowest = 0
  for (const slab of slabs) {
    if (slab.selfIntersecting) continue
    if (slabFilter !== null && !slabFilter.has(slab.id)) continue
    if (slab.elevation !== undefined && Math.abs(slab.elevation - lowest) <= BAND_EPSILON) continue
    aboveLowest += slab.area
  }
  return { count: bands.size, aboveLowest }
}

function statusOf(
  qualifications: readonly Qualification[],
  figure: FigureId,
  hasInput: boolean,
): FigureStatus {
  const mine = qualifications.filter((entry) => entry.figure === figure)
  if (!hasInput) return 'unavailable'
  if (mine.some((entry) => entry.severity === 'blocking')) return 'unavailable'
  return mine.length > 0 ? 'qualified' : 'exact'
}
