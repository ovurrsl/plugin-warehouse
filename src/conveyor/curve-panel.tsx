'use client'

import { Icon } from '@iconify/react'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { describeLine } from './conveyor-panel'
import {
  angleDeg,
  centrelineLengthM,
  frameWidthM,
  laneWidthM,
  longestBoxThroughBendM,
  outerRadiusM,
  rollerCount,
  speedMPerMin,
  speedMPerSec,
  supportAngles,
  usefulWidthMm,
} from './curve-metrics'
import { conveyorCurveParametrics } from './curve-parametrics'
import type { ConveyorCurveNode } from './curve-schema'
import { jointProblems } from './port-magnet'

/**
 * What the bend is, and the one number nobody else can tell you.
 *
 * Mounted as `parametrics.trailingSection`, under the bend's own fields rather
 * than instead of them.
 *
 * Two jobs, the same two the straight's panel has. It renders the descriptor's
 * **invariants**, which nothing else does — the host declares
 * `parametrics.invariants` in its registry types and reads it nowhere, so a
 * kind's own warnings are computed and dropped unless it draws them itself. And
 * it reports **the longest box that gets round**, which is a property of the
 * radius rather than of the drive and is the figure that decides whether a line
 * carrying long cartons can turn this corner at all. Said before the bend is
 * drawn rather than after it is built.
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
 * The bend this panel is editing.
 *
 * `ParametricDescriptor.trailingSection` is typed `ComponentType<{ node: N }>`
 * but the host renders `<TrailingSection />` with no props at all, so a declared
 * `node` arrives `undefined` and the first property read throws. The node is
 * read the way the inspector itself reads it: whatever is selected.
 */
function useInspectedCurve(provided?: ConveyorCurveNode): ConveyorCurveNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-curve') return null
  return selected as unknown as ConveyorCurveNode
}

export default function ConveyorCurvePanel({ node: provided }: { node?: ConveyorCurveNode }) {
  const node = useInspectedCurve(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  // The descriptor's own warnings, plus the ones that only exist once a bend has
  // a neighbour — a joint is between two nodes, so no single node's invariants
  // can see it.
  const issues = [
    ...(conveyorCurveParametrics.invariants?.flatMap((check) => check(node)) ?? []),
    ...jointProblems(node, nodes).map((msg) => ({ field: undefined, severity: 'warning', msg })),
  ]

  const lane = laneWidthM(node)
  const longest = longestBoxThroughBendM(node)

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
          This bend
        </span>
        {(
          [
            ['Arc', `${angleDeg(node)}° ${node.handed} · ${centrelineLengthM(node).toFixed(2)} m`],
            [
              'Radius',
              `${(node.innerRadius * 1000).toFixed(0)} mm inner · ${(outerRadiusM(node) * 1000).toFixed(0)} mm outer`,
            ],
            [
              'Frame',
              `${(frameWidthM(node) * 1000).toFixed(0)} mm over a ${usefulWidthMm(node)} mm lane`,
            ],
            ['Rollers', `${rollerCount(node)} tapered · ${supportAngles(node).length} supports`],
            ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
            // The figure a bend exists to be checked against, and the one a
            // straight has no equivalent of.
            [
              'Longest box',
              `${(longest * 1000).toFixed(0)} mm at full ${(lane * 1000).toFixed(0)} mm width`,
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
        A bend preserves a box's orientation, so what leaves it faces the way it entered — which is
        what separates it from a transfer, and why the next section's box-length limits still apply.
        Drag it within half a metre of a free end and it clicks on: head to tail, matching lane,
        matching height. Drag a joined module and the whole line comes with it.
      </p>
    </div>
  )
}
