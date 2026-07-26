'use client'

import { Icon } from '@iconify/react'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { LNC } from './catalog'
import { describeLine } from './conveyor-panel'
import {
  frameWidthM,
  lateralOuterZM,
  maxThroughputPerHour,
  moduleLengthM,
  rollerCount,
  rollerPitchMm,
  speedMPerSec,
  usefulWidthMm,
} from './launcher-metrics'
import { conveyorLauncherParametrics } from './launcher-parametrics'
import type { ConveyorLauncherNode } from './launcher-schema'
import { jointProblems } from './port-magnet'

/**
 * What the machine is, and the two things about it that are not settings.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields rather
 * than instead of them.
 *
 * It renders the descriptor's **invariants**, which nothing else does — the host
 * declares `parametrics.invariants` in its registry types and reads it nowhere.
 * And it states the figures the schema deliberately does not carry: the single
 * speed this type is built at, the fixed box it is dimensioned around, and the
 * 50 kg it lifts. Those are properties of the machine rather than choices, so
 * they belong in a readout rather than in a control that cannot be used.
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
function useInspectedLauncher(provided?: ConveyorLauncherNode): ConveyorLauncherNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-launcher') {
    return null
  }
  return selected as unknown as ConveyorLauncherNode
}

export default function ConveyorLauncherPanel({ node: provided }: { node?: ConveyorLauncherNode }) {
  const node = useInspectedLauncher(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  const issues = [
    ...(conveyorLauncherParametrics.invariants?.flatMap((check) => check(node)) ?? []),
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
          This launcher
        </span>
        {(
          [
            [
              'Body',
              `${(moduleLengthM(node) * 1000).toFixed(0)} mm fixed · ${rollerCount(node)} rollers @ ${rollerPitchMm(node)} mm`,
            ],
            [
              'Frame',
              `${(frameWidthM(node) * 1000).toFixed(0)} mm over a ${usefulWidthMm(node)} mm lane`,
            ],
            [
              'Launch',
              `${node.launchSide} · reaches ${(lateralOuterZM(node) * 1000).toFixed(0)} mm from the centreline`,
            ],
            // Not a field: the type is built at one speed and around one box.
            ['Speed', `${LNC.speedMPerMin} m/min · ${speedMPerSec(node).toFixed(2)} m/s — fixed`],
            [
              'Box',
              `${(LNC.boxLengthM * 1000).toFixed(0)} mm, ≤ ${LNC.loadKg} kg — both fixed by the type`,
            ],
            ['Throughput', `≤ ${maxThroughputPerHour(node).toLocaleString()} boxes/h`],
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
        A box leaves this machine facing ninety degrees from how it arrived — which is what
        separates it from a bend, and means the next section's box-length limits no longer follow
        from the last one's. Drag it within half a metre of a free end and it clicks on: head to
        tail, matching lane, matching height.
      </p>
    </div>
  )
}
