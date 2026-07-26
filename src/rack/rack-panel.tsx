'use client'

import { Icon } from '@iconify/react'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { SegmentedControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { useWarehouseStore } from '../store'
import RackAutoFields from './auto-fields'
import { multiplyPlacements, runExtent } from './multiply'
import { multiplyRack } from './multiply-command'
import type { PalletRackNode } from './schema'
import { palletSlotCount } from './slots'

/**
 * Turning one bay into a run.
 *
 * Mounted as `parametrics.trailingSection`, so it sits under the bay's own
 * fields in the host inspector rather than replacing them — `customPanel` would
 * short-circuit the auto-derived groups, the actions and the Move/Delete buttons
 * along with them.
 *
 * The panel this replaces edited *bays inside a block*: a bay had to be clicked
 * into focus, and skipping, tunnelling or re-decking one wrote an override keyed
 * by index. All of it is gone, because a bay is a node now. Configuring one is
 * the ordinary inspector above; deleting, moving, copying and multi-selecting
 * one is the host's own machinery. What is left is the single thing the host
 * cannot do: place the *rest* of the run by coordinate.
 */

const FG = 'var(--foreground)'
const MUTED = 'var(--muted-foreground)'
const BORDER = 'var(--border)'

const styles = {
  root: { display: 'flex', flexDirection: 'column', gap: '0.625rem', color: FG },
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
  stepper: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '0.25rem',
  },
  step: {
    width: '1.75rem',
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER}`,
    background: 'transparent',
    color: FG,
    fontSize: '0.8125rem',
    lineHeight: 1,
    cursor: 'pointer',
  },
  input: {
    flex: 1,
    minWidth: 0,
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER}`,
    background: 'transparent',
    padding: '0.3125rem 0.5rem',
    fontSize: '0.75rem',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
    color: FG,
  },
  primary: {
    borderRadius: '0.5rem',
    border: '1px solid color-mix(in oklab, var(--primary, #38bdf8) 45%, transparent)',
    background: 'color-mix(in oklab, var(--primary, #38bdf8) 16%, transparent)',
    padding: '0.4375rem 0.625rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    color: FG,
    cursor: 'pointer',
    textAlign: 'center',
  },
  disabled: {
    borderRadius: '0.5rem',
    border: `1px solid ${BORDER}`,
    background: 'transparent',
    padding: '0.4375rem 0.625rem',
    fontSize: '0.75rem',
    color: MUTED,
    cursor: 'default',
    textAlign: 'center',
  },
  hint: {
    margin: 0,
    borderRadius: '0.5rem',
    border: `1px dashed ${BORDER}`,
    padding: '0.5rem 0.625rem',
    fontSize: '0.6875rem',
    lineHeight: 1.5,
    color: MUTED,
  },
} satisfies Record<string, CSSProperties>

/**
 * The rack this panel is editing.
 *
 * `ParametricDescriptor.trailingSection` is typed `ComponentType<{ node: N }>`,
 * but `parametric-inspector.tsx` renders `<TrailingSection />` with no props at
 * all — so the declared `node` arrives `undefined` and the first property read
 * throws. The type is the thing that is wrong, not the call site's intent, and
 * a plugin cannot patch the host.
 *
 * So the node is read the way the inspector itself reads it: whatever is
 * selected. The prop is still preferred when a host does pass one, which costs
 * nothing and means this keeps working if the contract is repaired.
 */
function useInspectedRack(provided?: PalletRackNode): PalletRackNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:pallet-rack') return null
  return selected as unknown as PalletRackNode
}

function Stepper({
  label,
  max,
  min,
  onChange,
  suffix,
  value,
}: {
  label: string
  max: number
  min: number
  onChange: (next: number) => void
  suffix?: string
  value: number
}) {
  const clamp = (next: number) => onChange(Math.max(min, Math.min(max, Math.round(next))))
  return (
    <div style={styles.field}>
      <span style={styles.label}>
        <span>{label}</span>
        {suffix ? <span style={{ opacity: 0.7 }}>{suffix}</span> : null}
      </span>
      <div style={styles.stepper}>
        <button onClick={() => clamp(value - 1)} style={styles.step} type="button">
          −
        </button>
        <input
          inputMode="numeric"
          max={max}
          min={min}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) clamp(next)
          }}
          step={1}
          style={styles.input}
          type="number"
          value={value}
        />
        <button onClick={() => clamp(value + 1)} style={styles.step} type="button">
          +
        </button>
      </div>
    </div>
  )
}

export default function RackPanel({ node: provided }: { node?: PalletRackNode }) {
  const spec = useWarehouseStore((s) => s.multiply)
  const setMultiply = useWarehouseStore((s) => s.setMultiply)
  const node = useInspectedRack(provided)

  // The inspector is open for something that is not a rack — or for nothing.
  if (!node) return null

  const pending = multiplyPlacements(node, spec).length
  const extent = runExtent(node, spec)
  const slots = palletSlotCount(node) * spec.bays * spec.rows

  return (
    <div style={styles.root}>
      <span style={styles.title}>
        <Icon height={13} icon="lucide:copy-plus" width={13} />
        Multiply
      </span>

      <Stepper
        label="Bays"
        max={200}
        min={1}
        onChange={(bays) => setMultiply({ bays })}
        suffix={`${extent.width.toFixed(2)} m`}
        value={spec.bays}
      />

      <Stepper
        label="Rows"
        max={50}
        min={1}
        onChange={(rows) => setMultiply({ rows })}
        suffix={spec.rows > 1 ? `${extent.depth.toFixed(2)} m deep` : undefined}
        value={spec.rows}
      />

      {spec.rows > 1 ? (
        <>
          <div style={styles.field}>
            <span style={styles.label}>
              <span>Back to back</span>
              <span style={{ opacity: 0.7 }}>
                {spec.backToBack ? 'rows pair up' : 'every row on its own aisle'}
              </span>
            </span>
            {/* A switch rather than a count. A run either has another run
                against its back or it does not — there is no "how many". */}
            <SegmentedControl
              onChange={(value: string) => setMultiply({ backToBack: value === 'on' })}
              options={[
                { label: 'Single', value: 'off' },
                { label: 'Back to back', value: 'on' },
              ]}
              value={spec.backToBack ? 'on' : 'off'}
            />
          </div>

          <div style={styles.field}>
            <span style={styles.label}>
              <span>Aisle</span>
              <span style={{ opacity: 0.7 }}>{spec.aisleWidth.toFixed(2)} m</span>
            </span>
            {/* The figure that decides how much of a building is racking: a
                reach truck works 3.2 m, a counterbalanced forklift wants 3.5,
                and a turret truck turns in 1.6. */}
            <SegmentedControl
              onChange={(value: string) => setMultiply({ aisleWidth: Number(value) })}
              options={[
                { label: 'VNA 1.8', value: '1.8' },
                { label: 'Reach 3.2', value: '3.2' },
                { label: 'Fork 3.5', value: '3.5' },
              ]}
              value={String(spec.aisleWidth)}
            />
          </div>
        </>
      ) : null}

      {pending > 0 ? (
        <button onClick={() => multiplyRack(node, spec)} style={styles.primary} type="button">
          Place {pending} more {pending === 1 ? 'bay' : 'bays'}
        </button>
      ) : (
        <div style={styles.disabled}>This bay is the whole run</div>
      )}

      <p style={styles.hint}>
        Each bay is placed as its own object carrying this one's settings, so you can select, move,
        copy or delete any of them on their own. Bays standing together share a post — pull one
        clear and it grows its own. {slots.toLocaleString()} pallet positions at this size.
      </p>

      <RackAutoFields />
    </div>
  )
}
