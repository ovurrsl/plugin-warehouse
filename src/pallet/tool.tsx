'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { electSupportSlab, usePlacement } from '../placement'
import { useWarehouseStore } from '../store'
import PalletPreview from './preview'
import { PalletNode } from './schema'

/**
 * Mounted by the host's registry-driven tool manager whenever
 * `tool === 'warehouse:pallet'` — no host edit per kind. The catalog panel arms
 * it by setting that tool id.
 */
export default function PalletTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const preset = useWarehouseStore((s) => s.palletPreset)
  const loadHeight = useWarehouseStore((s) => s.palletLoadHeight)

  const previewNode = useMemo(
    () => PalletNode.parse({ preset, loadHeight, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [preset, loadHeight],
  )

  const { cursorRef, cursorVisible } = usePlacement(activeLevelId, (position) => {
    if (!activeLevelId) return
    const brush = useWarehouseStore.getState()
    const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>

    const pallet = PalletNode.parse({
      preset: brush.palletPreset,
      loadHeight: brush.palletLoadHeight,
      position,
      rotation: [0, 0, 0],
      // Elected once, here, rather than recomputed on every stats render.
      supportSlabId: electSupportSlab(nodes, activeLevelId, position[0], position[2]),
    })

    useScene.getState().createNode(pallet as unknown as AnyNode, activeLevelId as AnyNodeId)
    useViewer.getState().setSelection({ selectedIds: [pallet.id as AnyNodeId] })
    triggerSFX('sfx:item-place')
  })

  if (!activeLevelId) return null

  return (
    <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
      <PalletPreview node={previewNode} />
    </group>
  )
}
