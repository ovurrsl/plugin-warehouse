'use client'

import React, { useMemo } from 'react'
import { loadedEuroPalletDefinition } from './definition'
import { WarehousePlacementTool } from '../../components/warehouse-placement-tool'

export default function LoadedEuroPalletTool() {
  const defaults = useMemo(() => loadedEuroPalletDefinition.defaults(), [])
  return (
    <WarehousePlacementTool
      type={loadedEuroPalletDefinition.kind}
      name="Loaded EUR-Pallet"
      definitionDefaults={defaults}
    />
  )
}
