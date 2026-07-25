'use client'

import React, { useCallback, useRef } from 'react'
import { type AnyNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import type { LoadedEuroPalletNode } from './schema'

export default function LoadedEuroPalletPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as unknown as LoadedEuroPalletNode | undefined) : undefined,
  )

  const nodeRef = useRef(node)
  nodeRef.current = node

  const handleUpdate = useCallback(
    (updates: Record<string, unknown>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNode['id'], updates as any)
    },
    [selectedId],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (node) {
      triggerSFX('sfx:item-pick')
      setMovingNode(node as any)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    const proto = {
      object: 'node' as const,
      type: 'warehouse:loaded-euro-pallet' as const,
      name: node.name || 'Loaded EUR-Pallet',
      parentId: node.parentId,
      position: [...(node.position || [0, 0, 0])] as [number, number, number],
      rotation: [...(node.rotation || [0, 0, 0])] as [number, number, number],
      visible: true,
      metadata: { isNew: true },
    }
    setMovingNode(proto as any)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    triggerSFX('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [selectedId, deleteNode, setSelection])

  if (!node || (node.type as string) !== 'warehouse:loaded-euro-pallet' || !selectedId) return null

  const pos = node.position ?? [0, 0, 0]
  const rot = node.rotation ?? [0, 0, 0]

  return (
    <PanelWrapper icon="/icons/shelf.webp" onClose={handleClose} title={node.name || 'Loaded EUR-Pallet'} width={300}>
      <PanelSection title="Position">
        <SliderControl
          label="X pos"
          max={pos[0] + 5}
          min={pos[0] - 5}
          onChange={(val) => handleUpdate({ position: [val, pos[1], pos[2]] })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(pos[0] * 100) / 100}
        />
        <SliderControl
          label="Y pos"
          max={pos[1] + 5}
          min={pos[1] - 5}
          onChange={(val) => handleUpdate({ position: [pos[0], val, pos[2]] })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(pos[1] * 100) / 100}
        />
        <SliderControl
          label="Z pos"
          max={pos[2] + 5}
          min={pos[2] - 5}
          onChange={(val) => handleUpdate({ position: [pos[0], pos[1], val] })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(pos[2] * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Rotation">
        <SliderControl
          label="Y rot"
          max={Math.round(((rot[1] || 0) * 180) / Math.PI) + 45}
          min={Math.round(((rot[1] || 0) * 180) / Math.PI) - 45}
          onChange={(degrees) => {
            const radians = (degrees * Math.PI) / 180
            handleUpdate({ rotation: [rot[0] || 0, radians, rot[2] || 0] })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round(((rot[1] || 0) * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const currentDegrees = ((rot[1] || 0) * 180) / Math.PI
              const radians = ((currentDegrees - 45) * Math.PI) / 180
              handleUpdate({ rotation: [rot[0] || 0, radians, rot[2] || 0] })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const currentDegrees = ((rot[1] || 0) * 180) / Math.PI
              const radians = ((currentDegrees + 45) * Math.PI) / 180
              handleUpdate({ rotation: [rot[0] || 0, radians, rot[2] || 0] })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
