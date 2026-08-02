import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { GridField, OutlineField, TiersField } from './auto-fields'
import { CONSTRUCTIVE_SYSTEMS, RAILING_RULES } from './catalog'
import { effectiveClearHeightM, hasCustomOutline, resolveTierElevations } from './metrics'
import { outlineEdges } from './railing'
import type { MezzanineNode } from './schema'
import { resolveSteps } from './stairs'

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
      // Ölçü kendi başına ve EN ÜSTTE: kullanıcının bir asma katı seçtikten
      // sonra en sık aradığı şey bu, ve panelde ölçü diye bulduğu tek kontrol
      // (kolon aksı) onu değiştirmiyordu.
      label: 'Deck',
      fields: [{ key: 'polygon', kind: 'custom', component: OutlineField }],
    },
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
      fields: [
        {
          key: 'frameColor',
          kind: 'color',
          // İntumesan boya rengi zaten örtüyor; alanı göstermek "değiştir
          // ama hiçbir şey olmasın" demekti.
          visibleIf: (node) => !node.intumescentPaint,
        },
        {
          key: 'intumescentPaint',
          kind: 'boolean',
          // Katalog bu seçeneği GL2000 için veriyor; öteki sistemlerde
          // göstermek katalogla çelişirdi.
          visibleIf: (node) => node.constructiveSystem === 'GL2000',
        },
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

      /**
       * SIGMA soğuk şekillendirilmiş bir aile ve kendi profil tablosu var;
       * `resolveIBeam` bu aile için IPE/HEA kimliğini ilk satırda ATIYOR.
       * Onurlandırmak yanlış olurdu (SIGMA elemanına IPE300 kesiti vermek
       * gerçek bir ürünü tarif etmiyor), ama sessizce atmak daha da kötü:
       * kullanıcı yazdığı profilin uygulandığını sanıyor. Söylüyoruz.
       */
      if (node.constructiveSystem === 'SIGMA') {
        const ignored = (
          [
            ['mainBeamProfile', node.mainBeamProfile],
            ['secondaryBeamProfile', node.secondaryBeamProfile],
            ['columnProfile', node.columnProfile],
          ] as const
        ).filter(([, value]) => value !== null)

        for (const [field, value] of ignored) {
          issues.push({
            field,
            severity: 'warning',
            msg: `SIGMA kendi profil ailesini kullanıyor — "${value}" yok sayılıyor. Profili sabitlemek için GL2000 ya da MIXED seçin.`,
          })
        }
      }

      /**
       * Özel şekil çizilmişse korkuluk ve aksesuarlar HÂLÂ sınır
       * dikdörtgenini takip ediyor: `railing.ts` dört yönlü kenar modeline
       * (`north`/`south`/`east`/`west`) dayanıyor ve keyfî bir poligonda o
       * adların karşılığı yok.
       *
       * Sessiz kalmak, bu oturumda temizlenen "yalan söyleyen kontrol"
       * hatasının aynısı olurdu — kullanıcı L şeklinde bir güverte çizip
       * korkuluğun onu takip ettiğini sanardı.
       */
      /**
       * Kenara sabitli merdiven artık kardinalinin TEMSİLCİ anahat kenarına
       * oturuyor; uyarı yalnız o kardinalin poligonda hiç karşılığı yoksa
       * kalıyor (üçgen bir güvertede güneye bakan kenar olmayabilir) — o
       * durumda merdiven sınır dikdörtgenine düşer ve bunu söylemek gerekir.
       */
      if (hasCustomOutline(node)) {
        const cardinals = new Set(
          outlineEdges(node)
            .filter((edge) => edge.representative)
            .map((edge) => edge.cardinal),
        )
        for (const tier of node.tiers) {
          for (const stair of tier.accessories.staircases) {
            if (stair.placement.mode !== 'edge') continue
            if (cardinals.has(stair.placement.edge)) continue
            issues.push({
              field: 'polygon',
              severity: 'warning',
              msg: `"${stair.id}" merdiveni ${stair.placement.edge} kenarına sabitli ama bu şeklin o yöne bakan kenarı yok — merdiven sınır dikdörtgenine düşüyor. Serbest konuma (⤢) alın.`,
            })
          }
        }
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

      const resolved = resolveTierElevations(node.tiers)

      for (const tier of resolved) {
        // Kirişler döşemenin altına sarkıyor: `clearHeightM` kullanıcının
        // yazdığı, `effective` yapının verdiği. Sessizce düzeltmek, yazılan
        // sayıyı yalana çevirirdi (bkz. `metrics.resolveTierElevations`).
        const effective = effectiveClearHeightM(node, tier)
        if (effective < tier.clearHeightM - 0.005) {
          issues.push({
            field: 'tiers',
            severity: 'warning',
            msg: `Tier ${tier.index}: kirişler döşemenin altına sarkıyor, fiili tavan boşluğu ${effective.toFixed(2)} m (yazılan ${tier.clearHeightM.toFixed(2)} m).`,
          })
        }

        // Merdivenler GERÇEK kot farkına karşı denetlenir — katalog ürünü
        // seçilmiş olsa bile.
        const delta = tier.deckTopM - tier.resolvedElevationM
        for (const stair of tier.accessories.staircases) {
          for (const issue of resolveSteps(stair, delta).issues) {
            issues.push({
              field: 'tiers',
              // Rıht ve basamak derinliği SERT eşikler: uymuyorsa merdiven
              // inşa edilemez. Ötekiler uyarı.
              severity:
                issue.code === 'riser-too-tall' || issue.code === 'tread-too-shallow'
                  ? 'error'
                  : 'warning',
              msg: `Tier ${tier.index} · ${stair.id}: ${issue.msg}`,
            })
          }
        }

        // Açıklığı korkuluksuz bırakan bir güvenlik bölgesi, OSHA'nın
        // 1.2 m kuralının tam olarak konusudur — zincir bir korkuluk
        // değildir ve panel bunu adıyla söyler.
        for (const zone of tier.accessories.safetyZones) {
          if (zone.widthM > RAILING_RULES.openingProtectionM) {
            issues.push({
              field: 'tiers',
              severity: 'warning',
              msg: `Tier ${tier.index}: ${zone.widthM.toFixed(2)} m'lik güvenlik bölgesi ${RAILING_RULES.openingProtectionM.toFixed(1)} m eşiğini aşıyor — zincir yerine düşme koruması gerekir.`,
            })
          }
        }
      }

      return issues
    },
  ],
}
