'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { IssueList } from '../panels/issue-list'
import { useWarehouseStore } from '../store'
import { CONSTRUCTIVE_SYSTEMS, HEA_PROFILES, IPE_PROFILES } from './catalog'
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
  tierRow: { display: 'flex', flexWrap: 'wrap', gap: '0.25rem' },
  tierButton: {
    borderRadius: '0.25rem',
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--muted-foreground)',
    padding: '0.125rem 0.375rem',
    fontSize: '0.625rem',
    cursor: 'pointer',
  },
  tierButtonActive: {
    borderRadius: '0.25rem',
    border: '1px solid var(--foreground)',
    background: 'var(--foreground)',
    color: 'var(--background)',
    padding: '0.125rem 0.375rem',
    fontSize: '0.625rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  // Live-racking panelinin satır/etiket/girdi üçlüsüyle aynı ölçüler —
  // eklenti panelleri tek tasarım dili konuşsun.
  skuRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.6875rem' },
  skuLabel: { flex: '0 0 5rem', color: 'var(--muted-foreground)' },
  skuInput: {
    flex: 1,
    minWidth: 0,
    borderRadius: '0.25rem',
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--foreground)',
    padding: '0.125rem 0.375rem',
    fontSize: '0.6875rem',
  },
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
  const activeDeck = useWarehouseStore((s) => s.activeDeck)
  const setActiveDeck = useWarehouseStore((s) => s.setActiveDeck)
  if (!node) return null

  const system = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem]
  const issues = mezzanineParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const resolved = resolveTierElevations(node.tiers)
  const supported = racksOnMezzanine(nodes as Readonly<Record<string, unknown>>, node)
  const overloaded = overloadedRacks(supported)

  const targeting = activeDeck?.mezzanineId === node.id ? activeDeck.tierIndex : null

  return (
    <div style={styles.root}>
      <IssueList issues={issues} />

      {/**
       * Hedef güverte seçici — NİŞAN ALARAK seçilemediği için var.
       *
       * Host'un imleç-yüzey seçimi ışının kestiği en yakın slab düzlemini
       * alıyor; yukarıdan bakan bir kamerada bu her zaman EN ÜSTTEKİ
       * güverte, yani iki katlı bir mezzanine'de alttakine hiçbir açıdan
       * nişan alınamaz.
       */}
      <div style={styles.card}>
        <div style={styles.row}>
          <span>Yerleştirme hedefi</span>
          <span style={styles.figure}>{targeting === null ? 'zemin' : `tier ${targeting}`}</span>
        </div>
        <div style={styles.tierRow}>
          <button
            onClick={() => setActiveDeck(null)}
            style={targeting === null ? styles.tierButtonActive : styles.tierButton}
            type="button"
          >
            Zemin
          </button>
          {resolved.map((tier) => (
            <button
              key={tier.index}
              onClick={() => setActiveDeck({ mezzanineId: node.id, tierIndex: tier.index })}
              style={targeting === tier.index ? styles.tierButtonActive : styles.tierButton}
              type="button"
            >
              Tier {tier.index} · {tier.deckTopM.toFixed(2)} m
            </button>
          ))}
        </div>
        <p style={styles.note}>
          Seçili güverte, bu mezzanine'in taban izine konan her şeyin (palet, raf, konveyör)
          taşıyıcısı olur. Taban izinin dışına tıklamak seçimi yok sayar.
        </p>
      </div>

      {/**
       * Profil geçersiz kılmaları — şemada başından beri vardı, `resolveIBeam`
       * GL2000/MIXED'de okuyordu ama HİÇBİR panel yazamıyordu: alan var,
       * geometri tüketiyor, kullanıcıya kapalı. Generic `enum` alanı `null`u
       * ("otomatik") ifade edemediği için burada, trailing panelde.
       * SIGMA'da gizli — o aile profil kimliğini zaten yok sayıyor ve bunu
       * göstermek "değiştir ama hiçbir şey olmasın" alanı olurdu.
       */}
      {node.constructiveSystem !== 'SIGMA' && (
        <div style={styles.card}>
          {(
            [
              ['Ana kiriş', 'mainBeamProfile', Object.keys(IPE_PROFILES)],
              ['İkincil kiriş', 'secondaryBeamProfile', Object.keys(IPE_PROFILES)],
              ['Kolon', 'columnProfile', Object.keys(HEA_PROFILES)],
            ] as const
          ).map(([label, key, options]) => (
            <label key={key} style={styles.skuRow}>
              <span style={styles.skuLabel}>{label}</span>
              <select
                onChange={(event) =>
                  useScene.getState().updateNode(
                    node.id as AnyNodeId,
                    {
                      [key]: event.target.value === 'auto' ? null : event.target.value,
                    } as never,
                  )
                }
                style={styles.skuInput}
                value={node[key] ?? 'auto'}
              >
                <option value="auto">otomatik</option>
                {options.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p style={styles.note}>
            Otomatik: kurucu sistemin varsayılan profili. Açık bir profil seçmek geometriyi EN 10365
            kesitiyle yeniden kurar.
          </p>
        </div>
      )}

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
