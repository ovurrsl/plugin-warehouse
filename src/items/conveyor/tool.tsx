'use client'

import React, { useMemo } from 'react'
import { conveyorDefinition } from './definition'
import { WarehousePlacementTool } from '../../components/warehouse-placement-tool'

export default function ConveyorTool() {
  const defaults = useMemo(() => conveyorDefinition.defaults(), [])
  return (
    <WarehousePlacementTool
      type={conveyorDefinition.kind}
      name="Conveyor"
      definitionDefaults={defaults}
    />
  )
}
