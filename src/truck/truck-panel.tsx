'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { ActionButton, ActionGroup, PanelSection } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useState } from 'react'
import { gapsFor } from '../handling/gaps'
import { aisleBandForVariant, aisleFigureForModel } from '../handling/metrics'
import { TRUCK_MODELS, TRUCK_VARIANT_LABEL } from '../handling/models'
import { IssueList } from '../panels/issue-list'
import { Figures, Note, SelectRow } from '../panels/kit'
import { lengthLabel, useUnit } from '../units'
import { COMMIT_REFUSAL_TEXT, planCommit } from './commit-move'
import { ALIGN_BASIS_NOTE, cycleSeconds } from './duty'
import { bindTruck, buildFleet } from './fleet'
import { truckParametrics } from './parametrics'
import { parsePinTag, pinTag } from './pin-tag'
import { claimRoute } from './route-binding'
import type { TruckNode } from './schema'
import { stationsAlong } from './stations'

/**
 * Bağla düğmesinin arama yarıçapı.
 *
 * Sabit, çünkü etiketle davranış aynı sayıyı okumalı: metin çevrilirken sayı
 * `claimRoute`'a ayrı bir literal olarak gitseydi, ikisi sessizce ayrışabilirdi.
 */
const CLAIM_RADIUS_M = 6

/**
 * Aracın okuma paneli: model figürü enstrümanıyla, sınıf bandı, ve boşluk
 * kütüğünün metinleri KELİMESİ KELİMESİNE.
 *
 * Hüküm yok — iki enstrüman yan yana durur ve hangisinin nereden geldiğini
 * söyler (metrics.ts'in kuralı: bağlayıcı olan sınıf bandıdır, model figürü
 * yalnız bu paneldedir). Boşluk notunun kısaltılmamasının sebebi kendisi:
 * gerekçesiz bir boşluk, doldurulmayı bekleyen bir kutu gibi okunur.
 */

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
  const unit = useUnit()
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

  /**
   * Yuva sabitleme — çevrimin kaynağını/hedefini kullanıcı seçer.
   *
   * Seçenek listesi çevrimin kendi istasyon evreni: rotadan erişilebilen,
   * araca hizmet edebilen yuvalar. Kaynak listesi DOLU, hedef listesi BOŞ ve
   * hayaletsiz yuvalar — rolüne uygun olmayan yuva listeye hiç girmiyor,
   * seçilip sessizce yok sayılmasındansa.
   */
  const stations = fleetTruck
    ? stationsAlong(allNodes, fleetTruck.track, TRUCK_MODELS[fleetTruck.modelId])
    : []
  const writePin = (key: 'pickSlot' | 'dropSlot', tag: string) => {
    const value = tag === 'auto' ? null : parsePinTag(tag)
    useScene.getState().updateNode(node.id as AnyNodeId, { [key]: value } as Partial<AnyNode>)
  }
  // Sabit var ama çevrim onu kullanmıyor: geçersiz kalmış (raf silinmiş,
  // yuva boşalmış/dolmuş) ve kura devrede. Sessiz kalınmaz.
  if (cycle && node.pickSlot) {
    const honoured =
      cycle.assignment.source.rackId === node.pickSlot.rackId &&
      cycle.assignment.source.slot.id === node.pickSlot.address
    if (!honoured) {
      issues.push({
        field: 'pickSlot',
        severity: 'warning',
        msg: `Sabitlenen kaynak (${node.pickSlot.address}) artık geçerli değil — çevrim kurayla seçiyor.`,
      })
    }
  }
  if (cycle && node.dropSlot) {
    const honoured =
      cycle.assignment.target.rackId === node.dropSlot.rackId &&
      cycle.assignment.target.slot.id === node.dropSlot.address
    if (!honoured) {
      issues.push({
        field: 'dropSlot',
        severity: 'warning',
        msg: `Sabitlenen hedef (${node.dropSlot.address}) artık geçerli değil — çevrim kurayla seçiyor.`,
      })
    }
  }

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
    <>
      <IssueList issues={issues} />

      <PanelSection title="Rota">
        {/*
          Yerleştirme anında 1.5 m içinde koridor yoktu ya da araç sonradan
          taşındı: atama görünür ve DÜZENLENEBİLİR olmak zorunda (plan §5.3'ün
          "görünmez atama" reddinin öbür yarısı). Arama 6 m — düğmeye basmak
          açık bir niyettir, yerleştirmenin sessiz talebi değil.
        */}
        <ActionGroup>
          {node.routeId ? (
            <ActionButton
              label="Rotayı çöz"
              onClick={() =>
                useScene
                  .getState()
                  .updateNode(node.id as AnyNodeId, { routeId: null } as Partial<AnyNode>)
              }
            />
          ) : (
            <ActionButton
              label={`En yakın araç koridoruna bağla (≤ ${lengthLabel(CLAIM_RADIUS_M, unit, 0)})`}
              onClick={() => {
                const found = claimRoute(
                  useScene.getState().nodes as Readonly<Record<string, unknown>>,
                  node.parentId ?? null,
                  node.position?.[0] ?? 0,
                  node.position?.[2] ?? 0,
                  CLAIM_RADIUS_M,
                )
                if (found) {
                  useScene
                    .getState()
                    .updateNode(node.id as AnyNodeId, { routeId: found } as Partial<AnyNode>)
                }
              }}
            />
          )}
        </ActionGroup>
      </PanelSection>

      {cycle && (
        <PanelSection title="Görev çevrimi">
          <Figures
            rows={[
              ['Çevrim', `${cycleSeconds(cycle.steps).toFixed(1)} s`],
              [
                'Kaynak → hedef',
                `${cycle.assignment.source.slot.id} → ${cycle.assignment.target.slot.id}`,
              ],
              [
                'Palet alma',
                cycle.assignment.target.reading.strideMode === 'straddle'
                  ? 'ayaklar arasına'
                  : 'ayak üzerinden',
              ],
            ]}
          />
          {cycle.assignment.target.reading.capacityBasis === 'unpublished' && (
            <Note>
              Rezidüel kapasite eğrisi yayınlanmamış — yüksek kotta nominal yük taahhüt edilemez.
            </Note>
          )}
          <Note>{ALIGN_BASIS_NOTE}</Note>

          {(
            [
              ['Kaynak yuva', 'pickSlot', stations.filter((s) => s.occupied)],
              ['Hedef yuva', 'dropSlot', stations.filter((s) => !s.occupied && !s.ghosted)],
            ] as const
          ).map(([label, key, options]) => (
            <SelectRow
              key={key}
              label={label}
              onChange={(tag: string) => writePin(key, tag)}
              options={[
                { label: 'kura (otomatik)', value: 'auto' },
                ...options.map((station) => ({
                  label: station.slot.id,
                  value: pinTag(station.rackId, station.slot.id),
                })),
              ]}
              value={node[key] ? pinTag(node[key].rackId, node[key].address) : 'auto'}
            />
          ))}

          <ActionGroup>
            <ActionButton label="Bu taşımayı sahneye işle" onClick={commit} />
          </ActionGroup>
          {commitNote && <Note>{commitNote}</Note>}
        </PanelSection>
      )}

      <PanelSection title="Koridor genişliği">
        <Figures
          rows={[
            figure && [
              `Bu makine · ${figure.instrument} (${node.referenceLoad === '1000x1200' ? '1000×1200' : '800×1200'})`,
              `${figure.requiredM.toFixed(3)} m`,
            ],
            [
              `Sınıf bandı · ${band.basis === 'published' ? 'EN 15620' : 'tahmin'}`,
              band.min === band.max
                ? `${band.min.toFixed(2)} m`
                : `${band.min.toFixed(2)}–${band.max.toFixed(2)} m`,
            ],
            model.Wa !== null && ['Dönüş yarıçapı Wa', `${model.Wa.toFixed(3)} m`],
          ]}
        />
        {band.note && <Note>{band.note}</Note>}
        <Note>{model.source}</Note>
      </PanelSection>

      {gaps.length > 0 && (
        <PanelSection defaultExpanded={false} title="Veri boşlukları">
          {gaps.map((gap) => (
            <Note key={`${String(gap.scope)}:${gap.figure}`}>
              <strong>{gap.figure}:</strong> {gap.note}
            </Note>
          ))}
        </PanelSection>
      )}
    </>
  )
}
