import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { GridField, TiersField } from './auto-fields'
import { CONSTRUCTIVE_SYSTEMS } from './catalog'
import type { MezzanineNode } from './schema'

/**
 * Müfettiş alanları — ailenin deseni: `customPanel` yok, alanlar bildirilir
 * ve host'un kendi editörleri çizer. `grid` ve `tiers` GENERIC field
 * kind'larıyla düzenlenemez (iç içe nesne / dizi-of-nesne) — rack'ın
 * `LevelClearsField` deseni: `kind: 'custom'`, `{node, onUpdate}`. Bunlar,
 * `trailingSection`'ın aksine, kapsama denetiminde GÖRÜNÜR kalır.
 */
export const mezzanineParametrics: ParametricDescriptor<MezzanineNode> = {
  groups: [
    {
      label: 'Machine',
      fields: [
        {
          key: 'constructiveSystem',
          kind: 'enum',
          options: Object.keys(CONSTRUCTIVE_SYSTEMS),
          display: 'select',
        },
        { key: 'columnType', kind: 'enum', options: ['single', 'double'], display: 'segmented' },
        { key: 'grid', kind: 'custom', component: GridField },
      ],
    },
    {
      label: 'Tiers',
      fields: [{ key: 'tiers', kind: 'custom', component: TiersField }],
    },
    {
      label: 'Finish',
      fields: [{ key: 'frameColor', kind: 'color' }],
    },
    {
      label: 'Transform',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],

  trailingSection: () => import('./panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const system = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem]

      if (node.tiers.length > 1 && !system.supportsMultiTier) {
        issues.push({
          field: 'tiers',
          severity: 'error',
          msg: `${system.label} çok katlı istifi desteklemiyor.`,
        })
      } else if (node.tiers.length > 1 && system.multiTierWarning) {
        issues.push({ field: 'tiers', severity: 'warning', msg: system.multiTierWarning })
      }

      // Tier indeksleri 0'dan başlayıp ardışık olmalı — sıçrayan bir indeks
      // `resolveTierElevations`'ın kümülatif zincirini sessizce bozar
      // (zincir indekse değil DİZİ SIRASINA göre işler; kullanıcı elle
      // düzenlerse indeks/sıra tutarsızlığı fark edilmeden kalabilir).
      node.tiers.forEach((tier, order) => {
        if (tier.index !== order) {
          issues.push({
            field: 'tiers',
            severity: 'warning',
            msg: `${order + 1}. tier'in indeksi (${tier.index}) sırasıyla uyuşmuyor.`,
          })
        }
      })

      return issues
    },
  ],
}
