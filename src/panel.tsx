import React, { useState } from 'react'
import {
  Box,
  Grid,
  Layers,
  Package,
  Search,
  Truck,
  Warehouse,
  X,
} from 'lucide-react'
import { useEditor } from '@pascal-app/editor'

import { conveyorDefinition } from './items/conveyor/definition'
import { ConveyorNode } from './items/conveyor/schema'
import { euroPalletDefinition } from './items/euro-pallet/definition'
import { EuroPalletNode } from './items/euro-pallet/schema'
import { loadedEuroPalletDefinition } from './items/loaded-euro-pallet/definition'
import { LoadedEuroPalletNode } from './items/loaded-euro-pallet/schema'
import { palletRackDefinition } from './items/pallet-rack/definition'
import { PalletRackNode } from './items/pallet-rack/schema'
import { toteCartDefinition } from './items/tote-cart/definition'
import { ToteCartNode } from './items/tote-cart/schema'

export const WAREHOUSE_ICON = {
  kind: 'svg' as const,
  viewBox: '0 0 24 24',
  path: 'M3 20V4h18v16H3zm2-2h14v-3H5v3zm0-5h14v-3H5v3zm0-5h14V6H5v2zM7 7h3v1H7V7zm0 5h3v1H7v-1zm0 5h3v1H7v-1z',
}

interface ItemPreset {
  id: string
  nodeType: string
  label: string
  sublabel: string
  tag: string
  category: 'racks' | 'pallets' | 'equipment'
  iconComponent: React.ComponentType<{ className?: string }>
  iconColorClass: string
  definition: any
  schema: any
  params: Record<string, any>
}

const WAREHOUSE_PRESETS: ItemPreset[] = [
  {
    id: 'euro-pallet-std',
    nodeType: 'warehouse:euro-pallet',
    label: 'EUR 1 Palet',
    sublabel: '1.2m × 0.8m EPAL',
    tag: 'Palet',
    category: 'pallets',
    iconComponent: Box,
    iconColorClass: 'text-amber-600 bg-amber-600/10 border-amber-600/20',
    definition: euroPalletDefinition,
    schema: EuroPalletNode,
    params: {
      width: 1.2,
      depth: 0.8,
      height: 0.144,
      slatsColor: '#d4a373',
      blockColor: '#8c6239',
    },
  },
  {
    id: 'loaded-euro-pallet-std',
    nodeType: 'warehouse:loaded-euro-pallet',
    label: 'Kargo Paleti',
    sublabel: 'Streç Kaplı Koli',
    tag: 'Kargo',
    category: 'pallets',
    iconComponent: Package,
    iconColorClass: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
    definition: loadedEuroPalletDefinition,
    schema: LoadedEuroPalletNode,
    params: {
      width: 1.2,
      height: 1.15,
      depth: 0.8,
      cargoType: 'boxes',
      wrapPlastic: true,
      cornerGuards: true,
      boxColor: '#cda27b',
    },
  },
  {
    id: 'standard-4tier',
    nodeType: 'warehouse:pallet-rack',
    label: 'Palet Rafı (4K)',
    sublabel: '2.7m × 4.5m 4 Katlı',
    tag: 'Raf',
    category: 'racks',
    iconComponent: Layers,
    iconColorClass: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    definition: palletRackDefinition,
    schema: PalletRackNode,
    params: {
      levels: 4,
      bayWidth: 2.7,
      depth: 1.1,
      uprightHeight: 4.5,
      uprightColor: '#1e40af',
      beamColor: '#f97316',
      hasPallets: true,
    },
  },
  {
    id: 'high-bay-6tier',
    nodeType: 'warehouse:pallet-rack',
    label: 'Depo Rafı (6K)',
    sublabel: '3.5m × 6.5m 6 Katlı',
    tag: 'Raf',
    category: 'racks',
    iconComponent: Warehouse,
    iconColorClass: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    definition: palletRackDefinition,
    schema: PalletRackNode,
    params: {
      levels: 6,
      bayWidth: 3.5,
      depth: 1.2,
      uprightHeight: 6.5,
      uprightColor: '#1e3a8a',
      beamColor: '#ea580c',
      hasPallets: true,
    },
  },
  {
    id: 'conveyor-wiremesh-3m',
    nodeType: 'warehouse:conveyor',
    label: 'Rulo Konveyör',
    sublabel: '3.0m × 0.8m Modüler',
    tag: 'Konveyör',
    category: 'equipment',
    iconComponent: Grid,
    iconColorClass: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20',
    definition: conveyorDefinition,
    schema: ConveyorNode,
    params: {
      width: 3.0,
      height: 0.6,
      depth: 0.8,
      frameColor: '#64748b',
      beltColor: '#94a3b8',
      hasSideRails: true,
    },
  },
  {
    id: 'tote-cart-3tier',
    nodeType: 'warehouse:tote-cart',
    label: 'Sipariş Arabası',
    sublabel: '0.6m × 0.4m 3 Katlı',
    tag: 'Araba',
    category: 'equipment',
    iconComponent: Truck,
    iconColorClass: 'text-cyan-500 bg-cyan-500/10 border-cyan-500/20',
    definition: toteCartDefinition,
    schema: ToteCartNode,
    params: {
      width: 0.6,
      height: 1.5,
      depth: 0.4,
      frameColor: '#334155',
      toteColor: '#2563eb',
      shelfLevels: 3,
    },
  },
]

export function WarehousePanelComponent() {
  const currentTool = useEditor((s) => s.tool)
  const currentMode = useEditor((s) => s.mode)
  const setTool = useEditor((s) => s.setTool)
  const setMode = useEditor((s) => s.setMode)
  const setPresetParams = useEditor((s) => (s as any).setPresetParams)

  const [filterCategory, setFilterCategory] = useState<'all' | 'racks' | 'pallets' | 'equipment'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const handleSelectPreset = (preset: ItemPreset) => {
    if (typeof setPresetParams === 'function') {
      setPresetParams(preset.params)
    }
    setMode('build')
    setTool(preset.nodeType as any)
  }

  const filteredPresets = WAREHOUSE_PRESETS.filter((p) => {
    const matchesCategory = filterCategory === 'all' || p.category === filterCategory
    const matchesSearch =
      searchQuery.trim() === '' ||
      p.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sublabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.tag.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="flex h-full flex-col">
        {/* Category Icons Header Bar — Matches Native Pascal Editor ItemsPanel */}
        <div className="flex shrink-0 flex-wrap gap-1 border-border/70 border-b p-2">
          {[
            { id: 'all', label: 'Tümü', icon: Warehouse },
            { id: 'pallets', label: 'Paletler', icon: Box },
            { id: 'racks', label: 'Raflar', icon: Layers },
            { id: 'equipment', label: 'Ekipman', icon: Grid },
          ].map((cat) => {
            const isActive = filterCategory === cat.id
            const CatIcon = cat.icon
            return (
              <button
                key={cat.id}
                className={`flex shrink-0 flex-col items-center gap-1 rounded-xl px-3 py-2 transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                }`}
                onClick={() => setFilterCategory(cat.id as any)}
                type="button"
              >
                <CatIcon className={`size-6 stroke-1.5 ${isActive ? 'text-orange-500' : 'opacity-70'}`} />
                <span className="font-medium text-[10px] leading-none">{cat.label}</span>
              </button>
            )
          })}
        </div>

        {/* Search Bar Container — Matches Native ItemsPanel */}
        <div className="flex shrink-0 flex-col gap-2 border-border/70 border-b p-2">
          <div className="flex items-center gap-1.5 relative">
            <input
              className="min-w-0 shrink-0 rounded-lg bg-muted pl-8 pr-7 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none w-full"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ara..."
              type="text"
              value={searchQuery}
            />
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            {searchQuery && (
              <button
                className="absolute right-2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery('')}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Grid Tile Container — Auto-fill Grid matching Native ItemsPanel */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}
          >
            {filteredPresets.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <Search className="h-6 w-6 stroke-1 text-muted-foreground/40 mb-1.5" />
                <p className="text-xs font-medium">Aramaya uygun nesne bulunamadı.</p>
              </div>
            ) : (
              filteredPresets.map((preset) => {
                const isToolActive = currentMode === 'build' && currentTool === preset.nodeType
                const IconComp = preset.iconComponent

                return (
                  <button
                    key={preset.id}
                    className={`group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent ${
                      isToolActive
                        ? 'bg-sidebar-accent ring-1 ring-orange-500/60'
                        : ''
                    }`}
                    onClick={() => handleSelectPreset(preset)}
                    type="button"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-lg border bg-muted/30 flex flex-col items-center justify-center transition-transform group-hover:scale-[1.02]">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg border ${preset.iconColorClass}`}
                      >
                        <IconComp className="h-5 w-5" />
                      </div>
                    </div>
                    <span
                      className={`truncate px-0.5 text-left font-medium text-[11px] ${
                        isToolActive
                          ? 'text-orange-500 font-semibold'
                          : 'text-muted-foreground group-hover:text-foreground'
                      }`}
                    >
                      {preset.label}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default WarehousePanelComponent

export const warehouseHostPanel: any = {
  id: 'ovurr-warehouse-panel',
  label: 'Depo & Lojistik',
  description: '3D Depo & Lojistik Ekipmanları Eklentisi',
  icon: WAREHOUSE_ICON,
  component: () => Promise.resolve({ default: WarehousePanelComponent }),
  pluginId: 'ovurr:warehouse',
  defaultInstalled: true,
}

export const warehousePanel = warehouseHostPanel
