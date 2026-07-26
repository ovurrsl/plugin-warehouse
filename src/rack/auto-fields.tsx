'use client'

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
 * The host's plain number field cannot express that — `parametric-inspector.tsx`
 * renders a number as `typeof value === 'number' ? value : 0`, so a null shows
 * as 0, clamped by the slider to its minimum, and the first drag writes a real
 * number over the null: a value that tracked the geometry is silently frozen.
 *
 * These used to live in the plugin's own trailing section on the stated grounds
 * that `ParamField` had no kind for a nullable number. That was simply wrong —
 * `kind: 'custom'` exists, the host subscribes the node and passes `onUpdate`,
 * and first-party kinds already use it for exactly this. Being wrong about it
 * cost more than the duplicated markup: a field in the trailing section is
 * exempt from `parametrics.test.ts`'s coverage assertions, so all four sat
 * outside the one test that checks every schema field is reachable.
 */

const MUTED = 'var(--muted-foreground)'

const styles = {
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

/**
 * One component per field, each matching the host's custom-field contract:
 * `{ node, onUpdate }`, rendered inside the group it belongs to.
 *
 * The bounds are passed as literals here and asserted against the schema in
 * `parametrics.test.ts` — they used to match by inspection only, which is the
 * kind of agreement that holds until someone widens a schema range.
 */
type CustomField = { node: PalletRackNode; onUpdate: (patch: Partial<PalletRackNode>) => void }

export const PALLETS_PER_LEVEL_BOUNDS = { min: 1, max: 12 } as const
export const SUPPORT_BARS_BOUNDS = { min: 0, max: 3 } as const
export const BOXES_ACROSS_BOUNDS = { min: 1, max: 30 } as const
export const BOXES_DEEP_BOUNDS = { min: 1, max: 10 } as const

export function PalletsPerLevelField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPalletsPerLevel(node)}
      label="Pallets per level"
      max={PALLETS_PER_LEVEL_BOUNDS.max}
      min={PALLETS_PER_LEVEL_BOUNDS.min}
      onChange={(palletsPerLevel) => onUpdate({ palletsPerLevel })}
      value={node.palletsPerLevel}
    />
  )
}

export function PalletSupportBarsField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPalletSupportBars(node)}
      label="Pallet support bars"
      max={SUPPORT_BARS_BOUNDS.max}
      min={SUPPORT_BARS_BOUNDS.min}
      onChange={(palletSupportBars) => onUpdate({ palletSupportBars })}
      value={node.palletSupportBars}
    />
  )
}

export function PickingBoxesAcrossField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPickingBoxesAcross(node)}
      label="Boxes across"
      max={BOXES_ACROSS_BOUNDS.max}
      min={BOXES_ACROSS_BOUNDS.min}
      onChange={(pickingBoxesAcross) => onUpdate({ pickingBoxesAcross })}
      value={node.pickingBoxesAcross}
    />
  )
}

export function PickingBoxesDeepField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPickingBoxesDeep(node)}
      label="Boxes deep"
      max={BOXES_DEEP_BOUNDS.max}
      min={BOXES_DEEP_BOUNDS.min}
      onChange={(pickingBoxesDeep) => onUpdate({ pickingBoxesDeep })}
      value={node.pickingBoxesDeep}
    />
  )
}
