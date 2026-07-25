'use client'

import { Icon } from '@iconify/react'
import { useScene } from '@pascal-app/core'
import { SegmentedControl, useEditor } from '@pascal-app/editor'
import { useEffect } from 'react'
import { CATALOG_SECTIONS, type CatalogItem, itemsInSection } from '../catalog'
import { reportHostCompatibility } from '../compat'
import { KIND_PREFIX } from '../plugin-id'
import { type PanelTab, useWarehouseStore } from '../store'
import { tile, tokens } from './styles'

/**
 * The plugin's left-rail panel. Two tabs share one rail slot: browse-and-place,
 * and the capacity readout. The host mounts this lazily inside an error
 * boundary and passes no props.
 *
 * A rail panel is a plain scroll container — the rail owns the chrome. Host
 * controls are composed where one exists (`SegmentedControl` here, the slider
 * and toggle controls once racking lands); everything else is styled from
 * `./styles`, which resolves host CSS variables at runtime so it tracks the
 * theme without depending on the host's Tailwind build.
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
    <div style={tokens.root}>
      <header style={tokens.header}>
        <div style={tokens.titleRow}>
          <h2 style={tokens.title}>Warehouse</h2>
          <span style={tokens.countChip}>{placed} placed</span>
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
    <div style={tokens.sections}>
      {CATALOG_SECTIONS.map((section) => {
        const items = itemsInSection(section.id)
        return (
          <section key={section.id} style={tokens.section}>
            <div style={tokens.sectionHeader}>
              <Icon height={14} icon={section.icon} style={tokens.sectionIcon} width={14} />
              <h3 style={tokens.sectionTitle}>{section.label}</h3>
            </div>
            <p style={tokens.blurb}>{section.blurb}</p>
            {items.length > 0 ? (
              <div style={tokens.tileGrid}>
                {items.map((item) => (
                  <CatalogTile item={item} key={item.kind} />
                ))}
              </div>
            ) : (
              <div style={tokens.empty}>Nothing here yet.</div>
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
    // The host types `tool` as its own built-in union, which by construction
    // cannot know about plugin-contributed kinds. Arming by kind string is the
    // path a catalog panel is expected to use.
    const editor = useEditor.getState() as unknown as {
      setTool: (value: string) => void
      setMode: (value: string) => void
    }
    editor.setTool(item.kind)
    editor.setMode('build')
  }

  return (
    <button onClick={arm} style={tile(arming)} title={item.description} type="button">
      <Icon height={20} icon={item.icon} style={tokens.tileIcon} width={20} />
      <span style={tokens.tileLabel}>{item.label}</span>
    </button>
  )
}

function StatsTab() {
  return (
    <div style={tokens.empty}>
      Capacity and area figures appear here once racking is placed.
    </div>
  )
}
