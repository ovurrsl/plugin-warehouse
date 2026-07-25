import { create } from 'zustand'

/**
 * The plugin's own state. Plugins do not extend `useScene` / `useEditor` /
 * `useViewer`; they keep a module-level store of their own, which is what the
 * plugin-authoring contract prescribes and what the reference plugin does.
 *
 * It holds view state only — which tab is open, what the stats readout is
 * scoped to. Node data lives on the nodes; nothing here is persisted, and
 * losing it on reload costs the user one click.
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
}

export const useWarehouseStore = create<WarehouseStore>((set, get) => ({
  tab: 'catalog',
  setTab: (tab) => set({ tab }),

  scope: 'building',
  setScope: (scope) => set({ scope, slabFilter: null }),

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
}))
