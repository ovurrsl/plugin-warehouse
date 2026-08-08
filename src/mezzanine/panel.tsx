'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { PanelSection, SegmentedControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { IssueList } from '../panels/issue-list'
import { Figure, Figures, Note, SelectRow } from '../panels/kit'
import { useWarehouseStore } from '../store'
import { lengthLabel, lengthValue, millimetreLabel, useUnit } from '../units'
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
 * alanlarında. Tek istisna profil geçersiz kılmaları: jenerik `enum` alanı
 * `null`u ("otomatik") ifade edemiyor.
 */

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
  const unit = useUnit()
  const activeDeck = useWarehouseStore((s) => s.activeDeck)
  const setActiveDeck = useWarehouseStore((s) => s.setActiveDeck)

  const resolved = useMemo(() => (node ? resolveTierElevations(node.tiers) : []), [node])

  /**
   * Taşınan raflar SAHNENİN TAMAMINI geziyor (`Object.entries(nodes)`).
   *
   * Memo yürüyüşü kaldırmıyor — sözlük gerçekten değiştiğinde yine geziyor.
   * Kestiği şey öteki renderlar: birim değişimi, hedef güverte seçimi, seçim
   * değişikliği, host'un panelin üstünden geçen her yeniden çizimi. Sahne hiç
   * yazılmadan gelen bu renderların her biri, önceden binlerce düğümü bir kez
   * daha geziyordu.
   */
  const supported = useMemo(
    () =>
      node ? racksOnMezzanine(nodes as Readonly<Record<string, unknown>>, node, resolved) : [],
    [nodes, node, resolved],
  )

  if (!node) return null

  const system = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem]
  const issues = mezzanineParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const overloaded = overloadedRacks(supported)
  const isSigma = node.constructiveSystem === 'SIGMA'

  const targeting = activeDeck?.mezzanineId === node.id ? activeDeck.tierIndex : null

  return (
    <>
      <IssueList issues={issues} />

      {/**
       * Hedef güverte seçici — NİŞAN ALARAK seçilemediği için var.
       *
       * Host'un imleç-yüzey seçimi ışının kestiği en yakın slab düzlemini
       * alıyor; yukarıdan bakan bir kamerada bu her zaman EN ÜSTTEKİ
       * güverte, yani iki katlı bir mezzanine'de alttakine hiçbir açıdan
       * nişan alınamaz.
       */}
      <PanelSection title="Yerleştirme hedefi">
        <SegmentedControl
          onChange={(value: string) =>
            setActiveDeck(
              value === 'ground'
                ? null
                : { mezzanineId: node.id, tierIndex: Number(value.slice(5)) },
            )
          }
          options={[
            { label: 'Zemin', value: 'ground' },
            ...resolved.map((tier) => ({
              label: `T${tier.index} · ${lengthValue(tier.deckTopM, unit, 1)}`,
              value: `tier-${tier.index}`,
            })),
          ]}
          value={targeting === null ? 'ground' : `tier-${targeting}`}
        />
        <Note>
          Seçili güverte, bu mezzanine'in taban izine konan her şeyin (palet, raf, konveyör)
          taşıyıcısı olur. Taban izinin dışına tıklamak seçimi yok sayar.
        </Note>
      </PanelSection>

      {/**
       * Profil geçersiz kılmaları — şemada başından beri vardı, `resolveIBeam`
       * GL2000/MIXED'de okuyordu ama HİÇBİR panel yazamıyordu.
       *
       * SIGMA'da bu bölüm GİZLENİYORDU ve bu bir çıkmazdı: invariant, değeri
       * `null` olmayan her profil için "SIGMA bunu yok sayıyor" uyarısı
       * basıyor, ama uyarıyı susturmanın tek yolu olan kontrol ekranda
       * olmuyordu. Kullanıcı düzeltemediği bir uyarıya bakıyordu.
       *
       * Artık gizlenmiyor: değer görünüyor, "otomatik"e çekilebiliyor, ve
       * neden yok sayıldığı yanında yazıyor. Çıkış kapısı kontrolün kendisi.
       */}
      <PanelSection title="Profil geçersiz kılma">
        {(
          [
            ['Ana kiriş', 'mainBeamProfile', Object.keys(IPE_PROFILES)],
            ['İkincil kiriş', 'secondaryBeamProfile', Object.keys(IPE_PROFILES)],
            ['Kolon', 'columnProfile', Object.keys(HEA_PROFILES)],
          ] as const
        ).map(([label, key, options]) => (
          <SelectRow
            key={key}
            label={label}
            onChange={(value: string) =>
              useScene.getState().updateNode(
                node.id as AnyNodeId,
                {
                  [key]: value === 'auto' ? null : value,
                } as never,
              )
            }
            options={[
              { label: 'otomatik', value: 'auto' },
              ...options.map((id) => ({ label: id, value: id })),
            ]}
            value={node[key] ?? 'auto'}
          />
        ))}
        <Note>
          {isSigma
            ? 'SIGMA soğuk şekillendirilmiş kendi profil ailesini kullanır — buradaki seçim geometriye İŞLEMEZ. Uyarıyı kaldırmak için "otomatik"e çekin; profili sabitlemek istiyorsanız kurucu sistemi GL2000 ya da MIXED yapın.'
            : 'Otomatik: kurucu sistemin varsayılan profili. Açık bir profil seçmek geometriyi EN 10365 kesitiyle yeniden kurar.'}
        </Note>
      </PanelSection>

      <PanelSection title="Ölçüler">
        <Figures
          rows={[
            ['Kurucu sistem', system.label],
            ['Tier', `${node.tiers.length}`],
            ['Toplam yükseklik', lengthLabel(totalHeightM(node), unit)],
            ...resolved.map(
              (tier) =>
                [
                  `Tier ${tier.index} güverte`,
                  `${lengthLabel(tier.deckTopM, unit)} · boşluk ${lengthLabel(effectiveClearHeightM(node, tier), unit)}`,
                ] as const,
            ),
          ]}
        />
        <Note>
          Kaynak: Mecalux MK-049439-11/23 + EN 10365 (IPE/HEA, RESEARCHED). "Boşluk" fiili tavan
          yüksekliği — kirişler döşemenin altına sarktığı için yazılan değerden küçüktür.
        </Note>
      </PanelSection>

      {resolved.some((tier) => tier.accessories.staircases.length > 0) && (
        <PanelSection title="Merdivenler">
          <Figures
            rows={resolved.flatMap((tier) =>
              tier.accessories.staircases.map((stair) => {
                const delta = tier.deckTopM - tier.resolvedElevationM
                const { geometry } = resolveSteps(stair, delta)
                return [
                  `${stair.id} · tier ${tier.index}`,
                  `${geometry.steps}×${millimetreLabel(geometry.riseM, unit)}/${millimetreLabel(geometry.goingM, unit)}`,
                ] as const
              }),
            )}
          />
          <Note>
            Basamak sayısı ve basış GERÇEK kot farkından; EN ISO 14122-3'e karşı doğrulanır (rıht ≤
            220 mm, basamak ≥ 245 mm, 600 ≤ going+2·rise ≤ 660).
          </Note>
        </PanelSection>
      )}

      {supported.length > 0 && (
        <PanelSection title="Taşınan raf yükü">
          {resolved.map((tier) => {
            const summary = tierLoadSummary(supported, tier.index)
            if (summary.count === 0) return null
            return (
              <Figure key={tier.index} label={`Tier ${tier.index} · ${summary.count} raf`}>
                {summary.declaredKg.toFixed(0)} / {summary.allowanceKg.toFixed(0)} kg
              </Figure>
            )
          })}
          {overloaded.map((entry) => (
            <Note key={entry.rackId} tone="danger">
              {overloadText(entry, unit)}
            </Note>
          ))}
          <Note>
            Yayılı yük oranı (kg/m² × taban izi) — FEM DEĞİL. Kolon reaksiyonu, kiriş açıklığı ve
            nokta yükü hesaba girmiyor; aşım bir ret değil, yapısal inceleme çağrısıdır.
          </Note>
        </PanelSection>
      )}
    </>
  )
}
