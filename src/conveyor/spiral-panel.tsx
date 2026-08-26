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
import { allLevels, type LevelLike, parentLevelIdOf } from '../host-adapter'
import { IssueList } from '../panels/issue-list'
import { Figures } from '../panels/kit'
import {
  SPIRAL_BELT_WIDTHS,
  SPIRAL_MAX_INCLINE_DEG,
  SPIRAL_OUTER_DIAMETERS,
  SPIRAL_PALLET_MIN_DIAMETER_MM,
} from './spiral-catalog'
import { resolveSpiralBuildingLevels, resolveSpiralRise } from './spiral-levels'
import { exitHeightM, helixArcLengthM, overallHeightM, turnCount } from './spiral-metrics'
import { conveyorSpiralParametrics } from './spiral-parametrics'
import { ConveyorSpiralNode } from './spiral-schema'

const LOAD_CLASS_OPTIONS = [
  { label: 'Light', value: 'light' as const },
  { label: 'Pallet', value: 'pallet' as const },
]

const FLOW_OPTIONS = [
  { label: 'Up (Inlet Low)', value: 'up' as const },
  { label: 'Down (Inlet High)', value: 'down' as const },
]

const HANDEDNESS_OPTIONS = [
  { label: 'CW (Right)', value: 'cw' as const },
  { label: 'CCW (Left)', value: 'ccw' as const },
]

function useInspectedSpiral(provided?: ConveyorSpiralNode): ConveyorSpiralNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-spiral') return null
  return selected as unknown as ConveyorSpiralNode
}

export default function SpiralPanel({ node: provided }: { node?: ConveyorSpiralNode }) {
  const selectedId = useViewer((s) => s.selection.selectedIds[0]) as AnyNodeId | undefined
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  const node = useInspectedSpiral(provided)

  const handleUpdate = useCallback(
    (updates: Partial<ConveyorSpiralNode>) => {
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
      const copy = ConveyorSpiralNode.parse({
        ...structuredClone(node),
        id: undefined,
        name: node.name ? `${node.name} Copy` : 'Spiral Conveyor Copy',
        position: [node.position[0] + 2, node.position[1], node.position[2] + 2],
      })
      createNode(copy as unknown as AnyNode, (node.parentId ?? undefined) as AnyNodeId | undefined)
      setMovingNode(copy as unknown as AnyNode)
      setSelection({ selectedIds: [] })
    } catch (e) {
      console.error('Failed to duplicate spiral conveyor', e)
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
    const bLevels = resolveSpiralBuildingLevels(nodes, node)
    if (bLevels.length > 0) return bLevels
    return allLevels(nodes)
  }, [node, nodes])

  if (!node) return null

  const resolvedRise = resolveSpiralRise(nodes, node)
  const parentLevelId = parentLevelIdOf(nodes, node)
  const fromLevelId = node.fromLevelId ?? node.baseLevelId ?? parentLevelId ?? levels[0]?.id ?? ''
  const toLevelId =
    node.toLevelId ?? node.topLevelId ?? levels[Math.min(1, levels.length - 1)]?.id ?? ''
  const isLinkedToLevels = Boolean(
    (node.fromLevelId || node.baseLevelId) &&
      (node.toLevelId || node.topLevelId) &&
      fromLevelId !== toLevelId,
  )

  const issues = conveyorSpiralParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const turns = turnCount(node, resolvedRise)
  const exitHeight = exitHeightM(node, resolvedRise)
  const overallHeight = overallHeightM(node, resolvedRise)
  const arcLength = helixArcLengthM(node, resolvedRise)

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

  return (
    <PanelWrapper
      icon="/icons/tornado.webp"
      onClose={handleClose}
      title={node.name || 'Spiral Conveyor'}
      width={320}
    >
      <IssueList issues={issues} />

      {/* Service / Floor Selection */}
      <PanelSection title="Service & Floors">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              From Level (Infeed)
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(e) => handleFromLevelChange(e.target.value)}
              value={fromLevelId}
            >
              {levels.length === 0 ? (
                <option value="">No storeys defined</option>
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
              To Level (Discharge)
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(e) => handleToLevelChange(e.target.value)}
              value={toLevelId}
            >
              {levels.length === 0 ? (
                <option value="">No storeys defined</option>
              ) : (
                levels.map((lvl) => (
                  <option key={lvl.id} value={lvl.id}>
                    {lvl.name || `Level ${lvl.level}`}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Dynamic computed rise */}
          <div className="rounded-lg border border-border/40 bg-black/20 p-2.5 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Computed Rise (H):</span>
              <span className="font-semibold text-foreground">{resolvedRise.toFixed(2)} m</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {isLinkedToLevels
                ? 'Dynamically resolved from storey elevations.'
                : 'Standalone height mode (using travelHeight).'}
            </div>
          </div>

          {!isLinkedToLevels && (
            <MetricControl
              label="Travel Rise"
              max={15}
              min={1}
              onChange={(val) => handleUpdate({ travelHeight: val })}
              precision={2}
              step={0.1}
              unit="m"
              value={node.travelHeight ?? 4}
            />
          )}
        </div>
      </PanelSection>

      {/* Machine & Load Class */}
      <PanelSection title="Machine Configuration">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Load Class
            </div>
            <SegmentedControl
              onChange={(val) =>
                handleUpdate({
                  loadClass: val,
                  ...(val === 'pallet' && Number(node.outerDiameter) < SPIRAL_PALLET_MIN_DIAMETER_MM
                    ? { outerDiameter: '2400' }
                    : {}),
                })
              }
              options={LOAD_CLASS_OPTIONS}
              value={node.loadClass}
            />
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Outer Diameter
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground"
              onChange={(e) =>
                handleUpdate({
                  outerDiameter: e.target.value as ConveyorSpiralNode['outerDiameter'],
                })
              }
              value={node.outerDiameter}
            >
              {SPIRAL_OUTER_DIAMETERS.map((dia) => (
                <option key={dia} value={dia}>
                  Ø {dia} mm {dia === '2400' ? '(Pallet standard)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Belt Width
            </div>
            <SegmentedControl
              onChange={(val) =>
                handleUpdate({
                  beltWidth: val as ConveyorSpiralNode['beltWidth'],
                })
              }
              options={SPIRAL_BELT_WIDTHS.map((w) => ({ label: `${w} mm`, value: w }))}
              value={node.beltWidth}
            />
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Flow Direction
            </div>
            <SegmentedControl
              onChange={(val) => handleUpdate({ flow: val })}
              options={FLOW_OPTIONS}
              value={node.flow}
            />
          </div>

          <div className="space-y-1.5">
            <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Handedness
            </div>
            <SegmentedControl
              onChange={(val) => handleUpdate({ handedness: val })}
              options={HANDEDNESS_OPTIONS}
              value={node.handedness}
            />
          </div>

          <SliderControl
            label="Incline"
            max={
              node.loadClass === 'light'
                ? SPIRAL_MAX_INCLINE_DEG.light
                : SPIRAL_MAX_INCLINE_DEG.pallet
            }
            min={3}
            onChange={(val) => handleUpdate({ inclineDeg: val })}
            precision={1}
            step={0.5}
            unit="°"
            value={node.inclineDeg}
          />

          <MetricControl
            label="Infeed Elevation"
            max={3}
            min={0.37}
            onChange={(val) => handleUpdate({ entryHeight: val })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.entryHeight}
          />
        </div>
      </PanelSection>

      {/* Geometry & Options */}
      <PanelSection title="Geometry & Protection">
        <div className="space-y-3">
          <ToggleControl
            checked={node.hasCage}
            label="Safety Enclosure Cage"
            onChange={(checked) => handleUpdate({ hasCage: checked })}
          />

          <ToggleControl
            checked={node.hasHandrail}
            label="Helical Handrail"
            onChange={(checked) => handleUpdate({ hasHandrail: checked })}
          />

          <div className="rounded-lg border border-border/40 bg-black/20 p-2 space-y-1">
            <Figures
              rows={[
                ['Turns count', `${turns.toFixed(1)} turns`],
                ['Exit elevation', `${exitHeight.toFixed(2)} m`],
                ['Overall height', `${overallHeight.toFixed(2)} m`],
                ['Helix arc length', `${arcLength.toFixed(2)} m`],
              ]}
            />
          </div>
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
            label="-45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const rot = [...(node.rotation ?? [0, 0, 0])] as [number, number, number]
              rot[1] -= Math.PI / 4
              handleUpdate({ rotation: rot })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const rot = [...(node.rotation ?? [0, 0, 0])] as [number, number, number]
              rot[1] += Math.PI / 4
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
