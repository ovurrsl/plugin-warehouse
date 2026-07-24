'use client'

import React, { useMemo } from 'react'
import { euroPalletDefinition } from './definition'
import { WarehousePlacementTool } from '../components/warehouse-placement-tool'

export default function EuroPalletTool() {
  const defaults = useMemo(() => euroPalletDefinition.defaults(), [])
  return (
    <WarehousePlacementTool
      type={euroPalletDefinition.kind}
      name="EUR-Pallet"
      definitionDefaults={defaults}
    />
  )
}
