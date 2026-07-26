'use client'

import { Icon } from '@iconify/react'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { MTR } from './catalog'
import { describeLine } from './conveyor-panel'
import { jointProblems } from './port-magnet'
import {
  frameWidthM,
  laneMm,
  moduleLengthM,
  rollerOffsetsX,
  rollersUnderShortestBox,
  speedMPerMin,
  speedMPerSec,
  stripSpanM,
  widestRollerGapM,
} from './transfer-metrics'
import { conveyorTransferParametrics } from './transfer-parametrics'
import type { ConveyorTransferNode } from './transfer-schema'

/**
 * What the machine is, and where it sits in the range.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields rather
 * than instead of them.
 *
 * It renders the descriptor's **invariants**, which nothing else does — the host
 * declares `parametrics.invariants` in its registry types and reads it nowhere.
 * The readout leads with the bed length against the catalogue range, because
 * that is the figure a person is most likely to walk out of without noticing:
 * the roller count is a control and the range is a length.
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
  label: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    fontSize: '0.6875rem',
    color: MUTED,
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
 * The launcher this panel is editing.
 *
 * `ParametricDescriptor.trailingSection` is typed `ComponentType<{ node: N }>`
 * but the host renders `<TrailingSection />` with no props at all, so a declared
 * `node` arrives `undefined` and the first property read throws. The node is
 * read the way the inspector itself reads it: whatever is selected.
 */
function useInspectedTransfer(provided?: ConveyorTransferNode): ConveyorTransferNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-transfer') {
    return null
  }
  return selected as unknown as ConveyorTransferNode
}

export default function ConveyorTransferPanel({ node: provided }: { node?: ConveyorTransferNode }) {
  const node = useInspectedTransfer(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  const issues = [
    ...(conveyorTransferParametrics.invariants?.flatMap((check) => check(node)) ?? []),
    ...jointProblems(node, nodes).map((msg) => ({ field: undefined, severity: 'warning', msg })),
  ]

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
          This transfer
        </span>
        {(
          [
            [
              'Body',
              `${(moduleLengthM(node) * 1000).toFixed(0)} × ${(frameWidthM(node) * 1000).toFixed(0)} mm — fixed, both ways`,
            ],
            ['Ports', `${laneMm(node)} mm class on all three — the only one this type is built in`],
            [
              'Strips',
              `${node.travel} · ${(stripSpanM(node) * 1000).toFixed(0)} mm of travel, discharging ${node.dischargeSide}`,
            ],
            [
              'Rollers',
              `${rollerOffsetsX(node).length} in the gaps · widest gap ${(widestRollerGapM(node) * 1000).toFixed(0)} mm`,
            ],
            ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
            [
              'Shortest box',
              `${(node.shortestBox * 1000).toFixed(0)} mm on ${rollersUnderShortestBox(node)} rollers · ≤ ${MTR.loadKg} kg`,
            ],
            ['Line', describeLine(node, nodes)],
          ] as Array<[string, string]>
        ).map(([label, value]) => (
          <div key={label} style={styles.label}>
            <span>{label}</span>
            <span style={{ color: FG, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
          </div>
        ))}
      </div>

      <p style={styles.hint}>
        A box leaves this machine facing ninety degrees from how it arrived — the belt strips lift
        it off the roller line rather than turning it — so unlike a bend, the next section's
        box-length limits no longer follow from the last one's. Drag it within half a metre of a
        free end and it clicks on: head to tail, matching lane, matching height.
      </p>

      {/* Information rather than a defect, so it is a note and not a warning:
          every asymmetric build would otherwise be born yellow. */}
      {node.travel === 'asymmetric' && (
        <p style={styles.hint}>
          Asymmetric strips hand the box over short of the cross centreline, which is what a tight
          installation buys. Whatever receives it has to be set to meet the strips, not the middle
          of this body.
        </p>
      )}
    </div>
  )
}
