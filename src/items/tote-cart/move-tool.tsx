'use client'

import React, { useMemo } from 'react'
import type { AssetInput } from '@pascal-app/core'
import type { ToteCartNode } from './schema'
import { WarehouseMoveTool } from '../../components/warehouse-move-tool'

export function ToteCartMoveTool({ node }: { node: ToteCartNode }) {
  const dummyAsset = useMemo<AssetInput>(
    () => ({
      id: 'tote-cart',
      category: 'misc',
      name: 'Tote Cart Trolley',
      thumbnail: '/icons/shelf.webp',
      src: 'asset://tote-cart',
      dimensions: [node.width || 0.6, node.height || 1.5, node.depth || 0.4],
      source: 'library',
    }),
    [node.width, node.height, node.depth],
  )

  return <WarehouseMoveTool node={node} dummyAsset={dummyAsset} />
}

export default ToteCartMoveTool
