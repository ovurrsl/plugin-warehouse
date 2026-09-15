import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo, useState } from 'react'
import type { PalletRackNode } from '../rack/schema'
import { directAccessSlotCount, fittedLevelCount, palletSlotCount, pickingSlotCount } from '../rack/slots'
import { occupiedSlots } from '../rack/occupancy'
import { getContiguousRackRow } from '../rack/row-naming'
import { lengthLabel, unitNow } from '../units'

// Minimal styling matching existing panels
const FG = 'var(--foreground)'
const MUTED = 'color-mix(in oklab, var(--foreground) 60%, transparent)'
const BORDER = 'var(--border)'

export function RackRowsReportSection() {
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  // Extract labeled rows
  const rowStats = useMemo(() => {
    const racks = Object.values(nodes).filter(n => (n as any)?.type === 'warehouse:pallet-rack' && (n as PalletRackNode).rowLabel) as PalletRackNode[]
    const grouped = new Map<string, PalletRackNode[]>()
    
    for (const r of racks) {
      if (!grouped.has(r.rowLabel)) {
        grouped.set(r.rowLabel, [])
      }
      grouped.get(r.rowLabel)!.push(r)
    }

    const stats = Array.from(grouped.entries()).map(([label, rowRacks]) => {
      let positions = 0
      let direct = 0
      let picking = 0
      let occupied = 0
      let load = 0
      let totalLength = 0

      for (const r of rowRacks) {
        positions += palletSlotCount(r)
        direct += directAccessSlotCount(r)
        picking += pickingSlotCount(r)
        occupied += occupiedSlots(nodes, r.id).size
        load += fittedLevelCount(r) * r.levelCapacity
        totalLength += r.bayClearWidth + r.uprightWidth
      }

      return {
        label,
        bayCount: rowRacks.length,
        positions,
        direct,
        picking,
        occupied,
        load,
        totalLength
      }
    })

    return stats.sort((a, b) => a.label.localeCompare(b.label))
  }, [nodes])

  if (rowStats.length === 0) return null

  return (
    <section style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      padding: '0.875rem 1rem',
      borderTop: `1px solid ${BORDER}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 600, color: FG, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Rack Rows / Aisles
        </h3>
      </div>
      <p style={{ margin: 0, fontSize: '0.75rem', color: MUTED, lineHeight: 1.4 }}>
        Summary of capacities and utilization for named rack rows.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rowStats.map(stat => {
          const isExpanded = expandedRow === stat.label
          return (
            <div key={stat.label} style={{
              background: 'color-mix(in oklab, var(--foreground) 3%, transparent)',
              border: `1px solid ${BORDER}`,
              borderRadius: '6px',
              overflow: 'hidden'
            }}>
              <button
                onClick={() => setExpandedRow(isExpanded ? null : stat.label)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 600, color: FG, fontSize: '0.8125rem' }}>Row {stat.label}</span>
                  <span style={{ fontSize: '0.6875rem', color: MUTED, background: 'color-mix(in oklab, var(--foreground) 10%, transparent)', padding: '2px 6px', borderRadius: '4px' }}>
                    {stat.bayCount} bays
                  </span>
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: FG }}>
                  {stat.positions} plt
                </span>
              </button>
              
              {isExpanded && (
                <div style={{ padding: '0 0.75rem 0.75rem 0.75rem', borderTop: `1px solid ${BORDER}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', paddingTop: '0.75rem' }}>
                  <Metric label='Pallet Positions' value={stat.positions} />
                  <Metric label='Occupied' value={stat.occupied} />
                  <Metric label='Container Pos' value={stat.picking} />
                  <Metric label='Row Length' value={lengthLabel(stat.totalLength, unitNow())} />
                  <Metric label='Total Load' value={`${(stat.load / 1000).toFixed(1)} t`} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string, value: string | number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
      <span style={{ fontSize: '0.625rem', color: MUTED, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: '0.75rem', fontWeight: 500, color: FG }}>{value}</span>
    </div>
  )
}
