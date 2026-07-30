'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { IssueList } from '../panels/issue-list'
import { TELESCOPIC_MODELS, TELESCOPIC_UNPUBLISHED_NOTE } from './telescopic-catalog'
import { currentLengthM } from './telescopic-metrics'
import { conveyorTelescopicParametrics } from './telescopic-parametrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

/**
 * Teleskopik konveyörün okuma paneli: katalog satırı olduğu gibi, anlık
 * zemin kaplaması, ve yayınlanmamışların kaydı KELİMESİ KELİMESİNE.
 *
 * Hüküm yok. Tabloda hız/kapasite/güç olmadığı için panel bunu söyler ve
 * animasyonun bir TAHMİNLE sürüldüğünü aynı cümlede belirtir — kullanıcı
 * ekranda hareket eden bir kutuyu ölçüm sanmasın.
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

/** Host `trailingSection`'a `node` prop'u geçmiyor — seçimden çözülür. */
function useInspected(provided?: ConveyorTelescopicNode): ConveyorTelescopicNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-telescopic') {
    return null
  }
  return selected as unknown as ConveyorTelescopicNode
}

export default function TelescopicPanel({ node: provided }: { node?: ConveyorTelescopicNode }) {
  const node = useInspected(provided)
  if (!node) return null

  const model = TELESCOPIC_MODELS[node.model]
  const issues = conveyorTelescopicParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const now = currentLengthM(node)

  return (
    <div style={styles.root}>
      <IssueList issues={issues} />

      <div style={styles.card}>
        <div style={styles.row}>
          <span>Model</span>
          <span style={styles.figure}>{model.label}</span>
        </div>
        <div style={styles.row}>
          <span>Sabit gövde · A</span>
          <span style={styles.figure}>{model.fixedM.toFixed(2)} m</span>
        </div>
        <div style={styles.row}>
          <span>Uzama · B</span>
          <span style={styles.figure}>{model.extensionM.toFixed(2)} m</span>
        </div>
        <div style={styles.row}>
          <span>Tam açık · C</span>
          <span style={styles.figure}>{model.totalM.toFixed(2)} m</span>
        </div>
        <div style={styles.row}>
          <span>Şu anki uzunluk</span>
          <span style={styles.figure}>{now.toFixed(2)} m</span>
        </div>
        <div style={styles.row}>
          <span>Bölüm · bant kotu</span>
          <span style={styles.figure}>
            {model.sections} · {model.heightM.toFixed(2)} m
          </span>
        </div>
        <p style={styles.note}>
          SZ-Apollo A-serisi teleskopik bant konveyör tablosu, "Fixed Type" — bant kotu modelin
          kendisidir, ayarlanmaz.
        </p>
      </div>

      <div style={styles.card}>
        <p style={styles.note}>{TELESCOPIC_UNPUBLISHED_NOTE}</p>
      </div>
    </div>
  )
}
