'use client'

import React from 'react'
import type { AssetInput } from '@pascal-app/core'
import {
  type PlacementState,
  triggerSFX,
  useDraftNode,
  useEditor,
  usePlacementCoordinator,
} from '@pascal-app/editor'
import { Vector3 } from 'three'

/**
 * Universal Warehouse Item Move Tool
 *
 * Wraps Pascal's `usePlacementCoordinator` engine to give all warehouse items
 * the exact same move and duplicate UI bounds checks as standard items.
 */
export function WarehouseMoveTool({ 
  node,
  dummyAsset
}: { 
  node: any,
  dummyAsset: AssetInput
}) {
  const draftNode = useDraftNode()

  const meta =
    typeof node.metadata === 'object' && node.metadata !== null
      ? (node.metadata as Record<string, unknown>)
      : {}
  const isNew = Boolean(meta.isNew)

  const initialState: PlacementState = {
    surface: 'floor',
    wallId: null,
    roofSegmentId: null,
    ceilingId: null,
    surfaceItemId: null,
    shelfId: null,
  }

  usePlacementCoordinator({
    asset: dummyAsset,
    draftNode,
    initialState,
    preserveDragOffset: !isNew,
    initDraft: (gridPosition) => {
      const pos = node.position || [0, 0, 0]
      gridPosition.copy(new Vector3(pos[0], pos[1], pos[2]))
      if (isNew) {
        draftNode.create(gridPosition, dummyAsset, node.rotation || [0, 0, 0], [1, 1, 1], undefined, {
          type: node.type,
          ...node,
        })
      } else {
        draftNode.adopt({ ...node, asset: dummyAsset, scale: node.scale || [1, 1, 1] } as any)
      }
    },
    onCommitted: () => {
      triggerSFX('sfx:item-place')
      useEditor.getState().setMovingNode(null)
      return true
    },
    onCancel: () => {
      useEditor.getState().setMovingNode(null)
    },
  })

  return null
}

export default WarehouseMoveTool
