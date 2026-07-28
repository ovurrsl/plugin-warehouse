'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { gapsFor } from '../handling/gaps'
import { aisleBandForVariant, aisleFigureForModel } from '../handling/metrics'
import { TRUCK_MODELS } from '../handling/models'
import { IssueList } from '../panels/issue-list'
import { truckParametrics } from './parametrics'
import type { TruckNode } from './schema'

/**
 * Aracın okuma paneli: model figürü enstrümanıyla, sınıf bandı, ve boşluk
 * kütüğünün metinleri KELİMESİ KELİMESİNE.
 *
 * Hüküm yok — iki enstrüman yan yana durur ve hangisinin nereden geldiğini
 * söyler (metrics.ts'in kuralı: bağlayıcı olan sınıf bandıdır, model figürü
 * yalnız bu paneldedir). Boşluk notunun kısaltılmamasının sebebi kendisi:
 * gerekçesiz bir boşluk, doldurulmayı bekleyen bir kutu gibi okunur.
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

/** Host `trailingSection`'a `node` prop'u GEÇMİYOR — seçimden çözülür,
 *  verilmişse verilen tercih edilir (pallet-panel'in aynı sözleşmesi). */
function useInspectedTruck(provided?: TruckNode): TruckNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:truck') return null
  return selected as unknown as TruckNode
}

export default function TruckPanel({ node: provided }: { node?: TruckNode }) {
  const node = useInspectedTruck(provided)
  if (!node) return null

  const model = TRUCK_MODELS[node.model]
  const band = aisleBandForVariant(model.variant)
  const figure = aisleFigureForModel(node.model, node.referenceLoad)
  const gaps = gapsFor(model)
  const issues = truckParametrics.invariants?.flatMap((check) => check(node)) ?? []

  return (
    <div style={styles.root}>
      <IssueList issues={issues} />

      <div style={styles.card}>
        {figure && (
          <div style={styles.row}>
            <span>
              Bu makine · {figure.instrument} (
              {node.referenceLoad === '1000x1200' ? '1000×1200' : '800×1200'})
            </span>
            <span style={styles.figure}>{figure.requiredM.toFixed(3)} m</span>
          </div>
        )}
        <div style={styles.row}>
          <span>Sınıf bandı · {band.basis === 'published' ? 'EN 15620' : 'tahmin'}</span>
          <span style={styles.figure}>
            {band.min === band.max
              ? `${band.min.toFixed(2)} m`
              : `${band.min.toFixed(2)}–${band.max.toFixed(2)} m`}
          </span>
        </div>
        {model.Wa !== null && (
          <div style={styles.row}>
            <span>Dönüş yarıçapı Wa</span>
            <span style={styles.figure}>{model.Wa.toFixed(3)} m</span>
          </div>
        )}
        {band.note && <p style={styles.note}>{band.note}</p>}
        <p style={styles.note}>{model.source}</p>
      </div>

      {gaps.length > 0 && (
        <div style={styles.card}>
          {gaps.map((gap) => (
            <p key={`${String(gap.scope)}:${gap.figure}`} style={styles.note}>
              <strong>{gap.figure}:</strong> {gap.note}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
