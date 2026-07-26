'use client'

import { Icon } from '@iconify/react'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type CSSProperties, useState } from 'react'
import { CAR } from './catalog'
import {
  frameWidthM,
  maxThroughputPerHour,
  moduleLengthM,
  ratedLoadKg,
  rollerPitchM,
  speedMPerSec,
  supportOffsetsX,
} from './metrics'
import { conveyorRollerParametrics } from './parametrics'
import type { ConveyorRollerNode } from './schema'

/**
 * What the module is, and how long you want it.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields
 * rather than instead of them.
 *
 * Two jobs. It renders the descriptor's **invariants**, which nothing else
 * does — the host declares `parametrics.invariants` in its registry types and
 * reads it nowhere, so a kind's own warnings are computed and dropped unless it
 * draws them itself. And it offers **length in metres**, because that is how a
 * person specifies a conveyor, while the node stores a roller count — which is
 * what a bed physically is and what keeps a metres slider from minting a
 * geometry at every step it passes through.
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
  stepper: { display: 'flex', alignItems: 'stretch', gap: '0.25rem' },
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
  readout: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    paddingBottom: '0.75rem',
    borderBottom: `1px solid ${BORDER}`,
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
 * The module this panel is editing.
 *
 * `ParametricDescriptor.trailingSection` is typed `ComponentType<{ node: N }>`
 * but the host renders `<TrailingSection />` with no props at all, so a declared
 * `node` arrives `undefined` and the first property read throws. The node is
 * read the way the inspector itself reads it: whatever is selected. The prop is
 * still preferred when a host does pass one, which costs nothing and means this
 * keeps working if the contract is repaired.
 */
function useInspectedConveyor(provided?: ConveyorRollerNode): ConveyorRollerNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-roller') return null
  return selected as unknown as ConveyorRollerNode
}

export default function ConveyorPanel({ node: provided }: { node?: ConveyorRollerNode }) {
  const node = useInspectedConveyor(provided)
  const [draft, setDraft] = useState<string | null>(null)

  if (!node) return null

  const issues = conveyorRollerParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const length = moduleLengthM(node)
  const pitch = rollerPitchM(node)

  /**
   * Metres in, rollers out.
   *
   * Rounded to whole rollers rather than clamped to a metre step, so asking for
   * 6 m at a 75 mm pitch gives exactly 6.000 m and asking for 6.1 m gives
   * 6.075 — the nearest length the bed can actually be. The panel then shows
   * what it settled on, so the rounding is visible rather than silent.
   */
  const setLength = (metres: number) => {
    const rollers = Math.max(27, Math.min(200, Math.round(metres / pitch)))
    useScene.getState().updateNode(node.id as AnyNodeId, { rollers } as unknown as Partial<AnyNode>)
  }

  const type = (text: string) => {
    setDraft(text)
    if (text.trim() === '') return
    const parsed = Number(text)
    if (Number.isFinite(parsed) && parsed > 0) setLength(parsed)
  }

  return (
    <div style={styles.root}>
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

      <div style={styles.readout}>
        <span style={styles.title}>
          <Icon height={13} icon="lucide:gauge" width={13} />
          This module
        </span>
        {(
          [
            ['Bed', `${length.toFixed(3)} m · ${node.rollers} rollers @ ${node.rollerPitch} mm`],
            [
              'Frame',
              `${(frameWidthM(node) * 1000).toFixed(0)} mm over a ${node.usefulWidth} mm lane`,
            ],
            ['Supports', `${supportOffsetsX(node).length} stations`],
            ['Speed', `${node.speed} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
            [
              'Throughput',
              `≤ ${maxThroughputPerHour(node).toLocaleString()} boxes/h at ${(node.shortestBox * 1000).toFixed(0)} mm`,
            ],
            [
              'Rated load',
              `${CAR.loadKgPerMetre} kg/m · ${ratedLoadKg(node).toFixed(0)} kg on this bed`,
            ],
          ] as Array<[string, string]>
        ).map(([label, value]) => (
          <div key={label} style={styles.label}>
            <span>{label}</span>
            <span style={{ color: FG, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={styles.field}>
        <span style={styles.label}>
          <span>Length</span>
          <span style={{ opacity: 0.7 }}>steps of {node.rollerPitch} mm</span>
        </span>
        {/* Metres, because that is how a conveyor is specified — but the node
            stores a roller count, so the box is a request rather than a value.
            Committing live and never reading an empty box as zero: the rack's
            stepper shipped both failures, one after the other. */}
        <div style={styles.stepper}>
          <button onClick={() => setLength(length - pitch)} style={styles.step} type="button">
            −
          </button>
          <input
            inputMode="decimal"
            onBlur={() => setDraft(null)}
            onChange={(event) => type(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') setDraft(null)
            }}
            step={pitch}
            style={styles.input}
            type="number"
            value={draft ?? length.toFixed(3)}
          />
          <button onClick={() => setLength(length + pitch)} style={styles.step} type="button">
            +
          </button>
        </div>
      </div>

      <p style={styles.hint}>
        Each module is its own object, so you can select, move, copy or delete any of them on their
        own. Place a run with <strong>[</strong> and <strong>]</strong> while the tool is armed.
      </p>
    </div>
  )
}
