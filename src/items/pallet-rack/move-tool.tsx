'use client'

import React, { useMemo } from 'react'
import type { AssetInput } from '@pascal-app/core'
import type { PalletRackNode } from './schema'
import { WarehouseMoveTool } from '../../components/warehouse-move-tool'

export function PalletRackMoveTool({ node }: { node: PalletRackNode }) {
  const dummyAsset = useMemo<AssetInput>(
    () => ({
      id: 'pallet-rack',
      category: 'misc',
      name: 'Pallet Rack',
      thumbnail: '/icons/shelf.webp',
      src: 'asset://pallet-rack',
      dimensions: [(node.columns || 1) * (node.bayWidth || 2.7), node.uprightHeight || 4.5, node.depth || 1.1],
      source: 'library',
    }),
    [node.columns, node.bayWidth, node.uprightHeight, node.depth],
  )

  return <WarehouseMoveTool node={node} dummyAsset={dummyAsset} />
}

export default PalletRackMoveTool
