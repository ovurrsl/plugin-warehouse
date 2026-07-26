'use client'

import { Icon } from '@iconify/react'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { OBQ } from './catalog'
import { describeLine } from './conveyor-panel'
import {
  angleDeg,
  branchBoxWidthM,
  branchLengthM,
  divergeXM,
  mainLaneMm,
  mainWidthM,
  moduleLengthM,
  rollerPitchMm,
  speedMPerMin,
  speedMPerSec,
} from './oblique-metrics'
import { conveyorObliqueParametrics } from './oblique-parametrics'
import type { ConveyorObliqueNode } from './oblique-schema'
import { jointProblems } from './port-magnet'

/**
 * What the machine is, and where its branch actually leaves.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields rather
 * than instead of them.
 *
 * It renders the descriptor's **invariants**, which nothing else does — the host
 * declares `parametrics.invariants` in its registry types and reads it nowhere.
 * And it reports the **divergence point**, which is derived rather than chosen:
 * the body is a fixed 1500 mm and the branch has to be clear of the main frame
 * by its end, so a shallower angle pushes the split earlier. At 30° it is before
 * the middle and at 45° well after it, and nothing else on screen says so.
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
 * The branch this panel is editing.
 *
 * `ParametricDescriptor.trailingSection` is typed `ComponentType<{ node: N }>`
 * but the host renders `<TrailingSection />` with no props at all, so a declared
 * `node` arrives `undefined` and the first property read throws. The node is
 * read the way the inspector itself reads it: whatever is selected.
 */
function useInspectedOblique(provided?: ConveyorObliqueNode): ConveyorObliqueNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-oblique') {
    return null
  }
  return selected as unknown as ConveyorObliqueNode
}

export default function ConveyorObliquePanel({ node: provided }: { node?: ConveyorObliqueNode }) {
  const node = useInspectedOblique(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  const issues = [
    ...(conveyorObliqueParametrics.invariants?.flatMap((check) => check(node)) ?? []),
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
          This branch
        </span>
        {(
          [
            [
              'Body',
              `${(moduleLengthM(node) * 1000).toFixed(0)} mm fixed · rollers @ ${rollerPitchMm(node)} mm`,
            ],
            // The two lanes, side by side, because the narrower one is what a
            // box crossing this module actually has to fit.
            [
              'Lanes',
              `${mainLaneMm(node)} mm main · ${(branchBoxWidthM(node) * 1000).toFixed(0)} mm branch`,
            ],
            [
              'Branch',
              `${angleDeg(node)}° ${node.branchSide} · ${node.branchMode} · ${(branchLengthM(node) * 1000).toFixed(0)} mm of bed`,
            ],
            // Derived, and nothing else on screen says it.
            [
              'Splits at',
              `${(divergeXM(node) * 1000).toFixed(0)} mm from the middle — set by the angle`,
            ],
            ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
            [
              'Rated',
              `≤ ${OBQ.loadKg} kg per box · ${(mainWidthM(node) * 1000).toFixed(0)} mm main frame`,
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
        Unlike a launcher or a mixed transfer, this one does <strong>not</strong> turn the box — a
        branch changes which line it is on, not how it faces, so the next section's box-length
        limits still follow from the last one's. The branch port accepts a joint in either direction
        unless the mode narrows it.
      </p>

      {node.branchMode !== 'merge' && (
        <p style={styles.hint}>
          A divert branch needs a decision behind it — a barcode read that chooses which way the box
          goes. There is no node for one in this package yet, so the plan symbol marks where it has
          to sit rather than leaving the gap silent.
        </p>
      )}
    </div>
  )
}
