'use client'

import { Icon } from '@iconify/react'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { SegmentedControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { type CSSProperties, useState } from 'react'
import { useWarehouseStore } from '../store'
import { runExtent } from './multiply'
import { multiplyRack, pendingPlacements } from './multiply-command'
import { occupiedSlots } from './occupancy'
import { palletRackParametrics } from './parametrics'
import type { PalletRackNode } from './schema'
import { directAccessSlotCount, fittedLevelCount, palletSlotCount, pickingSlotCount } from './slots'

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
  danger: {
    borderRadius: '0.5rem',
    border: '1px solid color-mix(in oklab, #f59e0b 55%, transparent)',
    background: 'color-mix(in oklab, #f59e0b 16%, transparent)',
    padding: '0.4375rem 0.625rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    color: FG,
    cursor: 'pointer',
    textAlign: 'center',
  },
  issues: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    borderRadius: '0.5rem',
    border: '1px solid color-mix(in oklab, #f59e0b 40%, transparent)',
    background: 'color-mix(in oklab, #f59e0b 10%, transparent)',
    padding: '0.5rem 0.625rem',
  },
  issue: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.375rem',
    margin: 0,
    fontSize: '0.6875rem',
    lineHeight: 1.5,
    color: FG,
  },
  capacity: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    paddingBottom: '0.75rem',
    borderBottom: `1px solid ${BORDER}`,
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

  /**
   * The text while it is being typed, or null when the field simply shows the
   * value.
   *
   * Two failures, opposite to each other, and the field has to avoid both.
   *
   * A controlled `<input type="number">` that clamps on every keystroke cannot
   * be emptied: `Number('')` is `0`, which passes a finite check and clamps to
   * the minimum, so selecting all and pressing Delete — the ordinary way to
   * clear a field before typing a new number — snapped the box to 1 mid-edit
   * and left the caret after it. Typing "20" then gave 120.
   *
   * Committing only on blur is worse, and it is what shipped. At one bay there
   * is nothing to place, so the button is inert; typing 20 changed no state, the
   * button stayed inert, and pressing it only blurred the box. The count arrived
   * one click too late and Multiply read as simply broken.
   *
   * So: commit live, but never read an empty box as a number. The draft carries
   * what was typed, so the field can show nothing while the store keeps the last
   * real value, and blur puts the two back in step.
   */
  const [draft, setDraft] = useState<string | null>(null)

  const type = (text: string) => {
    setDraft(text)
    if (text.trim() === '') return
    const parsed = Number(text)
    if (Number.isFinite(parsed)) clamp(parsed)
  }

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
          onBlur={() => setDraft(null)}
          onChange={(event) => type(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') setDraft(null)
          }}
          step={1}
          style={styles.input}
          type="number"
          value={draft ?? String(value)}
        />
        <button onClick={() => clamp(value + 1)} style={styles.step} type="button">
          +
        </button>
      </div>
    </div>
  )
}

/**
 * How many nodes one press may create before it has to be asked twice.
 *
 * The pivot budgeted a 15,000 m² warehouse at about two thousand bays, and the
 * two axes multiply: Bays 200 × Rows 50 is 10,000 nodes on one click, five times
 * the whole building. Not forbidden — someone may genuinely want it — but not
 * something to do by accident either, and the number is worth reading twice.
 */
const CONFIRM_ABOVE = 500

export default function RackPanel({ node: provided }: { node?: PalletRackNode }) {
  const spec = useWarehouseStore((s) => s.multiply)
  const setMultiply = useWarehouseStore((s) => s.setMultiply)
  const node = useInspectedRack(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)
  const [confirming, setConfirming] = useState(false)

  // The inspector is open for something that is not a rack — or for nothing.
  if (!node) return null

  // What pressing the button will actually create, not what the spec describes.
  // Bays that already stand where the spec would put one are filtered out, so
  // pressing Multiply on a run that already exists is a no-op rather than a
  // second run stacked invisibly inside the first.
  const pending = pendingPlacements(node, spec, nodes).length
  const extent = runExtent(node, spec)
  const issues = palletRackParametrics.invariants?.flatMap((check) => check(node)) ?? []

  const commit = () => {
    if (pending > CONFIRM_ABOVE && !confirming) {
      setConfirming(true)
      return
    }
    multiplyRack(node, spec)
    setConfirming(false)
  }

  return (
    <div style={styles.root}>
      {/* The descriptor's invariants, which nothing else renders. The host
          declares `parametrics.invariants` in its types and has no consumer for
          it, so five warnings a rack computes about itself — levels that do not
          fit, pallets with nothing under them, a tunnel that empties the bay —
          were being produced and dropped on the floor. */}
      {issues.length > 0 && (
        <div style={styles.issues}>
          {issues.map((issue) => (
            <p key={`${issue.field ?? ''}:${issue.msg}`} style={styles.issue}>
              <Icon
                height={12}
                icon={issue.severity === 'error' ? 'lucide:octagon-alert' : 'lucide:triangle-alert'}
                style={{ flexShrink: 0, marginTop: '0.125rem' }}
                width={12}
              />
              <span>{issue.msg}</span>
            </p>
          ))}
        </div>
      )}

      <Capacity node={node} nodes={nodes} />

      <span style={styles.title}>
        <Icon height={13} icon="lucide:copy-plus" width={13} />
        Multiply
      </span>

      <Stepper
        label="Bays"
        max={200}
        min={1}
        onChange={(bays) => {
          setMultiply({ bays })
          setConfirming(false)
        }}
        suffix={`${extent.width.toFixed(2)} m`}
        value={spec.bays}
      />

      <Stepper
        label="Rows"
        max={50}
        min={1}
        onChange={(rows) => {
          setMultiply({ rows })
          setConfirming(false)
        }}
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

          {spec.backToBack ? (
            <div style={styles.field}>
              <span style={styles.label}>
                <span>Spine gap</span>
                <span style={{ opacity: 0.7 }}>{(spec.backToBackGap * 1000).toFixed(0)} mm</span>
              </span>
              {/* It had no control at all, while still setting the depth the
                  panel reports and the box the tool collides — an invisible
                  constant governing every back-to-back layout. */}
              <SegmentedControl
                onChange={(value: string) => setMultiply({ backToBackGap: Number(value) })}
                options={[
                  { label: '100', value: '0.1' },
                  { label: '200', value: '0.2' },
                  { label: '300', value: '0.3' },
                ]}
                value={String(spec.backToBackGap)}
              />
            </div>
          ) : null}

          <div style={styles.field}>
            <span style={styles.label}>
              <span>Aisle</span>
              <span style={{ opacity: 0.7 }}>{spec.aisleWidth.toFixed(2)} m</span>
            </span>
            {/* The figure that decides how much of a building is racking: a
                turret truck turns in 1.8 m, a reach truck works 3.2, and a
                counterbalanced forklift wants 3.5. */}
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

      {/* Always a button, in the same place, whether or not there is anything to
          place. Swapping it for a div meant the control the user was reaching
          for moved out from under the cursor as they typed — and the click that
          would have grown the run went to a dead element instead. */}
      <button
        disabled={pending === 0}
        onClick={commit}
        style={pending === 0 ? styles.disabled : confirming ? styles.danger : styles.primary}
        type="button"
      >
        {pending === 0
          ? 'Nothing to place — the run is already here'
          : confirming
            ? `Confirm ${pending.toLocaleString()} bays — ${(pending + 1).toLocaleString()} draw calls`
            : `Place ${pending.toLocaleString()} more ${pending === 1 ? 'bay' : 'bays'}`}
      </button>

      <p style={styles.hint}>
        Each bay is placed as its own object carrying this one's settings, so you can select, move,
        copy or delete any of them on their own. Bays standing together share a post — pull one
        clear and it grows its own.
      </p>
    </div>
  )
}

/**
 * What the bay actually holds.
 *
 * `levelCapacity` was editable, persisted, and read by nothing at all — its own
 * schema comment promised a capacity panel that does not exist. So were
 * `directAccessSlotCount` and `pickingSlotCount`, both defined and never called.
 * They are the numbers a rack is specified *for*, and this is the one place they
 * are being edited.
 *
 * Direct access is called out separately because it is the figure a headline
 * "positions" number hides: on a double-deep bay half the positions cannot be
 * reached until the pallet in front of them is moved.
 */
function Capacity({ node, nodes }: { node: PalletRackNode; nodes: Record<string, unknown> }) {
  const positions = palletSlotCount(node)
  const direct = directAccessSlotCount(node)
  const picking = pickingSlotCount(node)
  const occupied = occupiedSlots(nodes, node.id).size
  const levels = fittedLevelCount(node)
  const load = levels * node.levelCapacity

  const rows: Array<[string, string]> = [
    ['Pallet positions', positions === direct ? `${positions}` : `${positions} · ${direct} direct`],
    ...(picking > 0 ? [['Container positions', `${picking}`] as [string, string]] : []),
    ['Occupied', `${occupied}`],
    [
      'Rated load',
      `${node.levelCapacity.toLocaleString()} kg/level · ${(load / 1000).toFixed(1)} t`,
    ],
  ]

  return (
    <div style={styles.capacity}>
      <span style={styles.title}>
        <Icon height={13} icon="lucide:scale" width={13} />
        This bay
      </span>
      {rows.map(([label, value]) => (
        <div key={label} style={styles.label}>
          <span>{label}</span>
          <span style={{ color: FG, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
      ))}
    </div>
  )
}
