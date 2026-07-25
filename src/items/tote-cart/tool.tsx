'use client'

import React, { useMemo } from 'react'
import { toteCartDefinition } from './definition'
import { WarehousePlacementTool } from '../../components/warehouse-placement-tool'

export default function ToteCartTool() {
  const defaults = useMemo(() => toteCartDefinition.defaults(), [])
  return (
    <WarehousePlacementTool
      type={toteCartDefinition.kind}
      name="Tote Cart"
      definitionDefaults={defaults}
    />
  )
}
