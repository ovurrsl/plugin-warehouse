'use client'

import { Icon } from '@iconify/react'
import { SegmentedControl } from '@pascal-app/editor'
import type { CSSProperties } from 'react'
import { type RackBrush, useWarehouseStore } from '../store'
import { PalletRackNode } from './schema'
import { palletSlotCount, totalDepth, totalWidth } from './slots'

/**
 * Block layout, while the rack tool is armed.
 *
 * The three figures that decide what a block *is* — how long, how deep, and
 * which way it grows from the point you click — read badly as three numbers in a
 * list, because they are the ones you set while looking at the room rather than
 * at the inspector. So they get a card over the canvas, next to what they
 * describe, showing the footprint and the pallet count they add up to.
 *
 * Styled from the same CSS variables and the same shape the host's own canvas
 * chrome uses (`contextual-helper-panel`: rounded-lg, `border-border`,
 * `bg-background/95`, `shadow-lg`, `backdrop-blur-md`) — as inline styles rather
 * than utility classes, because Tailwind's scanner does not follow the symlink a
 * git-installed package lands as, and classes written here would silently never
 * be compiled. Host components are composed wherever one exists; their classes
 * come from the host's own stylesheet and work anywhere in the document.
 */

const FG = 'var(--foreground)'
const MUTED = 'var(--muted-foreground)'
const BORDER = 'var(--border)'

const styles = {
  card: {
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
    marginBottom: '1.25rem',
    width: '19rem',
    borderRadius: '0.5rem',
    border: `1px solid ${BORDER}`,
    backgroundColor: 'color-mix(in oklab, var(--background) 95%, transparent)',
    padding: '0.75rem',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    backdropFilter: 'blur(12px)',
    color: FG,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  heading: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    color: MUTED,
  },
  summary: {
    fontSize: '0.6875rem',
    fontVariantNumeric: 'tabular-nums',
    color: MUTED,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3125rem',
  },
  label: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    fontSize: '0.6875rem',
    color: MUTED,
  },
  stepper: {
    display: 'flex',
    alignItems: 'center',
    height: '2.25rem',
    borderRadius: '0.5rem',
    border: `1px solid color-mix(in oklab, ${BORDER} 50%, transparent)`,
    backgroundColor: '#2C2C2E',
    padding: '3px',
  },
  stepValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: '0.8125rem',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    color: FG,
  },
} satisfies Record<string, CSSProperties>

function stepButton(disabled: boolean): CSSProperties {
  return {
    display: 'flex',
    height: '100%',
    width: '1.75rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.375rem',
    color: disabled ? `color-mix(in oklab, ${MUTED} 40%, transparent)` : MUTED,
    cursor: disabled ? 'default' : 'pointer',
  }
}

function Stepper({
  hint,
  label,
  max,
  min,
  onChange,
  value,
}: {
  hint?: string
  label: string
  max: number
  min: number
  onChange: (next: number) => void
  value: number
}) {
  return (
    <div style={styles.field}>
      <span style={styles.label}>
        <span>{label}</span>
        {hint ? <span style={{ opacity: 0.7 }}>{hint}</span> : null}
      </span>
      <div style={styles.stepper}>
        <button
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          style={stepButton(value <= min)}
          type="button"
        >
          <Icon height={14} icon="lucide:minus" width={14} />
        </button>
        <span style={styles.stepValue}>{value}</span>
        <button
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          style={stepButton(value >= max)}
          type="button"
        >
          <Icon height={14} icon="lucide:plus" width={14} />
        </button>
      </div>
    </div>
  )
}

/** Metres to the nearest centimetre — a block is read at room scale, and the
 *  extra digits only make the two figures harder to compare. */
function metres(value: number): string {
  return `${value.toFixed(2)} m`
}

export default function RackLayoutPopover() {
  const brush = useWarehouseStore((s) => s.rackBrush)
  const setRackBrush = useWarehouseStore((s) => s.setRackBrush)

  // Parsed through the schema so the readout is the real node's figures rather
  // than a second calculation over the brush's partial shape.
  const preview = PalletRackNode.parse({ ...brush, position: [0, 0, 0], rotation: [0, 0, 0] })
  const set = (patch: Partial<RackBrush>) => setRackBrush(patch)

  // A back-to-back pair has no aisle inside it, so the control only appears once
  // the block actually opens one.
  const usesAisle = preview.rowCount > (preview.rowPattern === 'back-to-back' ? 2 : 1)

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <span style={styles.heading}>
          <Icon height={13} icon="lucide:rows-3" width={13} />
          Block layout
        </span>
        <span style={styles.summary}>
          {metres(totalWidth(preview))} × {metres(totalDepth(preview))} ·{' '}
          {palletSlotCount(preview).toLocaleString()} pallets
        </span>
      </div>

      <Stepper
        hint="[ / ]"
        label="Bays"
        max={40}
        min={1}
        onChange={(bayCount) => set({ bayCount })}
        value={brush.bayCount}
      />

      <Stepper
        label="Rows"
        max={20}
        min={1}
        onChange={(rowCount) => set({ rowCount })}
        value={brush.rowCount}
      />

      {preview.rowCount > 1 ? (
        <div style={styles.field}>
          <span style={styles.label}>
            <span>Row pattern</span>
            <span style={{ opacity: 0.7 }}>
              {usesAisle ? metres(preview.aisleWidth) : 'no aisle'}
            </span>
          </span>
          <SegmentedControl
            onChange={(rowPattern: RackBrush['rowPattern']) => set({ rowPattern })}
            options={[
              { label: 'Back to back', value: 'back-to-back' },
              { label: 'Own aisle', value: 'aisle' },
            ]}
            value={brush.rowPattern}
          />
        </div>
      ) : null}

      <div style={styles.field}>
        <span style={styles.label}>
          <span>Grows from</span>
          <span style={{ opacity: 0.7 }}>along the run</span>
        </span>
        <SegmentedControl
          onChange={(bayAnchor: RackBrush['bayAnchor']) => set({ bayAnchor })}
          options={[
            { label: 'Left end', value: 'left' },
            { label: 'Centre', value: 'center' },
            { label: 'Right end', value: 'right' },
          ]}
          value={brush.bayAnchor}
        />
      </div>

      <div style={styles.field}>
        <span style={styles.label}>
          <span>Grows from</span>
          <span style={{ opacity: 0.7 }}>into the depth</span>
        </span>
        <SegmentedControl
          onChange={(rowAnchor: RackBrush['rowAnchor']) => set({ rowAnchor })}
          options={[
            { label: 'Front', value: 'front' },
            { label: 'Centre', value: 'center' },
            { label: 'Back', value: 'back' },
          ]}
          value={brush.rowAnchor}
        />
      </div>
    </div>
  )
}
