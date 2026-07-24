'use client'

import React from 'react'
import { euroPalletDefinition } from './definition'
import { WarehousePlacementTool } from '../components/warehouse-placement-tool'

export default function EuroPalletTool() {
  return (
    <WarehousePlacementTool
      type={euroPalletDefinition.kind}
      name="EUR-Pallet"
      definitionDefaults={euroPalletDefinition.defaults()}
    />
  )
}
