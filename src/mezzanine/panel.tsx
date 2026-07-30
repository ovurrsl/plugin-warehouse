'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { IssueList } from '../panels/issue-list'
import { CONSTRUCTIVE_SYSTEMS } from './catalog'
import { effectiveClearHeightM, resolveTierElevations, totalHeightM } from './metrics'
import { mezzanineParametrics } from './parametrics'
import { overloadedRacks, overloadText, racksOnMezzanine, tierLoadSummary } from './rack-support'
import type { MezzanineNode } from './schema'
import { resolveSteps } from './stairs'

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
  // Raf yükü sahnenin bir fonksiyonu, düğümün değil — bu yüzden burada
  // okunuyor, invariants'ta değil (invariants yalnız düğümü görür).
  const nodes = useScene((s) => s.nodes)
  if (!node) return null

  const system = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem]
  const issues = mezzanineParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const resolved = resolveTierElevations(node.tiers)
  const supported = racksOnMezzanine(nodes as Readonly<Record<string, unknown>>, node)
  const overloaded = overloadedRacks(supported)

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
            <span>Tier {tier.index} deck</span>
            <span style={styles.figure}>
              {tier.deckTopM.toFixed(2)} m · boşluk {effectiveClearHeightM(node, tier).toFixed(2)} m
            </span>
          </div>
        ))}
        <p style={styles.note}>
          Kaynak: Mecalux MK-049439-11/23 + EN 10365 (IPE/HEA, RESEARCHED). "Boşluk" fiili tavan
          yüksekliği — kirişler döşemenin altına sarktığı için yazılan değerden küçüktür.
        </p>
      </div>

      {resolved.some((tier) => tier.accessories.staircases.length > 0) && (
        <div style={styles.card}>
          {resolved.flatMap((tier) =>
            tier.accessories.staircases.map((stair) => {
              const delta = tier.deckTopM - tier.resolvedElevationM
              const { geometry } = resolveSteps(stair, delta)
              return (
                <div key={`${tier.index}-${stair.id}`} style={styles.row}>
                  <span>
                    {stair.id} · tier {tier.index}
                  </span>
                  <span style={styles.figure}>
                    {geometry.steps}×{(geometry.riseM * 1000).toFixed(0)}/
                    {(geometry.goingM * 1000).toFixed(0)} mm
                  </span>
                </div>
              )
            }),
          )}
          <p style={styles.note}>
            Basamak sayısı ve basış GERÇEK kot farkından; EN ISO 14122-3'e karşı doğrulanır (rıht ≤
            220 mm, basamak ≥ 245 mm, 600 ≤ going+2·rise ≤ 660).
          </p>
        </div>
      )}

      {supported.length > 0 && (
        <div style={styles.card}>
          {resolved.map((tier) => {
            const summary = tierLoadSummary(supported, tier.index)
            if (summary.count === 0) return null
            return (
              <div key={tier.index} style={styles.row}>
                <span>
                  Tier {tier.index} · {summary.count} raf
                </span>
                <span style={styles.figure}>
                  {summary.declaredKg.toFixed(0)} / {summary.allowanceKg.toFixed(0)} kg
                </span>
              </div>
            )
          })}
          {overloaded.map((entry) => (
            <p key={entry.rackId} style={{ ...styles.note, color: 'var(--destructive)' }}>
              {overloadText(entry)}
            </p>
          ))}
          <p style={styles.note}>
            Yayılı yük oranı (kg/m² × taban izi) — FEM DEĞİL. Kolon reaksiyonu, kiriş açıklığı ve
            nokta yükü hesaba girmiyor; aşım bir ret değil, yapısal inceleme çağrısıdır.
          </p>
        </div>
      )}
    </div>
  )
}
