import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { TELESCOPIC_MODELS } from './telescopic-catalog'
import { currentLengthM } from './telescopic-metrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

/**
 * Müfettiş alanları — ailenin deseni: `customPanel` yok (Move/Duplicate/
 * Delete'i de sahiplenirdi), alanlar bildirilir ve host'un kendi editörleri
 * çizer.
 *
 * `model` standart `enum` olabiliyor çünkü seçenek listesi SABİT: on satırın
 * hepsi her zaman seçilebilir (aracın modele göre daralan mast listesinden
 * farkı bu). Görünen ad host'un enum editöründe kimlik dizesidir; ürün kodu
 * panelin okuma kartında durur.
 */
export const conveyorTelescopicParametrics: ParametricDescriptor<ConveyorTelescopicNode> = {
  groups: [
    {
      label: 'Machine',
      fields: [
        {
          key: 'model',
          kind: 'enum',
          options: Object.keys(TELESCOPIC_MODELS),
          display: 'select',
        },
        {
          key: 'beltWidth',
          kind: 'enum',
          options: ['600', '800', '1000'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Extension',
      fields: [
        // Uzama oranı: 0 kapalı, 1 tam açık. Metre değil oran, çünkü her
        // modelin B'si farklı ve oran modeli değiştirdiğinizde anlamını
        // korur — 12 m'lik bir uzama A4-6+12'de tam açıktır, A4-8+16'da değil.
        { key: 'extension', kind: 'number', min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      label: 'Finish',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'beltColor', kind: 'color' },
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

  // Olmadan invariants çöpe gider: host bildirir, hiçbir yerde okumaz.
  trailingSection: () => import('./telescopic-panel'),

  invariants: [
    (node): Issue[] => {
      const model = TELESCOPIC_MODELS[node.model]
      const issues: Issue[] = []

      // Tablonun kendi zinciri — katalog satırı bozulursa panel söyler.
      // (`telescopic.test.ts` bunu ayrıca kilitler; buradaki, kullanıcının
      // kendi eklediği bir satırın sessizce yanlış çizilmemesi içindir.)
      const residual = model.totalM - (model.fixedM + model.extensionM)
      if (Math.abs(residual) > 0.0005) {
        issues.push({
          field: 'model',
          severity: 'error',
          msg: `Katalog satırı tutarsız: C ≠ A + B (${residual.toFixed(3)} m fark).`,
        })
      }

      // Bant genişliği gövdeye sığmalı: 1000 mm bant en dar modelde bile
      // sorun değil ama kullanıcı katalogla oynarsa sessizce taşmasın.
      if (Number(node.beltWidth) / 1000 > model.fixedM / 2) {
        issues.push({
          field: 'beltWidth',
          severity: 'warning',
          msg: 'Bant genişliği gövde boyuna göre orantısız — model seçimini gözden geçirin.',
        })
      }

      if (node.extension > 0.999) {
        issues.push({
          field: 'extension',
          severity: 'warning',
          msg: `Tam açık: ${currentLengthM(node).toFixed(2)} m zemin kaplar. Rampa önündeki manevra alanını kontrol edin.`,
        })
      }

      return issues
    },
  ],
}
