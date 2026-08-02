'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { PanelSection } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { IssueList } from '../panels/issue-list'
import { Figures, Note } from '../panels/kit'
import {
  directAccessSlotCount,
  fittedLevelCount,
  forkliftEnvelope,
  lanePitch,
  palletSlotCount,
  railBearingEachSide,
  railTopY,
  totalDepth,
} from './lanes'
import { driveInParametrics } from './parametrics'
import type { DriveInRackNode } from './schema'
import { RAIL_PROFILES } from './standards'

/**
 * What the lane holds, and what a truck needs to work it.
 *
 * Mounted as `parametrics.trailingSection`, under the lane's own fields rather
 * than instead of them — `customPanel` would short-circuit the auto-derived
 * groups and the Move/Delete buttons with them.
 *
 * The direct-access figure leads because a drive-in block flatters itself worse
 * than any other kind in this package: a four-deep lane advertises sixteen
 * positions and offers four. Reporting only the total would be the kind of
 * true-but-misleading number this package keeps removing.
 */

function useInspected(provided?: DriveInRackNode): DriveInRackNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:drive-in-rack') return null
  return selected as unknown as DriveInRackNode
}

export default function DriveInPanel({ node: provided }: { node?: DriveInRackNode }) {
  const node = useInspected(provided)
  if (!node) return null

  const issues = driveInParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const positions = palletSlotCount(node)
  const direct = directAccessSlotCount(node)
  const fitted = fittedLevelCount(node)
  const envelope = forkliftEnvelope(node)
  const bearing = railBearingEachSide(node)
  const rail = RAIL_PROFILES[node.railType]

  return (
    <>
      <IssueList issues={issues} />

      <PanelSection title="Bu şerit">
        <Figures
          rows={[
            ['Palet pozisyonu', `${positions} · ${direct} doğrudan erişilebilir`],
            ['Kat', `${fitted} ray + zemin`],
            ['Derinlik', `${totalDepth(node).toFixed(2)} m · ${node.palletsDeep} derin`],
            ['Şerit adımı', `${lanePitch(node).toFixed(3)} m`],
            ['Üst ray', `${railTopY(node, fitted).toFixed(2)} m`],
            [
              'Akış',
              node.entryMode === 'drive-through' ? 'FIFO · iki uç açık' : 'LIFO · tek koridor yüzü',
            ],
          ]}
        />
        <Note>
          Bir şerit tek SKU taşır: paletler biriktirilerek depolanır ve LIFO'da yalnız en öndeki
          alınabilir. "Doğrudan erişilebilir" bunu söylüyor — toplam sayı tek başına yanıltıcıdır.
        </Note>
      </PanelSection>

      <PanelSection title="Ray">
        <Figures
          rows={[
            ['Tip', rail.label],
            ['Kesit', `${(rail.width * 1000).toFixed(0)} × ${(rail.height * 1000).toFixed(0)} mm`],
            ['Oturma (her yan)', `${(bearing * 1000).toFixed(0)} mm`],
            rail.clearSpan !== null && [
              'Net açıklık · D',
              `${(rail.clearSpan * 1000).toFixed(0)} mm — sabit (s.18)`,
            ],
          ]}
        />
        <Note>{rail.note}</Note>
      </PanelSection>

      <PanelSection title="Araç gereksinimi">
        <Figures
          rows={[
            ['En geniş araç gövdesi', `${envelope.maxTruckWidth.toFixed(3)} m`],
            ['Gereken mast yüksekliği', `${envelope.requiredLift.toFixed(2)} m`],
            envelope.guideGap !== null && [
              'Kılavuz açıklığı · Y',
              `${(envelope.guideGap * 1000).toFixed(0)} mm = X − 110`,
            ],
          ]}
        />
        <Note>
          Bu figürler bir onay değil, bir ölçü: koridor genişliği tabloları araç kind'ında yaşıyor
          ve bir şerit, filo seçilmeden önce belirlenir. Kaynak: Mecalux Drive-in s.19, s.23.
        </Note>
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Blok kurmak">
        <Note>
          Bir blok, bu düğümlerden oluşan bir SIRA — bir şerit sayısı taşıyan tek düğüm değil. Yan
          yana koyduğunuz şeritler tam bir şerit adımında dikme hattı paylaşır: on şerit on bir
          hatta durur. Sürüklerken mıknatıs yarım metre içinde tam adıma yapıştırır.
        </Note>
        <Note>
          Çift girişli blok = iki bloğun sırt sırta, 180° döndürülmüş hâli. Ayrı bir alan yok;
          seçici rafta da yok.
        </Note>
      </PanelSection>
    </>
  )
}
