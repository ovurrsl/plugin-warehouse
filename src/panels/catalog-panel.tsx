'use client'

import { Icon } from '@iconify/react'
import { useScene } from '@pascal-app/core'
import { PanelSection, PanelWrapper, SegmentedControl, useEditor } from '@pascal-app/editor'
import { useEffect } from 'react'
import { CATALOG_SECTIONS, type CatalogItem, itemsInSection } from '../catalog'
import { reportHostCompatibility } from '../compat'
import { KIND_PREFIX } from '../plugin-id'
import { type PanelTab, useWarehouseStore } from '../store'
import { tile, tileGrid, tokens } from './styles'

/**
 * The plugin's rail panel. Two tabs share one rail slot: browse-and-place, and
 * the capacity readout. The host mounts this lazily inside an error boundary
 * and passes no props.
 *
 * Chrome is composed from the host's own exported components — `PanelWrapper`,
 * `PanelSection`, `SegmentedControl` — so the panel matches the native ones
 * exactly and inherits any future host restyle without a change here. Only the
 * catalog tiles, which the host has no component for, are styled locally, and
 * those resolve host CSS variables so they follow the theme too.
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
    <PanelWrapper icon={<Icon height={16} icon="lucide:warehouse" width={16} />} title="Warehouse">
      <div style={tokens.body}>
        <div style={tokens.headerRow}>
          <SegmentedControl
            onChange={(value: PanelTab) => setTab(value)}
            options={[
              { label: 'Catalog', value: 'catalog' },
              { label: 'Stats', value: 'stats' },
            ]}
            value={tab}
          />
          <span style={tokens.countChip}>{placed} placed</span>
        </div>
      </div>

      {tab === 'catalog' ? <CatalogTab /> : <StatsTab />}
    </PanelWrapper>
  )
}

function CatalogTab() {
  return (
    <>
      {CATALOG_SECTIONS.map((section) => {
        const items = itemsInSection(section.id)
        return (
          // Sections with nothing in them start collapsed so the panel stays
          // scannable while the catalog is still filling out.
          <PanelSection defaultExpanded={items.length > 0} key={section.id} title={section.label}>
            <div style={tokens.sectionBody}>
              <p style={tokens.blurb}>{section.blurb}</p>
              {items.length > 0 ? (
                <div style={tileGrid}>
                  {items.map((item) => (
                    <CatalogTile item={item} key={item.kind} />
                  ))}
                </div>
              ) : (
                <div style={tokens.empty}>Nothing here yet.</div>
              )}
            </div>
          </PanelSection>
        )
      })}
    </>
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
    <div style={tokens.sectionBody}>
      <div style={tokens.empty}>Capacity and area figures appear here once racking is placed.</div>
    </div>
  )
}
