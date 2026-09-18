import { useScene } from '@pascal-app/core'
import { Figures, Note } from '../panels/kit'
import { PanelSection } from '@pascal-app/editor'
import { getContiguousRackRow } from './row-naming'
import type { PalletRackNode } from './schema'
import { directAccessSlotCount, fittedLevelCount, palletSlotCount, pickingSlotCount } from './slots'
import { occupiedSlots } from './occupancy'
import { lengthLabel, unitNow } from '../units'

/**
 * Read-only addressing & row info card for Pallet Rack inspector.
 * Manual text inputs and form controls are intentionally removed
 * so that addressing is managed centrally via the Console / AddressesTab.
 */
export function RowNaming({ node }: { node: PalletRackNode }) {
  const aisle = (node.rowLabel || node.frontAisleLabel || '').trim()
  const bay = node.bayIndex != null ? String(node.bayIndex).padStart(2, '0') : '01'
  const access = node.accessMode === 'dual-facing' ? 'Dual-facing (Çift yönlü)' : 'Single-face (Tek yönlü)'
  const mount = node.signMountStyle === 'flush' ? 'Flush (Düz)' : 'Flag (Bayrak)'

  return (
    <PanelSection title="Aisle / Row Info">
      <Figures
        rows={[
          ['Aisle / Row', aisle || 'Otomatik'],
          ['Bay Number', bay],
          ['Access Mode', access],
          ...(node.zoneCode ? ([['Zone', node.zoneCode]] as [string, string][]) : []),
          ['Sign Mount', mount],
        ]}
      />
      <RowCapacity node={node} />
      <Note>
        Adresleme ve isimlendirme ayarları Yönetim Paneli (AddressesTab) ekranından otomatik senkronize edilir.
      </Note>
    </PanelSection>
  )
}

function RowCapacity({ node }: { node: PalletRackNode }) {
  const nodes = useScene((s) => s.nodes) as Record<string, unknown>
  const rowIds = getContiguousRackRow(nodes, node.id)

  if (rowIds.length <= 1) return null

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
          ...(picking > 0 ? ([['Total Containers', `${picking}`]] as [string, string][]) : []),
          ['Occupied in Row', `${occupied}`],
          ['Total Row Load', `${(load / 1000).toFixed(1)} t`],
          ['Row Length', lengthLabel(totalLength, unitNow())],
        ]}
      />
    </div>
  )
}
