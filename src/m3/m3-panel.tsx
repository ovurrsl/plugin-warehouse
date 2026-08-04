'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { PanelSection } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { IssueList } from '../panels/issue-list'
import { Figures, Note } from '../panels/kit'
import { areaLabel, lengthLabel, useUnit } from '../units'
import {
  bayLoadKg,
  bayPitch,
  crossBraceSets,
  crossTieCount,
  dividerHeightAt,
  doorHeight,
  drawerCount,
  fittedLevels,
  levelElevation,
  levelLoadKg,
  shelfAreaM2,
} from './bays'
import { m3Parametrics } from './parametrics'
import type { M3ShelvingNode } from './schema'
import {
  FRAME_VARIANTS,
  MESH_APERTURE,
  nearestShelfLength,
  SHELF_MODELS,
  SLOT_PITCH,
  UPRIGHT_FRONT_FACE,
} from './standards'

/**
 * What the bay offers, and where each figure comes from.
 *
 * The load section is the reason this panel differs from the other three
 * racking kinds': M3 is the only system in the five catalogues that publishes a
 * capacity, and a panel that reported it in the same voice as the invented ones
 * would be hiding the one number a user can actually rely on.
 */

function useInspected(provided?: M3ShelvingNode): M3ShelvingNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:m3-rack') return null
  return selected as unknown as M3ShelvingNode
}

export default function M3Panel({ node: provided }: { node?: M3ShelvingNode }) {
  const node = useInspected(provided)
  const unit = useUnit()
  if (!node) return null

  const issues = m3Parametrics.invariants?.flatMap((check) => check(node)) ?? []
  const levels = fittedLevels(node)
  const nearest = nearestShelfLength(node.shelfLength)
  const braces = crossBraceSets(node)
  const variant = FRAME_VARIANTS[node.frameVariant]
  const door = doorHeight(node)

  return (
    <>
      <IssueList issues={issues} />

      <PanelSection title="Bu göz">
        <Figures
          rows={[
            ['Kat', `${levels.length}`],
            ['Raf alanı', areaLabel(shelfAreaM2(node), unit, 2)],
            ['Göz adımı', lengthLabel(bayPitch(node), unit, 3)],
            [
              'Katalog boyu',
              Math.abs(nearest - node.shelfLength) < 1e-6
                ? `${(nearest * 1000).toFixed(0)} mm — seride`
                : `en yakın ${(nearest * 1000).toFixed(0)} mm`,
            ],
            door !== null && ['Kapı', `${(door * 1000).toFixed(0)} mm · 2 kanat`],
          ]}
        />
        <Note>
          Bir sıra, bu düğümlerden oluşur ve yan yana gözler çerçeve PAYLAŞIR: N göz N+1 çerçevede
          durur. Sürüklerken mıknatıs yarım metre içinde tam göz adımına yapıştırır.
        </Note>
      </PanelSection>

      <PanelSection title="Yük">
        {/*
          Bu paketin tek ÖLÇÜLMÜŞ kapasitesi burada. Diğer üç raf kind'ının
          kapasite okuması seçilmiş bir sayıdan geliyor çünkü beş katalogun
          hiçbirinde kg tablosu yok — M3 hariç. Aynı tonda yazmak, kullanıcının
          güvenebileceği tek sayıyı diğerlerinin arasında kaybetmek olurdu.
        */}
        <Figures
          rows={[
            ['Göz kapasitesi', `${bayLoadKg(node)} kg`],
            [`${SHELF_MODELS.HL.label}`, `${SHELF_MODELS.HL.loadKg} kg/kat`],
            [`${SHELF_MODELS.HM.label}`, `${SHELF_MODELS.HM.loadKg} kg/kat`],
          ]}
        />
        <Note>
          Bu sayılar Mecalux tarafından YAYIMLANIYOR — bu pakette raf kapasitesi ölçülmüş tek sistem
          M3. Seçici raf, drive-in ve M7'nin kapasite okumaları seçilmiş değerlerden gelir, çünkü o
          kataloglarda kg tablosu yok. Boy × derinlik başına ayrı tablo M3 için de yayımlanmıyor:
          150/275 kg, gözün ölçüsünden bağımsız kat başı üst sınır.
        </Note>
      </PanelSection>

      <PanelSection title="Çerçeve">
        <Figures
          rows={[
            ['Model', variant.label],
            ['Çapraz bağ', braces === 0 ? 'arka panel taşıyor' : `${braces} takım`],
            ['Çerçeve bağı', `${crossTieCount(node)} adet`],
            ['Yuva aralığı', `${(SLOT_PITCH * 1000).toFixed(0)} mm`],
            ['Dikme ön yüzü', `${(UPRIGHT_FRONT_FACE * 1000).toFixed(0)} mm`],
          ]}
        />
        <Note>
          Çapraz bağ sayısı ALAN değil, sonuç: katalog 2,5 m'ye kadar bir takım, üstüne iki takım
          diyor ve arka panel ikisinin de yerini alıyor. Yüksekliği ya da paneli değiştirin, sayı
          kendiliğinden değişir.
        </Note>
        {node.backPanel === 'mesh' && (
          <Note>
            Tel arka panel katalogda {(MESH_APERTURE * 1000).toFixed(0)} ×{' '}
            {(MESH_APERTURE * 1000).toFixed(0)} mm elektro-kaynaklı göz — sprinkler hesabının
            istediği ölçü. 3B'de delikli sac dokusuyla temsil ediliyor; o dokunun gerçek deliği 50
            mm değil.
          </Note>
        )}
      </PanelSection>

      <PanelSection title="Katlar">
        <Figures
          rows={levels.map((level, index) => {
            const divider = dividerHeightAt(node, index)
            const detail =
              level.structure === 'drawers'
                ? `${drawerCount(node, level)} × ${level.drawerModel} çekmece`
                : divider !== null
                  ? `${SHELF_MODELS[level.model].label} · ${level.dividers} bölücü ${(divider * 1000).toFixed(0)} mm`
                  : SHELF_MODELS[level.model].label
            return [
              `#${index + 1} · ${lengthLabel(levelElevation(level), unit, 3)} · ${levelLoadKg(level)} kg`,
              detail,
            ] as const
          })}
        />
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Kaynak ve güvenilirlik">
        <Figures
          rows={[
            ['Yuva aralığı 25 mm', 'CATALOG'],
            ['Dikme ön yüzü 30 mm', 'CATALOG'],
            ['Raf boyları / derinlikleri', 'CATALOG'],
            ['HL 150 kg · HM 275 kg', 'CATALOG'],
            ['Çapraz bağ kuralı', 'CATALOG'],
            ['Kapı yalnız 1.000 mm gözde', 'CATALOG'],
            ['Dikme kesit derinliği ~40 mm', 'ASSUMPTION'],
            ['Panel kalınlıkları', 'ASSUMPTION'],
            ['RAL 5014 / 7035 hex', 'RESEARCHED'],
          ]}
        />
        <Note>
          CATALOG = Mecalux M3 kataloğunda ya da ürün sayfasında basılı. RESEARCHED = bağımsız
          kaynaktan doğrulandı. ASSUMPTION = bizim seçimimiz; kodda gerekçesi yazılı.
        </Note>
        <Note>
          Katalog iki dikme tipi adlandırıyor — 6 ve 12 kıvrımlı — ama ikisi için de kesit
          yayımlamıyor. Bu yüzden panelde seçenek YOK: geometriyi de türetilmiş hiçbir sayıyı da
          değiştirmeyen bir kontrol, bu turda kaldırdığımız "görünür ama etkisiz" alanların aynısı
          olurdu.
        </Note>
        <Note>
          RAL, sRGB değil fiziksel renk standardı; buradaki hex nominal. Fiziksel eşleşme gereken
          işlerde RAL örneği gerekir.
        </Note>
      </PanelSection>
    </>
  )
}
