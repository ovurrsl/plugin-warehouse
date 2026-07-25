import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { registerEditorHostPanel } from '@pascal-app/editor'

import { conveyorDefinition } from './items/conveyor/definition'
import { euroPalletDefinition } from './items/euro-pallet/definition'
import { loadedEuroPalletDefinition } from './items/loaded-euro-pallet/definition'
import { palletRackDefinition } from './items/pallet-rack/definition'
import { toteCartDefinition } from './items/tote-cart/definition'
import { warehouseHostPanel, warehousePanel } from './panel'

// Register the custom plugin panel in the editor's left sidebar
if (typeof registerEditorHostPanel === 'function') {
  registerEditorHostPanel(warehouseHostPanel)
}

export const warehousePlugin: Plugin = {
  id: 'ovurr:warehouse',
  apiVersion: 1,
  nodes: [
    palletRackDefinition as unknown as AnyNodeDefinition,
    euroPalletDefinition as unknown as AnyNodeDefinition,
    loadedEuroPalletDefinition as unknown as AnyNodeDefinition,
    conveyorDefinition as unknown as AnyNodeDefinition,
    toteCartDefinition as unknown as AnyNodeDefinition,
  ],
}

export {
  conveyorDefinition,
  euroPalletDefinition,
  loadedEuroPalletDefinition,
  palletRackDefinition,
  toteCartDefinition,
  warehouseHostPanel,
  warehousePanel,
}
export default warehousePlugin
