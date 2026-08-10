import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { lengthLabel, unitNow } from '../units'
import {
  ALL_TOTE_HEIGHTS,
  CASTOR_DIAMETERS,
  EN1757_MAX_CAPACITY_KG,
  TOTE_FOOTPRINTS,
  toteHeightIds,
} from './catalog'
import {
  capacityKg,
  familyOf,
  handleYM,
  overallHeightM,
  toteHeightIsExact,
  toteSizeOf,
} from './metrics'
import type { ToteCartNode } from './schema'

/**
 * Müfettiş alanları — ailenin deseni: `customPanel` yok, alanlar bildirilir.
 *
 * TOPLAM YÜKSEKLİK ALAN DEĞİL, ve olmaması bu kind'ın tasarımı: yükseklik
 * kasadan yukarı hesaplanıyor. Kullanıcı kat ekleyince araba uzuyor;
 * yüksekliği kilitleyip aralığı sıkıştırmak, kasaların birbirinin içinden
 * geçtiği ve hiçbir hata vermeyen bir araba üretirdi.
 */
export const toteCartParametrics: ParametricDescriptor<ToteCartNode> = {
  groups: [
    {
      label: 'Totes',
      fields: [
        {
          key: 'toteFootprint',
          kind: 'enum',
          options: [...TOTE_FOOTPRINTS],
          display: 'select',
        },
        {
          key: 'toteHeight',
          kind: 'enum',
          options: [...ALL_TOTE_HEIGHTS],
          display: 'select',
        },
      ],
    },
    {
      label: 'Cart',
      fields: [
        { key: 'tiers', kind: 'number', min: 1, max: 8, step: 1 },
        { key: 'loadedTiers', kind: 'number', min: 0, max: 8, step: 1 },
        {
          key: 'castorDiameter',
          kind: 'enum',
          options: [...CASTOR_DIAMETERS],
          display: 'select',
        },
        { key: 'tilt', kind: 'boolean' },
        { key: 'hasHandle', kind: 'boolean' },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'toteColor', kind: 'color' },
      ],
    },
    {
      label: 'Transform',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],

  /**
   * Uyarılar — dördü de kullanıcının panelde kurabileceği, gerçekte var
   * olmayan ya da kullanılamaz bir arabayı anlatıyor, ve hiçbirinin ekranda
   * belirtisi yok: araba her hâlükârda çizilir.
   */
  invariants: [
    (node) => {
      const issues: Issue[] = []
      const unit = unitNow()
      const family = familyOf(node)

      // Kasa yüksekliği seçilen tabanın merdiveninde yoksa `metrics.ts` en
      // yakınına yaslıyor — panelde bir sayı, ekranda başka bir kasa.
      // Tek görünür belirti bu uyarı.
      if (!toteHeightIsExact(node)) {
        issues.push({
          severity: 'warning',
          field: 'toteHeight',
          msg: `${family.label} is not published in ${node.toteHeight} mm — its ladder (${family.source}) runs ${toteHeightIds(node.toteFootprint).join(' / ')}. The cart is drawn with the nearest, ${toteSizeOf(node).height} mm.`,
        })
      }

      // Dolu kat sayısı kat sayısını aşarsa fazlası sessizce yok sayılıyor.
      if (node.loadedTiers !== undefined && node.loadedTiers > node.tiers) {
        issues.push({
          severity: 'warning',
          field: 'loadedTiers',
          msg: `Only ${node.tiers} tiers exist, so ${node.loadedTiers} totes cannot be carried — the extra ones are not drawn.`,
        })
      }

      // İtilemeyecek kadar yüksek araba. Kolun üstündeki her kasa kör
      // yükleme demek, ve üst kasa göz hizasını aşınca araba devrilir.
      const height = overallHeightM(node)
      if (node.hasHandle && height > 1.8) {
        issues.push({
          severity: 'warning',
          field: 'tiers',
          msg: `At ${lengthLabel(height, unit, 2)} the top tote is loaded above eye level and well over the ${lengthLabel(handleYM(), unit, 2)} handle — this cart is hard to push and easy to tip. Fewer or shorter totes bring it down.`,
        })
      }

      // NOT — "tekerlek gövdeden zayıf" diye bir uyarı YOK, ve olmaması
      // bilinçli: en küçük tekerlek bile dördü birden 440 kg taşıyor,
      // gövde 250. O koşul bu katalogla asla doğru olamaz, ve asla
      // yanmayacak bir uyarı yapılmayan bir denetimi yapılıyormuş gibi
      // gösterir. Tabloya daha küçük bir çap eklenirse `capacityKg`'nin
      // `min`'i zaten doğru cevabı verir; uyarı o gün yazılır.

      // EN 1757 kapsam tavanı. Bu paketin ölçüleriyle aşılamaz, ama sınır
      // kodda yazılı olsun: standart 500 kg'ın üstünü BAŞKA bir standarda
      // bırakıyor ve bunu bilmek gerekiyor.
      if (capacityKg(node) > EN1757_MAX_CAPACITY_KG) {
        issues.push({
          severity: 'warning',
          field: 'castorDiameter',
          msg: `Above ${EN1757_MAX_CAPACITY_KG} kg rated capacity this is no longer a pedestrian propelled platform truck under EN 1757 — a different standard applies.`,
        })
      }

      return issues
    },
  ],
}
