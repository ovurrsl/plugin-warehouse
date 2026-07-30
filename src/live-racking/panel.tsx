'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { IssueList } from '../panels/issue-list'
import { LIVE_RACKING_UNPUBLISHED_NOTE } from './catalog'
import {
  bayWidthM,
  channelDepthM,
  channelDropM,
  frameHeightIsValid,
  frameHeightM,
  hasBrakeRollers,
  hasIntermediateRetainers,
  nearestValidFrameHeightM,
  palletFaceWidthM,
  palletPositions,
  rollerCount,
  rollerLengthM,
} from './metrics'
import { liveRackingParametrics } from './parametrics'
import type { LiveRackingNode } from './schema'

/**
 * Okuma paneli: türetilmiş ölçüler (E, D, X, düşüş) ve kapasite.
 *
 * E ve D burada gösteriliyor çünkü ALAN DEĞİLLER — katalog formülünden
 * geliyorlar ve kullanıcının görmesi gereken tam olarak bu: paleti
 * değiştirince bay genişliğinin kendiliğinden değişmesi.
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

function useInspected(provided?: LiveRackingNode): LiveRackingNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:live-racking') return null
  return selected as unknown as LiveRackingNode
}

export default function LiveRackingPanel({ node: provided }: { node?: LiveRackingNode }) {
  const node = useInspected(provided)
  if (!node) return null

  const issues = liveRackingParametrics.invariants?.flatMap((check) => check(node)) ?? []

  return (
    <div style={styles.root}>
      <IssueList issues={issues} />

      <div style={styles.card}>
        <div style={styles.row}>
          <span>Palet ağzı · A</span>
          <span style={styles.figure}>{(palletFaceWidthM(node) * 1000).toFixed(0)} mm</span>
        </div>
        <div style={styles.row}>
          <span>Bay genişliği · E = A + 160</span>
          <span style={styles.figure}>{(bayWidthM(node) * 1000).toFixed(0)} mm</span>
        </div>
        <div style={styles.row}>
          <span>Makara boyu · D = A + 30</span>
          <span style={styles.figure}>{(rollerLengthM(node) * 1000).toFixed(0)} mm</span>
        </div>
        <div style={styles.row}>
          <span>Kanal derinliği · X</span>
          <span style={styles.figure}>{channelDepthM(node).toFixed(2)} m</span>
        </div>
        <div style={styles.row}>
          <span>Düşüş (%{(node.gradient * 100).toFixed(1)})</span>
          <span style={styles.figure}>{(channelDropM(node) * 1000).toFixed(0)} mm</span>
        </div>
        <p style={styles.note}>
          E ve D alan değil, katalog formülüdür — palet standardını değiştirmek ikisini de
          değiştirir.
        </p>
      </div>

      <div style={styles.card}>
        <div style={styles.row}>
          <span>Palet pozisyonu</span>
          <span style={styles.figure}>
            {palletPositions(node)} ({node.levels} kat × {node.palletsDeep})
          </span>
        </div>
        <div style={styles.row}>
          <span>Kat başına makara</span>
          <span style={styles.figure}>{rollerCount(node)}</span>
        </div>
        <div style={styles.row}>
          <span>Akış</span>
          <span style={styles.figure}>
            {node.variant === 'FIFO' ? 'FIFO · iki koridor' : 'LIFO push-back · tek koridor'}
          </span>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.row}>
          <span>Fren makarası</span>
          <span style={styles.figure}>
            {hasBrakeRollers(node) ? `${node.palletsDeep} adet · palet başına 1` : 'yok'}
          </span>
        </div>
        <div style={styles.row}>
          <span>Kanal dip ucu</span>
          <span style={styles.figure}>
            {node.variant === 'FIFO' ? 'çıkış kirişi + tampon' : 'son durdurucu'}
          </span>
        </div>
        <div style={styles.row}>
          <span>Palet tutucu</span>
          <span style={styles.figure}>
            {node.withRetainers ? 'çıkışta' : 'yok'}
            {hasIntermediateRetainers(node) ? ' + 2 ara' : ''}
          </span>
        </div>
        <div style={styles.row}>
          <span>Makara</span>
          <span style={styles.figure}>
            {node.splitRollers ? 'bölünmüş · sert mastlı araç' : 'tam boy'}
          </span>
        </div>
        <div style={styles.row}>
          <span>Çerçeve yüksekliği</span>
          <span style={styles.figure}>
            {(frameHeightM(node) * 1000).toFixed(0)} mm
            {frameHeightIsValid(node)
              ? ''
              : ` → ${(nearestValidFrameHeightM(node) * 1000).toFixed(0)}`}
          </span>
        </div>
      </div>

      <div style={styles.card}>
        <p style={styles.note}>{LIVE_RACKING_UNPUBLISHED_NOTE}</p>
      </div>
    </div>
  )
}
