import { create } from 'zustand'
import { CARGO_TYPES } from './pallet/cargo-types'
import type { PalletNode } from './pallet/schema'
import { DEFAULT_MULTIPLY, type MultiplySpec } from './rack/multiply'
import type { PalletRackNode } from './rack/schema'
import { defaultWidthM } from './route/metrics'
import type { RouteNode } from './route/schema'
import type { TruckNode } from './truck/schema'

/**
 * The plugin's own state. Plugins do not extend `useScene` / `useEditor` /
 * `useViewer`; they keep a module-level store of their own, which is what the
 * plugin-authoring contract prescribes and what the reference plugin does.
 *
 * It holds view state and the placement "brush" — what the next placed item
 * looks like. The panel writes it, the tools read it. Node data lives on the
 * nodes; nothing here is persisted, and losing it on reload costs one click.
 *
 * It deliberately lives outside the panel component: the panel unmounts
 * whenever the user switches rail tabs, and a scope selection that reset every
 * time you glanced at the outliner would be worse than useless.
 */

export type PanelTab = 'catalog' | 'stats'

/** What the statistics readout counts. One selector drives every metric —
 * the fork this replaces scoped its pallet counts to the whole building and
 * its area figure to a single level, in the same card. */
export type StatsScope = 'project' | 'building' | 'level'

type WarehouseStore = {
  tab: PanelTab
  setTab: (tab: PanelTab) => void

  scope: StatsScope
  setScope: (scope: StatsScope) => void

  /**
   * Slab ids the area figures are restricted to, or `null` for "every slab in
   * scope". A distinct flag rather than an empty set doing double duty: the
   * fork overloaded `null` to mean both "all" and "none", and the two are not
   * the same answer.
   */
  slabFilter: ReadonlySet<string> | null
  setSlabFilter: (ids: ReadonlySet<string> | null) => void
  toggleSlab: (id: string, allIds: readonly string[]) => void

  /**
   * Level the readout is pinned to, or `null` to follow the viewer's own.
   *
   * Held as an id rather than an index into the level list: levels are sorted by
   * an ordinal the host types as a plain number — fractional and negative are
   * both legal — so an index would quietly shift the selection onto a different
   * storey the moment a level was added, renamed or renumbered.
   */
  statsLevelId: string | null
  setStatsLevel: (id: string | null) => void

  /**
   * Whether the conveyor flow simulation is running.
   *
   * Off by default: a layout tool that animates the moment it opens is a layout
   * tool nobody can read. It lives here rather than in `useViewer` because a
   * plugin does not extend the host's stores — and it is scene-wide rather than
   * per-node, because a line is not a node either.
   */
  flowRunning: boolean
  setFlowRunning: (running: boolean) => void

  /**
   * Whether the truck fleet is driving. Off by default, `flowRunning`'in
   * gerekçesiyle: açılışta kendiliğinden hareket eden bir yerleşim aracı
   * okunamaz. Sahne-genel, çünkü filo da düğüm değil.
   */
  fleetRunning: boolean
  setFleetRunning: (running: boolean) => void

  // ── Placement brush ────────────────────────────────────────────────────
  /**
   * Shape of the next placed pallet, held as a partial node for the same reason
   * the rack's is: the tool parses it straight through `PalletNode.parse`, so
   * anything absent takes the schema's own default and there is no second set of
   * defaults to keep in step.
   */
  palletBrush: PalletBrush
  setPalletBrush: (patch: Partial<PalletBrush>) => void

  /**
   * Shape of the next drawn route.
   *
   * Changing the role or the truck class re-derives the width, because a route
   * whose width did not follow its class would silently keep a forklift aisle's
   * 3.2 m after being switched to a walkway — a number that was right once and
   * is now just a leftover.
   */
  routeBrush: RouteBrush
  setRouteBrush: (patch: Partial<RouteBrush>) => void

  /**
   * Shape of the next placed rack.
   *
   * Held as a partial node rather than a handful of loose fields: a rack has
   * enough dimensions that mirroring each one here would be a second schema to
   * keep in step, and the tool parses this straight through
   * `PalletRackNode.parse` so anything missing takes the schema's own default.
   */
  rackBrush: RackBrush
  setRackBrush: (patch: Partial<RackBrush>) => void

  /**
   * What the **Multiply** button in the rack panel will lay down.
   *
   * Not schema fields, and deliberately: a bay is a node, so a bay count that
   * lived on the node would be a number that silently reshapes one object into
   * twenty — which is exactly the model this kind was rebuilt to get away from.
   * It is a command's arguments, so it lives with the other panel state.
   *
   * Outside the panel component because the panel unmounts whenever the user
   * switches rail tabs or reselects, and a count that reset every time you
   * glanced away would be worse than useless.
   */
  multiply: MultiplySpec
  setMultiply: (patch: Partial<MultiplySpec>) => void

  /**
   * Shape of the next placed truck. `model` yamanınca `mastRowId` sıfırlanır —
   * `setRouteBrush`'ın "genişlik sınıfı takip eder" kuralının aynısı: eski
   * satır yeni modelin tablosu olmayabilir ve sessizce taşınmış bir mast,
   * yanlış boyda çizilmiş bir makinedir.
   */
  truckBrush: TruckBrush
  setTruckBrush: (patch: Partial<TruckBrush>) => void
}

export type PalletBrush = Pick<
  PalletNode,
  'preset' | 'cargo' | 'fillRange' | 'wrapped' | 'strapped' | 'labelled' | 'cargoColor'
>

export type RouteBrush = Pick<
  RouteNode,
  'role' | 'traffic' | 'width' | 'lineWidth' | 'requiredFor' | 'datum'
>

export type TruckBrush = Pick<TruckNode, 'model' | 'mastRowId' | 'referenceLoad' | 'duty'>

export type RackBrush = Pick<
  PalletRackNode,
  | 'bayClearWidth'
  | 'depth'
  | 'uprightHeight'
  | 'levels'
  | 'palletPreset'
  | 'palletOrientation'
  | 'pickingLevels'
  | 'ghostFill'
>

export const useWarehouseStore = create<WarehouseStore>((set, get) => ({
  tab: 'catalog',
  setTab: (tab) => set({ tab }),

  scope: 'building',
  setScope: (scope) => set({ scope, slabFilter: null }),

  // Slab ids belong to a level, so changing the level clears the filter for the
  // same reason changing the scope does.
  statsLevelId: null,
  setStatsLevel: (statsLevelId) => set({ statsLevelId, slabFilter: null }),

  slabFilter: null,
  setSlabFilter: (slabFilter) => set({ slabFilter }),
  toggleSlab: (id, allIds) => {
    const current = get().slabFilter
    const next = new Set(current ?? allIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    // Collapse "everything selected" back to the null sentinel so newly drawn
    // slabs are included by default instead of silently missing from the total.
    set({ slabFilter: next.size === allIds.length ? null : next })
  },

  flowRunning: false,
  setFlowRunning: (flowRunning) => set({ flowRunning }),

  fleetRunning: false,
  setFleetRunning: (fleetRunning) => set({ fleetRunning }),

  palletBrush: {
    preset: 'epal-1',
    cargo: 'none',
    fillRange: [0.4, 1],
    wrapped: true,
    strapped: true,
    labelled: true,
    cargoColor: 'kraft',
  },
  setPalletBrush: (patch) =>
    set((state) => {
      const next = { ...state.palletBrush, ...patch }
      // Choosing a cargo type brings that type's own practice with it: cartons
      // are filmed and drums are not. The flags are still the user's to change
      // afterwards — this only decides what they start as, which is the one
      // reader `CargoType.defaults` was declared for.
      if (patch.cargo && patch.cargo !== 'none' && patch.cargo !== state.palletBrush.cargo) {
        const defaults = CARGO_TYPES[patch.cargo].defaults
        next.wrapped = patch.wrapped ?? defaults.wrap
        next.strapped = patch.strapped ?? defaults.strapping
        next.labelled = patch.labelled ?? defaults.label
      }
      return { palletBrush: next }
    }),

  routeBrush: {
    role: 'pedestrian',
    traffic: 'two-way',
    width: defaultWidthM('pedestrian', null),
    lineWidth: 'standard',
    requiredFor: null,
    datum: 'load-face',
  },
  setRouteBrush: (patch) =>
    set((state) => {
      const next = { ...state.routeBrush, ...patch }
      // The width follows the class unless the user is setting it directly.
      if (
        patch.width === undefined &&
        (patch.role !== undefined || patch.requiredFor !== undefined)
      ) {
        next.width = defaultWidthM(next.role, next.requiredFor)
      }
      return { routeBrush: next }
    }),

  rackBrush: {
    bayClearWidth: 2.7,
    depth: 1.1,
    uprightHeight: 5,
    levels: 3,
    palletPreset: 'epal-1',
    palletOrientation: 'short-side-out',
    pickingLevels: 0,
    ghostFill: 0,
  },
  setRackBrush: (patch) => set((state) => ({ rackBrush: { ...state.rackBrush, ...patch } })),

  multiply: DEFAULT_MULTIPLY,
  setMultiply: (patch) => set((state) => ({ multiply: { ...state.multiply, ...patch } })),

  truckBrush: {
    model: 'forklift-1300',
    mastRowId: null,
    referenceLoad: '1000x1200',
    duty: 'parked',
  },
  setTruckBrush: (patch) =>
    set((state) => {
      const next = { ...state.truckBrush, ...patch }
      if (patch.model !== undefined && patch.model !== state.truckBrush.model) {
        next.mastRowId = patch.mastRowId ?? null
      }
      return { truckBrush: next }
    }),
}))
