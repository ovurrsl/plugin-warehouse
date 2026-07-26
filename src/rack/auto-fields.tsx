'use client'

import { Icon } from '@iconify/react'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { SegmentedControl } from '@pascal-app/editor'
import type { CSSProperties } from 'react'
import type { PalletRackNode } from './schema'
import {
  autoPalletSupportBars,
  autoPalletsPerLevel,
  autoPickingBoxesAcross,
  autoPickingBoxesDeep,
} from './slots'

/**
 * The fields that mean "work it out unless I say otherwise".
 *
 * Four of the rack's settings are `number | null`, where **null is the whole
 * point**: null means the value is derived from the geometry, so a bay widened
 * from 2.7 m to 3.5 m starts holding four pallets instead of three without
 * anyone editing a second field.
 *
 * The host's inspector cannot express that. `parametric-inspector.tsx` renders
 * a number field as `typeof value === 'number' ? value : 0`, so a null shows as
 * 0 — clamped by the slider to whatever its minimum happens to be — and the
 * first drag writes a real number over the null, silently converting a value
 * that tracked the geometry into a frozen one. There is no `kind` in
 * `ParamField` for a nullable number, so these four cannot live in `groups` at
 * all; they live here, in the plugin's own trailing section, where the control
 * can say *Auto — 3* and mean it.
 */

const FG = 'var(--foreground)'
const MUTED = 'var(--muted-foreground)'
const BORDER = 'var(--border)'

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
    marginBottom: '0.875rem',
    paddingBottom: '0.875rem',
    borderBottom: `1px solid ${BORDER}`,
    color: FG,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontSize: '0.6875rem',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: MUTED,
  },
  field: { display: 'flex', flexDirection: 'column', gap: '0.3125rem' },
  label: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    fontSize: '0.6875rem',
    color: MUTED,
  },
} satisfies Record<string, CSSProperties>

/** Auto plus the counts around the derived one, so the choice is a short list
 *  rather than a slider whose useful range is three values wide. */
function optionsAround(auto: number, min: number, max: number): string[] {
  const wanted = [auto - 1, auto, auto + 1, auto + 2]
  const seen = new Set<number>()
  for (const value of wanted) {
    if (value >= min && value <= max) seen.add(value)
  }
  return [...seen].sort((a, b) => a - b).map(String)
}

function AutoField({
  auto,
  label,
  max,
  min,
  onChange,
  value,
}: {
  auto: number
  label: string
  max: number
  min: number
  onChange: (next: number | null) => void
  value: number | null
}) {
  return (
    <div style={styles.field}>
      <span style={styles.label}>
        <span>{label}</span>
        <span style={{ opacity: 0.7 }}>{value === null ? `auto — ${auto}` : 'set by hand'}</span>
      </span>
      <SegmentedControl
        onChange={(next: string) => onChange(next === 'auto' ? null : Number(next))}
        options={[
          { label: 'Auto', value: 'auto' },
          ...optionsAround(auto, min, max).map((option) => ({ label: option, value: option })),
        ]}
        value={value === null ? 'auto' : String(value)}
      />
    </div>
  )
}

export default function RackAutoFields({ node }: { node: PalletRackNode }) {
  const write = (patch: Partial<PalletRackNode>) =>
    useScene.getState().updateNode(node.id as AnyNodeId, patch as unknown as Partial<AnyNode>)

  const picking = node.pickingLevels > 0

  return (
    <div style={styles.root}>
      <span style={styles.title}>
        <Icon height={13} icon="lucide:wand-sparkles" width={13} />
        Derived
      </span>

      <AutoField
        auto={autoPalletsPerLevel(node)}
        label="Pallets per level"
        max={12}
        min={1}
        onChange={(palletsPerLevel) => write({ palletsPerLevel })}
        value={node.palletsPerLevel}
      />

      <AutoField
        auto={autoPalletSupportBars(node)}
        label="Pallet support bars"
        max={3}
        min={0}
        onChange={(palletSupportBars) => write({ palletSupportBars })}
        value={node.palletSupportBars}
      />

      {picking ? (
        <>
          <AutoField
            auto={autoPickingBoxesAcross(node)}
            label="Boxes across"
            max={30}
            min={1}
            onChange={(pickingBoxesAcross) => write({ pickingBoxesAcross })}
            value={node.pickingBoxesAcross}
          />
          <AutoField
            auto={autoPickingBoxesDeep(node)}
            label="Boxes deep"
            max={10}
            min={1}
            onChange={(pickingBoxesDeep) => write({ pickingBoxesDeep })}
            value={node.pickingBoxesDeep}
          />
        </>
      ) : null}
    </div>
  )
}
