'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { IssueList } from '../panels/issue-list'
import { CONSTRUCTIVE_SYSTEMS } from './catalog'
import { resolveTierElevations, totalHeightM } from './metrics'
import { mezzanineParametrics } from './parametrics'
import type { MezzanineNode } from './schema'

/**
 * Mezzanine'in okuma paneli — çözülmüş tier kotları (`resolveTierElevations`
 * zincirinin sonucu), telescopic'in "hesaplananı göster" deseninin aynısı.
 * Düzenleme burada YAPILMAZ — `grid`/`tiers` `auto-fields.tsx`'in `custom`
 * alanlarında.
 */

const styles = {
  root: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--border)',
    padding: '0.5rem 0.625rem',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.5rem',
    fontSize: '0.6875rem',
    color: 'var(--foreground)',
  },
  figure: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
  note: { margin: 0, fontSize: '0.625rem', lineHeight: 1.45, color: 'var(--muted-foreground)' },
} satisfies Record<string, CSSProperties>

function useInspected(provided?: MezzanineNode): MezzanineNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:mezzanine') return null
  return selected as unknown as MezzanineNode
}

export default function MezzaninePanel({ node: provided }: { node?: MezzanineNode }) {
  const node = useInspected(provided)
  if (!node) return null

  const system = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem]
  const issues = mezzanineParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const resolved = resolveTierElevations(node.tiers)

  return (
    <div style={styles.root}>
      <IssueList issues={issues} />

      <div style={styles.card}>
        <div style={styles.row}>
          <span>Constructive system</span>
          <span style={styles.figure}>{system.label}</span>
        </div>
        <div style={styles.row}>
          <span>Tiers</span>
          <span style={styles.figure}>{node.tiers.length}</span>
        </div>
        <div style={styles.row}>
          <span>Total height</span>
          <span style={styles.figure}>{totalHeightM(node).toFixed(2)} m</span>
        </div>
        {resolved.map((tier) => (
          <div key={tier.index} style={styles.row}>
            <span>Tier {tier.index} elevation</span>
            <span style={styles.figure}>{tier.resolvedElevationM.toFixed(2)} m</span>
          </div>
        ))}
        <p style={styles.note}>
          Kaynak: Mecalux MK-049439-11/23 + EN 10365 (IPE/HEA, RESEARCHED). Merdiven, kapı ve
          korkuluk henüz modellenmedi (Faz 2).
        </p>
      </div>
    </div>
  )
}
