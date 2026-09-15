import { type AnyNodeId, useScene } from '@pascal-app/core'
import { Field, Figures } from '../panels/kit'
import { PanelSection } from '@pascal-app/editor'
import { useState, useEffect } from 'react'
import { applyRowLabelToContiguousRacks, getContiguousRackRow } from './row-naming'
import type { PalletRackNode } from './schema'
import { directAccessSlotCount, fittedLevelCount, palletSlotCount, pickingSlotCount } from './slots'
import { occupiedSlots } from './occupancy'
import { lengthLabel, unitNow } from '../units'

export function RowNaming({ node }: { node: PalletRackNode }) {
  const [label, setLabel] = useState(node.rowLabel ?? '')
  
  useEffect(() => {
    setLabel(node.rowLabel ?? '')
  }, [node.rowLabel])

  const applyLabel = () => {
    if (label !== node.rowLabel) {
      applyRowLabelToContiguousRacks(node.id, label)
    }
  }

  return (
    <PanelSection title='Aisle / Row Naming'>
      <Field label='Row Label'>
        <input 
          type='text' 
          value={label} 
          onChange={e => setLabel(e.target.value)}
          onBlur={applyLabel}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLabel() } }}
          style={{ flex: 1, padding: '4px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)' }}
        />
      </Field>
      {node.rowLabel && <RowCapacity node={node} />}
    </PanelSection>
  )
}

function RowCapacity({ node }: { node: PalletRackNode }) {
  const nodes = useScene(s => s.nodes) as Record<string, unknown>
  const rowIds = getContiguousRackRow(nodes, node.id)
  
  let positions = 0
  let direct = 0
  let picking = 0
  let occupied = 0
  let load = 0
  let totalLength = 0
  
  for (const id of rowIds) {
    const r = nodes[id] as PalletRackNode
    if (!r) continue
    positions += palletSlotCount(r)
    direct += directAccessSlotCount(r)
    picking += pickingSlotCount(r)
    occupied += occupiedSlots(nodes, id).size
    load += fittedLevelCount(r) * r.levelCapacity
    totalLength += r.bayClearWidth + r.uprightWidth
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <Figures
        rows={[
          ['Bays in Row', `${rowIds.length}`],
          ['Total Pallets', positions === direct ? `${positions}` : `${positions} · ${direct} direct`],
          picking > 0 && (['Total Containers', `${picking}`] as const),
          ['Occupied in Row', `${occupied}`],
          ['Total Row Load', `${(load / 1000).toFixed(1)} t`],
          ['Row Length', lengthLabel(totalLength, unitNow())],
        ]}
      />
    </div>
  )
}
