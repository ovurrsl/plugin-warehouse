'use client'

import React, { useMemo } from 'react'
import { palletRackDefinition } from './definition'
import { WarehousePlacementTool } from '../../components/warehouse-placement-tool'

export default function PalletRackTool() {
  const defaults = useMemo(() => palletRackDefinition.defaults(), [])
  return (
    <WarehousePlacementTool
      type={palletRackDefinition.kind}
      name="Pallet Rack"
      definitionDefaults={defaults}
    />
  )
}
