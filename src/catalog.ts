/**
 * The catalog the panel browses: which node kinds exist, how they group, and
 * what each one is for.
 *
 * Kept as plain data separate from the node definitions so the panel can render
 * the full catalog — including sections whose kinds have not landed yet —
 * without importing any renderer or geometry module. Adding a kind means adding
 * its definition to the manifest and one entry here.
 *
 * All dimensions quoted in descriptions are metres, matching the host's
 * convention. Published warehouse specs are millimetres; divide by 1000.
 */

export type CatalogSection = {
  id: string
  label: string
  /** Iconify name, rendered by the panel. */
  icon: string
  blurb: string
}

export type CatalogItem = {
  /** Node kind to arm for placement. Must match a registered `NodeDefinition.kind`. */
  kind: string
  label: string
  sectionId: string
  description: string
  icon: string
}

export const CATALOG_SECTIONS: readonly CatalogSection[] = [
  {
    id: 'unit-loads',
    label: 'Unit loads',
    icon: 'lucide:package',
    blurb: 'Pallets and containers — the footprint every other dimension follows from.',
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: 'lucide:layout-grid',
    blurb: 'Pallet racking and shelving. The source of every capacity figure.',
  },
  {
    id: 'handling',
    label: 'Handling',
    icon: 'lucide:forklift',
    blurb: 'Trucks and carts. Each variant carries the aisle width it needs.',
  },
  {
    id: 'conveyance',
    label: 'Conveyance',
    icon: 'lucide:move-right',
    blurb: 'Conveyors and sortation.',
  },
  {
    id: 'stations',
    label: 'Stations',
    icon: 'lucide:table-2',
    blurb: 'Packing, dispatch, and processing benches.',
  },
  {
    id: 'layout',
    label: 'Layout',
    icon: 'lucide:route',
    blurb: 'Floor markings and aisles.',
  },
] as const

/**
 * Populated one phase at a time. An entry here without a matching registered
 * kind would arm a tool that cannot place anything, so entries land in the same
 * change as their `NodeDefinition`.
 */
export const CATALOG_ITEMS: readonly CatalogItem[] = [
  {
    kind: 'warehouse:pallet',
    label: 'Pallet',
    sectionId: 'unit-loads',
    description: 'EPAL, GMA and plastic pallets. Set a load height to fill a rack position.',
    icon: 'lucide:package',
  },
  {
    kind: 'warehouse:pallet-rack',
    label: 'Pallet Rack',
    sectionId: 'storage',
    description:
      'One bay of adjustable racking. Multiply it into a run from the panel; bays standing together share a post.',
    icon: 'lucide:rows-3',
  },
  {
    kind: 'warehouse:conveyor-roller',
    label: 'Roller Conveyor',
    sectionId: 'conveyance',
    description:
      'One module of continuously driven roller conveyor. Lay a run with [ and ]; each module is its own object.',
    icon: 'lucide:move-right',
  },
  {
    kind: 'warehouse:conveyor-curve',
    label: 'Curved Conveyor',
    sectionId: 'conveyance',
    description:
      'Turns a line through 45, 90 or 180°, keeping every box facing the way it entered. [ and ] set the angle, H flips the hand.',
    icon: 'lucide:corner-up-left',
  },
  {
    kind: 'warehouse:conveyor-launcher',
    label: 'Launcher Conveyor',
    sectionId: 'conveyance',
    description:
      'Branches a line at ninety degrees without a curve: the main bed runs through and a short arm throws the box off it. H flips the launch side.',
    icon: 'lucide:git-fork',
  },
  {
    kind: 'warehouse:conveyor-booster',
    label: 'Booster Conveyor',
    sectionId: 'conveyance',
    description:
      'A short driven section that regulates a load’s passage and tightens the cycle. Its drive sits under the bed, which makes it the tightest frame in the family.',
    icon: 'lucide:chevrons-right',
  },
  {
    kind: 'warehouse:conveyor-transfer',
    label: 'Mixed Transfer',
    sectionId: 'conveyance',
    description:
      'Crosses a line through ninety degrees without turning the box: belt strips rise between the rollers and carry it off sideways. H flips the discharge side.',
    icon: 'lucide:move-diagonal',
  },
  {
    kind: 'warehouse:conveyor-oblique',
    label: 'Oblique Transfer',
    sectionId: 'conveyance',
    description:
      'Branches a line at an angle without stopping it. The branch is a narrower lane than the main bed, so a box that takes it has to fit the branch. H flips the side.',
    icon: 'lucide:split',
  },
] as const

export function itemsInSection(sectionId: string): CatalogItem[] {
  return CATALOG_ITEMS.filter((item) => item.sectionId === sectionId)
}
