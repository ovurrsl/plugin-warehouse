/**
 * Categorical hardware role for an individual Bill of Materials line item.
 */
export type WarehouseBomItemRole =
  | 'upright-frame'
  | 'upright-post'
  | 'footplate'
  | 'anchor-bolt'
  | 'frame-brace'
  | 'load-beam'
  | 'safety-pin'
  | 'shelf-panel'
  | 'row-spacer'
  | 'post-protector'
  | 'guide-rail'
  | 'pallet-rail'
  | 'rail-bracket'
  | 'roller-track'
  | 'flow-roller'
  | 'brake-roller'
  | 'pallet-separator'
  | 'column'
  | 'main-beam'
  | 'secondary-beam'
  | 'deck-floor'
  | 'handrail'
  | 'staircase'
  | 'conveyor-module'
  | 'equipment'
  | (string & {})

/**
 * Standard engineering measurement unit for BOM items.
 */
export type WarehouseBomUnit =
  | 'pcs'
  | 'sets'
  | 'm'
  | 'm²'
  | 'bays'
  | 'lanes'
  | 'units'
  | (string & {})

/**
 * Detailed installation part line item in the Bill of Materials.
 */
export type WarehouseBomItem = {
  id: string
  role: WarehouseBomItemRole
  system: string
  item: string
  specification: string
  quantity: number
  unit: WarehouseBomUnit
  notes?: string
}

/**
 * Grouped category section of the BOM (e.g. Selective Pallet Racks, Mezzanines, Fasteners).
 */
export type WarehouseBomSection = {
  id: string
  title: string
  icon?: string
  itemCount: number
  items: WarehouseBomItem[]
}

/**
 * High-level key performance indicator summary card.
 */
export type WarehouseBomKpi = {
  key: string
  label: string
  value: string | number
  unit?: string
}

/**
 * Complete structured Bill of Materials report for warehouse installations.
 */
export type WarehouseBOM = {
  projectName: string
  scopeLabel: string
  zoneName?: string
  date: string
  kpis: WarehouseBomKpi[]
  sections: WarehouseBomSection[]
  totalPartsCount: number
  engineeringNotes: string[]
}

/**
 * Input configuration options for BOM calculation.
 */
export type BomCalculateOptions = {
  filterNodeIds?: readonly string[]
  scopeLabel?: string
  zoneName?: string
  projectName?: string
  date?: string
}

/**
 * Styling and metadata options for BOM document generation (PDF / HTML / SVG).
 */
export type BomDocumentOptions = {
  title?: string
  author?: string
  subject?: string
  keywords?: string[]
  companyName?: string
  logoText?: string
  date?: string
}

/**
 * Vector SVG drawing sheet for plan sets.
 */
export type BomSheet = {
  title: string
  svg: string
}
