'use client'

import { Icon } from '@iconify/react'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import {
  frameWidthM,
  moduleLengthM,
  rollerPitchMm,
  rollersUnderShortestBox,
  speedMPerMin,
  speedMPerSec,
  supportOffsetsX,
  usefulWidthMm,
} from './booster-metrics'
import { conveyorBoosterParametrics } from './booster-parametrics'
import type { ConveyorBoosterNode } from './booster-schema'
import { BST } from './catalog'
import { describeLine } from './conveyor-panel'
import { jointProblems } from './port-magnet'

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
function useInspectedBooster(provided?: ConveyorBoosterNode): ConveyorBoosterNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-booster') {
    return null
  }
  return selected as unknown as ConveyorBoosterNode
}

export default function ConveyorBoosterPanel({ node: provided }: { node?: ConveyorBoosterNode }) {
  const node = useInspectedBooster(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  const issues = [
    ...(conveyorBoosterParametrics.invariants?.flatMap((check) => check(node)) ?? []),
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
          This booster
        </span>
        {(
          [
            [
              'Bed',
              `${(moduleLengthM(node) * 1000).toFixed(0)} mm · ${node.rollers} rollers @ ${rollerPitchMm(node)} mm`,
            ],
            [
              'Range',
              `${(BST.lengthRangeM[0] * 1000).toFixed(0)}–${(BST.lengthRangeM[1] * 1000).toFixed(0)} mm for this type`,
            ],
            [
              'Frame',
              `${(frameWidthM(node) * 1000).toFixed(0)} mm over a ${usefulWidthMm(node)} mm lane — 67 mm, the tightest in the family`,
            ],
            ['Supports', `${supportOffsetsX(node).length} stations`],
            ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
            [
              'Shortest box',
              `${(node.shortestBox * 1000).toFixed(0)} mm on ${rollersUnderShortestBox(node)} rollers · ≤ ${BST.loadKg} kg`,
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
        A booster regulates a load's passage rather than carrying it any distance — it sits where a
        cycle needs tightening, and its drive lives under the bed rather than beside it, which is
        why its frame is the tightest section in the family. Drag it within half a metre of a free
        end and it clicks on: head to tail, matching lane, matching height.
      </p>
    </div>
  )
}
