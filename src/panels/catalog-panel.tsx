'use client'

import { Icon } from '@iconify/react'
import { useScene } from '@pascal-app/core'
import { SegmentedControl, useEditor } from '@pascal-app/editor'
import { useEffect } from 'react'
import { CATALOG_SECTIONS, type CatalogItem, itemsInSection } from '../catalog'
import { reportHostCompatibility } from '../compat'
import { KIND_PREFIX } from '../plugin-id'
import { type PanelTab, useWarehouseStore } from '../store'

/**
 * The plugin's rail panel. Two tabs share one rail slot: browse-and-place, and
 * the capacity readout. The host mounts this lazily inside an error boundary
 * and passes no props.
 */
export default function WarehousePanel() {
  const tab = useWarehouseStore((s) => s.tab)
  const setTab = useWarehouseStore((s) => s.setTab)

  // One console block naming which optional host reads are live. Runs here
  // rather than in the manifest barrel so it stays off the SSR path.
  useEffect(() => {
    reportHostCompatibility()
  }, [])

  const placed = useScene(
    (s) =>
      Object.values(s.nodes).filter((n) =>
        String((n as { type?: unknown }).type ?? '').startsWith(KIND_PREFIX),
      ).length,
  )

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sidebar-foreground">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Warehouse</h2>
          <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-sidebar-foreground/70 text-xs">
            {placed} placed
          </span>
        </div>
        <SegmentedControl
          onChange={(value: PanelTab) => setTab(value)}
          options={[
            { label: 'Catalog', value: 'catalog' },
            { label: 'Stats', value: 'stats' },
          ]}
          value={tab}
        />
      </header>

      {tab === 'catalog' ? <CatalogTab /> : <StatsTab />}
    </div>
  )
}

function CatalogTab() {
  return (
    <div className="flex flex-col gap-5">
      {CATALOG_SECTIONS.map((section) => {
        const items = itemsInSection(section.id)
        return (
          <section className="flex flex-col gap-2" key={section.id}>
            <div className="flex items-center gap-2">
              <Icon
                className="text-sidebar-foreground/60"
                height={14}
                icon={section.icon}
                width={14}
              />
              <h3 className="font-medium text-sidebar-foreground/80 text-xs uppercase tracking-wider">
                {section.label}
              </h3>
            </div>
            <p className="text-sidebar-foreground/45 text-xs leading-relaxed">{section.blurb}</p>
            {items.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {items.map((item) => (
                  <CatalogTile item={item} key={item.kind} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-sidebar-border border-dashed px-3 py-2.5 text-sidebar-foreground/40 text-xs">
                Nothing here yet.
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function CatalogTile({ item }: { item: CatalogItem }) {
  const activeTool = useEditor((s) => s.tool)
  const arming = activeTool === item.kind

  const arm = () => {
    const editor = useEditor.getState() as {
      setTool: (value: string) => void
      setMode: (value: string) => void
    }
    editor.setTool(item.kind)
    editor.setMode('build')
  }

  return (
    <button
      className={`group flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-all ${
        arming
          ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
          : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
      }`}
      onClick={arm}
      title={item.description}
      type="button"
    >
      <Icon className="text-sidebar-foreground/70" height={20} icon={item.icon} width={20} />
      <span className="font-medium text-xs">{item.label}</span>
    </button>
  )
}

function StatsTab() {
  return (
    <div className="rounded-lg border border-sidebar-border border-dashed px-3 py-2.5 text-sidebar-foreground/40 text-xs leading-relaxed">
      Capacity and area figures appear here once racking is placed.
    </div>
  )
}
