'use client'

import React, { useMemo } from 'react'
import type { AssetInput } from '@pascal-app/core'
import type { EuroPalletNode } from './schema'
import { WarehouseMoveTool } from '../components/warehouse-move-tool'

export function EuroPalletMoveTool({ node }: { node: EuroPalletNode }) {
  const dummyAsset = useMemo<AssetInput>(
    () => ({
      id: 'euro-pallet',
      category: 'misc',
      name: 'EUR-Pallet',
      thumbnail: '/icons/shelf.webp',
      src: 'asset://euro-pallet',
      dimensions: [1.2, 0.144, 0.8],
      source: 'library',
    }),
    [],
  )

  return <WarehouseMoveTool node={node} dummyAsset={dummyAsset} />
}

export default EuroPalletMoveTool
