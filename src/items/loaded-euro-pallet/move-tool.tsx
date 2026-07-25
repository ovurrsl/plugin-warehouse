'use client'

import React, { useMemo } from 'react'
import type { AssetInput } from '@pascal-app/core'
import type { LoadedEuroPalletNode } from './schema'
import { WarehouseMoveTool } from '../../components/warehouse-move-tool'

export function LoadedEuroPalletMoveTool({ node }: { node: LoadedEuroPalletNode }) {
  const dummyAsset = useMemo<AssetInput>(
    () => ({
      id: 'loaded-euro-pallet',
      category: 'misc',
      name: 'Loaded EUR-Pallet',
      thumbnail: '/icons/shelf.webp',
      src: 'asset://loaded-euro-pallet',
      dimensions: [node.width || 1.2, node.height || 1.15, node.depth || 0.8],
      source: 'library',
    }),
    [node.width, node.height, node.depth],
  )

  return <WarehouseMoveTool node={node} dummyAsset={dummyAsset} />
}

export default LoadedEuroPalletMoveTool
