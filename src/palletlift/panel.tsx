'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import {
  allLevels,
  buildingOfLevel,
  type LevelLike,
  levelsOfBuilding,
  parentLevelIdOf,
} from '../host-adapter'
import { PALLET_PRESET_IDS } from '../pallet/presets'
import { IssueList } from '../panels/issue-list'
import { Figures } from '../panels/kit'
import { CAPACITY_CLASSES } from './catalog'
import { mastHeightM, resolveLift, resolvePalletLiftLevels, riseM } from './levels'
import { palletLiftParametrics } from './parametrics'
import { PalletLiftNode } from './schema'

const CAPACITY_OPTIONS = CAPACITY_CLASSES.map((c) => ({
  label: `${c} kg`,
  value: c,
}))

const MAST_COUNT_OPTIONS = [
  { label: '2 Masts', value: '2' as const },
  { label: '4 Masts', value: '4' as const },
]

const PALLET_PRESET_OPTIONS = PALLET_PRESET_IDS.map((p) => ({
  label: p,
  value: p,
}))

function useInspectedPalletLift(provided?: PalletLiftNode): PalletLiftNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:pallet-lift') return null
  return selected as unknown as PalletLiftNode
}

export default function PalletLiftPanel({ node: provided }: { node?: PalletLiftNode }) {
  const selectedId = useViewer((s) => s.selection.selectedIds[0]) as AnyNodeId | undefined
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  const node = useInspectedPalletLift(provided)

  const handleUpdate = useCallback(
    (updates: Partial<PalletLiftNode>) => {
      if (!selectedId) return
      updateNode(selectedId, updates as unknown as Partial<AnyNode>)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (node) {
      triggerSFX('sfx:item-pick')
      setMovingNode(node as unknown as AnyNode)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    try {
      const copy = PalletLiftNode.parse({
        ...structuredClone(node),
        id: undefined,
        name: node.name ? `${node.name} Copy` : 'Pallet Lift Copy',
        position: [node.position[0] + 2, node.position[1], node.position[2] + 2],
      })
      createNode(copy as unknown as AnyNode, (node.parentId ?? undefined) as AnyNodeId | undefined)
      setMovingNode(copy as unknown as AnyNode)
      setSelection({ selectedIds: [] })
    } catch (e) {
      console.error('Failed to duplicate pallet lift', e)
    }
  }, [node, createNode, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId || !node) return
    triggerSFX('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId)
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNodeId)
    }
    setSelection({ selectedIds: [] })
  }, [selectedId, node, setSelection])

  // Available building levels
  const levels = useMemo<LevelLike[]>(() => {
    if (!node) return []
    const parentLevelId = parentLevelIdOf(nodes, node)
    const buildingId = buildingOfLevel(nodes, parentLevelId)
    const bLevels = levelsOfBuilding(nodes, buildingId)
    if (bLevels.length > 0) return bLevels
    return allLevels(nodes)
  }, [node, nodes])

  if (!node) return null

  const resolvedLift = resolveLift(nodes, node)
  const resolvedLevels = resolvePalletLiftLevels(node, nodes)
  const resolvedRise = riseM(nodes, node)
  const resolvedMastHeight = mastHeightM(nodes, node)

  const fromLevelId =
    node.fromLevelId ?? node.baseLevelId ?? (levels.length > 0 ? levels[0]?.id : '') ?? ''
  const toLevelId =
    node.toLevelId ??
    node.topLevelId ??
    (levels.length > 0 ? levels[levels.length - 1]?.id : '') ??
    ''
  const defaultLevelId =
    node.defaultLevelId ?? fromLevelId ?? (levels.length > 0 ? levels[0]?.id : '') ?? ''

  const disabledLevelSet = new Set<string>(node.disabledLevelIds ?? [])
  const serviceOnlyLevelSet = new Set<string>(node.serviceOnlyLevelIds ?? [])

  const issues = palletLiftParametrics.invariants?.flatMap((check) => check(node)) ?? []

  const handleFromLevelChange = (levelId: string) => {
    const nextLevelId = levelId || undefined
    handleUpdate({
      fromLevelId: nextLevelId,
      baseLevelId: nextLevelId,
    })
  }

  const handleToLevelChange = (levelId: string) => {
    const nextLevelId = levelId || undefined
    handleUpdate({
      toLevelId: nextLevelId,
      topLevelId: nextLevelId,
    })
  }

  const handleDefaultLevelChange = (levelId: string) => {
    handleUpdate({
      defaultLevelId: levelId || undefined,
    })
  }

  const toggleLevelAccess = (
    field: 'disabledLevelIds' | 'serviceOnlyLevelIds',
    levelId: string,
  ) => {
    const targetSet = new Set(field === 'disabledLevelIds' ? disabledLevelSet : serviceOnlyLevelSet)
    const otherSet = new Set(field === 'disabledLevelIds' ? serviceOnlyLevelSet : disabledLevelSet)

    if (targetSet.has(levelId)) {
      targetSet.delete(levelId)
    } else {
      targetSet.add(levelId)
      otherSet.delete(levelId)
    }

    if (field === 'disabledLevelIds') {
      handleUpdate({
        disabledLevelIds: Array.from(targetSet),
        serviceOnlyLevelIds: Array.from(otherSet),
      })
    } else {
      handleUpdate({
        serviceOnlyLevelIds: Array.from(targetSet),
        disabledLevelIds: Array.from(otherSet),
      })
    }
  }

  const hasMultipleStoreys = levels.length >= 2

  return (
    <PanelWrapper
      icon="/icons/elevator.webp"
      onClose={handleClose}
      title={node.name || 'Pallet Lift'}
      width={320}
    >
      <IssueList issues={issues} />

      {/* Service & Floor Selection */}
      <PanelSection title="Service & Floors">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                From Level
              </div>
              <select
                className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-sm text-foreground"
                onChange={(e) => handleFromLevelChange(e.target.value)}
                value={fromLevelId}
              >
                {levels.length === 0 ? (
                  <option value="">No storeys</option>
                ) : (
                  levels.map((lvl) => (
                    <option key={lvl.id} value={lvl.id}>
                      {lvl.name || `Level ${lvl.level}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                To Level
              </div>
              <select
                className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-sm text-foreground"
                onChange={(e) => handleToLevelChange(e.target.value)}
                value={toLevelId}
              >
                {levels.length === 0 ? (
                  <option value="">No storeys</option>
                ) : (
                  levels.map((lvl) => (
                    <option key={lvl.id} value={lvl.id}>
                      {lvl.name || `Level ${lvl.level}`}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Default Floor
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(e) => handleDefaultLevelChange(e.target.value)}
              value={defaultLevelId}
            >
              {resolvedLevels.servedLevels.map((lvl) => (
                <option key={lvl.id} value={lvl.id}>
                  {lvl.name} (relative kot:{' '}
                  {lvl.elevation >= 0 ? `+${lvl.elevation.toFixed(2)}` : lvl.elevation.toFixed(2)}{' '}
                  m)
                </option>
              ))}
            </select>
          </div>

          {/* Dynamic computed mast height & travel rise */}
          <div className="rounded-lg border border-border/40 bg-black/20 p-2.5 space-y-1">
            <Figures
              rows={[
                ['Served stops', `${resolvedLift.stops.length} levels`],
                ['Travel rise', `${resolvedRise.toFixed(2)} m`],
                ['Total mast height', `${resolvedMastHeight.toFixed(2)} m`],
              ]}
            />
            <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/20">
              {hasMultipleStoreys
                ? 'Derived dynamically from building storey stack.'
                : 'Single-storey fallback mode (using fallbackTravelM).'}
            </div>
          </div>

          {!hasMultipleStoreys && (
            <MetricControl
              label="Fallback Travel"
              max={12}
              min={1.5}
              onChange={(val) =>
                handleUpdate({
                  fallbackTravelM: val,
                  travelHeight: val,
                })
              }
              precision={2}
              step={0.5}
              unit="m"
              value={node.fallbackTravelM ?? node.travelHeight ?? 3}
            />
          )}
        </div>
      </PanelSection>

      {/* Floor Access & Permissions */}
      {resolvedLevels.servedLevels.length > 0 && (
        <PanelSection title="Served Floor Access">
          <div className="space-y-2">
            {resolvedLevels.servedLevels.map((lvl) => {
              const isDisabled = disabledLevelSet.has(lvl.id)
              const isServiceOnly = serviceOnlyLevelSet.has(lvl.id)

              return (
                <div
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/45 bg-[#2C2C2E] px-2.5 py-2"
                  key={lvl.id}
                >
                  <span className="min-w-0 truncate text-xs text-foreground">
                    {lvl.name} (
                    {lvl.elevation >= 0 ? `+${lvl.elevation.toFixed(2)}` : lvl.elevation.toFixed(2)}{' '}
                    m)
                  </span>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                        isServiceOnly
                          ? 'border-sky-300/45 bg-sky-400/20 text-sky-100'
                          : 'border-border/50 bg-black/15 text-muted-foreground hover:text-foreground'
                      } ${isDisabled ? 'cursor-not-allowed opacity-40' : ''}`}
                      disabled={isDisabled}
                      onClick={() => toggleLevelAccess('serviceOnlyLevelIds', lvl.id)}
                      type="button"
                    >
                      Service
                    </button>
                    <button
                      className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                        isDisabled
                          ? 'border-red-300/45 bg-red-400/20 text-red-100'
                          : 'border-border/50 bg-black/15 text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => toggleLevelAccess('disabledLevelIds', lvl.id)}
                      type="button"
                    >
                      Disabled
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </PanelSection>
      )}

      {/* Machine & Specifications */}
      <PanelSection title="Machine Specifications">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Capacity Class
            </div>
            <SegmentedControl
              onChange={(val) =>
                handleUpdate({
                  capacityClass: val as PalletLiftNode['capacityClass'],
                  ...(val === '4500' ? { mastCount: '4' } : {}),
                })
              }
              options={CAPACITY_OPTIONS}
              value={node.capacityClass}
            />
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Mast Configuration
            </div>
            <SegmentedControl
              onChange={(val) => handleUpdate({ mastCount: val })}
              options={MAST_COUNT_OPTIONS}
              value={node.mastCount}
            />
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Pallet Preset
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(e) =>
                handleUpdate({
                  palletPreset: e.target.value as PalletLiftNode['palletPreset'],
                })
              }
              value={node.palletPreset}
            >
              {PALLET_PRESET_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </PanelSection>

      {/* Enclosure & Safety */}
      <PanelSection title="Enclosure & Safety">
        <div className="space-y-2.5">
          <ToggleControl
            checked={node.hasEnclosure}
            label="Safety Mesh Enclosure"
            onChange={(checked) => handleUpdate({ hasEnclosure: checked })}
          />

          <ToggleControl
            checked={node.hasDoors}
            label="Landing Safety Doors"
            onChange={(checked) => handleUpdate({ hasDoors: checked })}
          />

          <ToggleControl
            checked={node.hasControlPanel}
            label="Control Cabinet Unit"
            onChange={(checked) => handleUpdate({ hasControlPanel: checked })}
          />
        </div>
      </PanelSection>

      {/* Position & Transform */}
      <PanelSection title="Position & Alignment">
        <SliderControl
          label="X"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label="Y"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(deg) => {
            const rot = [...(node.rotation ?? [0, 0, 0])] as [number, number, number]
            rot[1] = (deg * Math.PI) / 180
            handleUpdate({ rotation: rot })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round(((node.rotation?.[1] ?? 0) * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-90°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const rot = [...(node.rotation ?? [0, 0, 0])] as [number, number, number]
              rot[1] -= Math.PI / 2
              handleUpdate({ rotation: rot })
            }}
          />
          <ActionButton
            label="+90°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const rot = [...(node.rotation ?? [0, 0, 0])] as [number, number, number]
              rot[1] += Math.PI / 2
              handleUpdate({ rotation: rot })
            }}
          />
        </div>
      </PanelSection>

      {/* Actions */}
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
