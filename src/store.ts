import { create } from 'zustand'
import type { PalletPreset } from './pallet/presets'
import { DEFAULT_MULTIPLY, type MultiplySpec } from './rack/multiply'
import type { PalletRackNode } from './rack/schema'

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

  // ── Placement brush ────────────────────────────────────────────────────
  /** Preset the next placed pallet uses. */
  palletPreset: PalletPreset
  setPalletPreset: (preset: PalletPreset) => void
  /** Load height, metres. 0 places a bare pallet. */
  palletLoadHeight: number
  setPalletLoadHeight: (height: number) => void

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
}

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

  palletPreset: 'epal-1',
  setPalletPreset: (palletPreset) => set({ palletPreset }),
  palletLoadHeight: 0,
  setPalletLoadHeight: (palletLoadHeight) =>
    set({ palletLoadHeight: Math.max(0, palletLoadHeight) }),

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
}))
