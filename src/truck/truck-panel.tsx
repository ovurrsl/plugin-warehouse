'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type CSSProperties, useState } from 'react'
import { gapsFor } from '../handling/gaps'
import { aisleBandForVariant, aisleFigureForModel } from '../handling/metrics'
import { TRUCK_MODELS, TRUCK_VARIANT_LABEL } from '../handling/models'
import { IssueList } from '../panels/issue-list'
import { COMMIT_REFUSAL_TEXT, planCommit } from './commit-move'
import { ALIGN_BASIS_NOTE, cycleSeconds } from './duty'
import { bindTruck, buildFleet } from './fleet'
import { truckParametrics } from './parametrics'
import { claimRoute } from './route-binding'
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
  button: {
    width: '100%',
    borderRadius: '0.375rem',
    border: '1px solid var(--border)',
    background: 'transparent',
    padding: '0.375rem 0.5rem',
    fontSize: '0.6875rem',
    color: 'var(--foreground)',
    cursor: 'pointer',
  },
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

/** Rota bağlama durumunun okuduğu sahne — panel seçimle zaten yeniden
 *  render olur, ayrı bir abonelik maliyeti yok. */
function useSceneNodes(): Readonly<Record<string, unknown>> {
  return useScene((s) => s.nodes as Record<string, unknown>)
}

export default function TruckPanel({ node: provided }: { node?: TruckNode }) {
  const node = useInspectedTruck(provided)
  const allNodes = useSceneNodes()
  const [commitNote, setCommitNote] = useState<string | null>(null)
  if (!node) return null

  const model = TRUCK_MODELS[node.model]
  const band = aisleBandForVariant(model.variant)
  const figure = aisleFigureForModel(node.model, node.referenceLoad)
  const gaps = gapsFor(model)
  const issues = truckParametrics.invariants?.flatMap((check) => check(node)) ?? []

  // Sahneyi okuyan bulgular BURADA yaşar — invariants tek düğümün saf
  // fonksiyonudur ve rota başka bir düğümdür (plan §6.3).
  if (node.duty === 'shuttle' && node.routeId) {
    const bound = bindTruck(node, allNodes)
    if ('refusal' in bound) {
      const why: Record<string, string> = {
        'route-missing': 'Atanmış rota sahnede yok — araç hareket etmez.',
        'route-not-vehicle': 'Atanmış rota bir yaya yolu — araç yalnız araç koridorunda sürer.',
        'different-parent': 'Rota başka bir katta — araç ve rotası aynı kata ait olmalı.',
        'route-degenerate': 'Rota sıfır uzunlukta — sürülecek yol yok.',
        'no-drive': `${TRUCK_VARIANT_LABEL[model.variant]} motorsuz — filoda süremez.`,
        'no-route': '',
      }
      const msg = why[bound.refusal]
      if (msg) issues.push({ field: 'duty', severity: 'warning', msg })
    }
  }

  // Yerleştirme anında 1.5 m içinde koridor yoktu ya da araç sonradan
  // taşındı: atama görünür ve DÜZENLENEBİLİR olmak zorunda (plan §5.3'ün
  // "görünmez atama" reddinin öbür yarısı). Arama 6 m — düğmeye basmak açık
  // bir niyettir, yerleştirmenin sessiz talebi değil.
  const routeAction = node.routeId ? (
    <button
      onClick={() =>
        useScene.getState().updateNode(node.id as AnyNodeId, { routeId: null } as Partial<AnyNode>)
      }
      style={styles.button}
      type="button"
    >
      Rotayı çöz
    </button>
  ) : (
    <button
      onClick={() => {
        const found = claimRoute(
          useScene.getState().nodes as Readonly<Record<string, unknown>>,
          node.parentId ?? null,
          node.position?.[0] ?? 0,
          node.position?.[2] ?? 0,
          6,
        )
        if (found) {
          useScene
            .getState()
            .updateNode(node.id as AnyNodeId, { routeId: found } as Partial<AnyNode>)
        }
      }}
      style={styles.button}
      type="button"
    >
      En yakın araç koridoruna bağla (≤ 6 m)
    </button>
  )

  /**
   * Görev çevrimi okuması ve TEK taahhüt kapısı.
   *
   * Simülasyon sahneye hiç yazmaz; stok hareketi ancak bu düğmeyle, tek
   * history adımı olarak taahhüt edilir. Otomatik taahhüt reddedildi:
   * her bırakma bir geri-alma adımı olurdu ve kullanıcı kendi çizdiği
   * sahneyi Ctrl+Z ile geri alamaz hâle gelirdi.
   */
  const fleetTruck = buildFleet(allNodes).trucks.find((t) => t.id === node.id)
  const cycle = fleetTruck?.cycle ?? null

  const commit = () => {
    if (!cycle) return
    const scene = useScene.getState()
    const result = planCommit(
      scene.nodes as Readonly<Record<string, unknown>>,
      cycle.palletId,
      cycle.assignment.source,
      cycle.assignment.target,
    )
    if ('refusal' in result) {
      setCommitNote(COMMIT_REFUSAL_TEXT[result.refusal])
      return
    }
    scene.updateNode(result.palletId as AnyNodeId, result.patch as unknown as Partial<AnyNode>)
    setCommitNote('Palet hedef yuvaya taşındı — tek geri-alma adımı.')
  }

  return (
    <div style={styles.root}>
      <IssueList issues={issues} />
      {routeAction}

      {cycle && (
        <div style={styles.card}>
          <div style={styles.row}>
            <span>Çevrim</span>
            <span style={styles.figure}>{cycleSeconds(cycle.steps).toFixed(1)} s</span>
          </div>
          <div style={styles.row}>
            <span>Kaynak → hedef</span>
            <span style={styles.figure}>
              {cycle.assignment.source.slot.id} → {cycle.assignment.target.slot.id}
            </span>
          </div>
          <div style={styles.row}>
            <span>Palet alma</span>
            <span style={styles.figure}>
              {cycle.assignment.target.reading.strideMode === 'straddle'
                ? 'ayaklar arasına'
                : 'ayak üzerinden'}
            </span>
          </div>
          {cycle.assignment.target.reading.capacityBasis === 'unpublished' && (
            <p style={styles.note}>
              Rezidüel kapasite eğrisi yayınlanmamış — yüksek kotta nominal yük taahhüt edilemez.
            </p>
          )}
          <p style={styles.note}>{ALIGN_BASIS_NOTE}</p>
          <button onClick={commit} style={styles.button} type="button">
            Bu taşımayı sahneye işle
          </button>
          {commitNote && <p style={styles.note}>{commitNote}</p>}
        </div>
      )}

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
