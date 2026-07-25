'use client'

import React, { useMemo } from 'react'
import type { AssetInput } from '@pascal-app/core'
import type { ConveyorNode } from './schema'
import { WarehouseMoveTool } from '../../components/warehouse-move-tool'

export function ConveyorMoveTool({ node }: { node: ConveyorNode }) {
  const dummyAsset = useMemo<AssetInput>(
    () => ({
      id: 'conveyor',
      category: 'misc',
      name: 'Wire Mesh Conveyor',
      thumbnail: '/icons/shelf.webp',
      src: 'asset://conveyor',
      dimensions: [node.width || 3.0, node.height || 0.6, node.depth || 0.8],
      source: 'library',
    }),
    [node.width, node.height, node.depth],
  )

  return <WarehouseMoveTool node={node} dummyAsset={dummyAsset} />
}

export default ConveyorMoveTool
