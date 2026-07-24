'use client'

import React, { useMemo, useRef } from 'react'
import type { AssetInput } from '@pascal-app/core'
import { triggerSFX, useDraftNode, useEditor, usePlacementCoordinator } from '@pascal-app/editor'

/**
 * Universal Warehouse Item Placement Tool
 *
 * Wraps Pascal's `usePlacementCoordinator` engine to give all warehouse items
 * (euro-pallet, pallet-rack, conveyor, etc.) the exact same placement UI,
 * collision bounds checks, and continuous placement flow as the system's
 * Cactus / TV Stand items.
 */
export function WarehousePlacementTool({ 
  type,
  name,
  definitionDefaults 
}: { 
  type: string
  name: string
  definitionDefaults: any
}) {
  const draftNode = useDraftNode()
  const isContinuousRef = useRef(false)

  const rawToolDefaults = useEditor((s) => s.toolDefaults[type]) || {}
  
  const dummyAsset = useMemo<AssetInput>(() => ({
    id: type,
    category: 'misc',
    name: name,
    thumbnail: '/icons/shelf.webp',
    src: `asset://${type.replace(/:/g, '-')}`,
    dimensions: definitionDefaults.width && definitionDefaults.depth && definitionDefaults.height 
        ? [definitionDefaults.width, definitionDefaults.height, definitionDefaults.depth] 
        : [1.2, 1.15, 0.8],
    source: 'library',
  }), [type, name, definitionDefaults])

  const cursor = usePlacementCoordinator({
    asset: dummyAsset,
    draftNode,
    initDraft: (gridPosition) => {
      // Pass the parametric type inside defaultData so useDraftNode parses it natively!
      draftNode.create(gridPosition, dummyAsset, [0, 0, 0], [1, 1, 1], undefined, {
        type: type,
        ...definitionDefaults,
        ...rawToolDefaults
      })
    },
    onCommitted: () => {
      const editorState = useEditor.getState()
      const isRepeat = editorState.getContinuation('point') === 'repeat'
      isContinuousRef.current = isRepeat

      // draftNode.commit() has now synchronously created the native node (e.g. warehouse:euro-pallet)
      // inside the paused Temporal window! No setTimeout hacks required.
      triggerSFX('sfx:item-place')
      return isRepeat
    },
  })

  return <>{cursor}</>
}

export default WarehousePlacementTool
