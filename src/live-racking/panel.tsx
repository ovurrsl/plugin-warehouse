'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { PanelSection } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { IssueList } from '../panels/issue-list'
import { Figure, Figures, Note, TextRow } from '../panels/kit'
import { LIVE_RACKING_UNPUBLISHED_NOTE } from './catalog'
import {
  assignedSkuCount,
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
  skuOfLevel,
} from './metrics'
import { liveRackingParametrics } from './parametrics'
import type { LiveRackingNode } from './schema'

/**
 * Okuma paneli: türetilmiş ölçüler (E, D, X, düşüş) ve kapasite.
 *
 * E ve D burada gösteriliyor çünkü ALAN DEĞİLLER — katalog formülünden
 * geliyorlar ve kullanıcının görmesi gereken tam olarak bu: paleti
 * değiştirince bay genişliğinin kendiliğinden değişmesi.
 *
 * Bölümler host'un `<PanelSection>`'ı: trailing bölüm host tarafından iç
 * boşluksuz çizildiği için (`parametric-inspector.tsx:173`) panel eskiden
 * kendi çerçeveli kartlarını çiziyordu — ve zaten çerçeveli grupların içinde
 * ikinci bir çerçeve katmanı olarak okunuyordu.
 */

/**
 * SKU yazımı — diziyi kat sayısına kadar doldurarak.
 *
 * Şema kısa diziye izin veriyor (kullanıcı kat sayısını SKU doldurmadan
 * değiştirebilmeli), ama YAZARKEN aradaki boşlukları `''` ile doldurmak
 * zorundayız: seyrek bir dizi JSON'a `null` olarak gider ve şema onu
 * reddeder.
 */
function setSku(node: LiveRackingNode, level: number, value: string): void {
  const next = Array.from({ length: node.levels }, (_, i) =>
    i === level ? value : (node.skus[i] ?? ''),
  )
  useScene.getState().updateNode(node.id as AnyNodeId, { skus: next } as never)
}

function useInspected(provided?: LiveRackingNode): LiveRackingNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:live-rack') return null
  return selected as unknown as LiveRackingNode
}

export default function LiveRackingPanel({ node: provided }: { node?: LiveRackingNode }) {
  const node = useInspected(provided)
  if (!node) return null

  const issues = liveRackingParametrics.invariants?.flatMap((check) => check(node)) ?? []

  return (
    <>
      <IssueList issues={issues} />

      <PanelSection title="Türetilmiş ölçüler">
        <Figures
          rows={[
            ['Palet ağzı · A', `${(palletFaceWidthM(node) * 1000).toFixed(0)} mm`],
            ['Bay genişliği · E = A + 160', `${(bayWidthM(node) * 1000).toFixed(0)} mm`],
            ['Makara boyu · D = A + 30', `${(rollerLengthM(node) * 1000).toFixed(0)} mm`],
            ['Kanal derinliği · X', `${channelDepthM(node).toFixed(2)} m`],
            [
              `Düşüş (%${(node.gradient * 100).toFixed(1)})`,
              `${(channelDropM(node) * 1000).toFixed(0)} mm`,
            ],
          ]}
        />
        <Note>
          E ve D alan değil, katalog formülüdür — palet standardını değiştirmek ikisini de
          değiştirir.
        </Note>
      </PanelSection>

      <PanelSection title="Kapasite">
        <Figures
          rows={[
            [
              'Palet pozisyonu',
              `${palletPositions(node)} (${node.levels} kat × ${node.palletsDeep})`,
            ],
            ['Kat başına makara', `${rollerCount(node)}`],
            [
              'Akış',
              node.variant === 'FIFO' ? 'FIFO · iki koridor' : 'LIFO push-back · tek koridor',
            ],
          ]}
        />
      </PanelSection>

      <PanelSection title="Donanım">
        <Figures
          rows={[
            [
              'Fren makarası',
              hasBrakeRollers(node) ? `${node.palletsDeep} adet · palet başına 1` : 'yok',
            ],
            ['Kanal dip ucu', node.variant === 'FIFO' ? 'çıkış kirişi + tampon' : 'son durdurucu'],
            [
              'Palet tutucu',
              `${node.withRetainers ? 'çıkışta' : 'yok'}${hasIntermediateRetainers(node) ? ' + 2 ara' : ''}`,
            ],
            ['Makara', node.splitRollers ? 'bölünmüş · sert mastlı araç' : 'tam boy'],
            [
              'Alt kat',
              node.floorSetPalletTruckLevel
                ? 'zemin seviyesi · transpalet'
                : `${(node.firstLevelClear * 1000).toFixed(0)} mm açıklık`,
            ],
            ['Yapı', node.cladRack ? 'giydirme raf · çatıyı taşır' : 'serbest duran'],
            [
              'Çerçeve yüksekliği',
              `${(frameHeightM(node) * 1000).toFixed(0)} mm${
                frameHeightIsValid(node)
                  ? ''
                  : ` → ${(nearestValidFrameHeightM(node) * 1000).toFixed(0)}`
              }`,
            ],
          ]}
        />
      </PanelSection>

      <PanelSection title="Kanal referansı">
        <Figure label="SKU atanan kanal">
          {assignedSkuCount(node)}/{node.levels}
        </Figure>
        {Array.from({ length: node.levels }, (_, level) => (
          <TextRow
            key={level}
            label={`Kat ${level + 1}`}
            onChange={(value) => setSku(node, level, value)}
            placeholder="—"
            value={skuOfLevel(node, level)}
          />
        ))}
        <Note>
          Canlı rafta bir kanal bir referans taşır: paletler yerçekimiyle sıraya girer, araya başka
          bir SKU sokulamaz. Plan sembolü bunu seçim gerekmeden gösteriyor.
        </Note>
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Kaynak">
        <Note>{LIVE_RACKING_UNPUBLISHED_NOTE}</Note>
      </PanelSection>
    </>
  )
}
