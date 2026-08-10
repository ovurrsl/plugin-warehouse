import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { lengthLabel, unitNow } from '../units'
import { BENCH_VARIANTS, LEG_M, SCALE_PLATFORM_M } from './catalog'
import { depthM, overallHeightM, topKindOf, underOf, widthM } from './metrics'
import type { BenchNode } from './schema'

/**
 * Müfettiş alanları — ailenin deseni: `customPanel` yok, alanlar bildirilir
 * ve host'un kendi editörleri çizer.
 *
 * ## Ölçüler AYARLANABİLİR, ve varsayılanları varyanttan gelir
 *
 * Kullanıcının şartı: "masa boyutları ayarlanabilir olmalı." Üç ölçü de
 * kaydırıcı; boş bırakıldıklarında varyantın kendi ölçüsü geçerli
 * (`metrics.ts`), yani varyant seçmek bir başlangıç noktası, bir kilit değil.
 * Bir depoda tezgâh çoğu zaman ölçüye yaptırılıyor.
 *
 * Sınırlar `schema.ts`'tekilerle AYNI olmak zorunda: panel şemadan geniş bir
 * aralık gösterirse kullanıcı kaydırıcıyı sonuna kadar sürer ve yazım Zod'da
 * sessizce reddedilir — kaydırıcı geri sıçrar, hiçbir yerde sebep yazmaz.
 */
export const benchParametrics: ParametricDescriptor<BenchNode> = {
  groups: [
    {
      label: 'Type',
      fields: [
        {
          key: 'variant',
          kind: 'enum',
          options: Object.keys(BENCH_VARIANTS),
          display: 'select',
        },
      ],
    },
    {
      label: 'Size',
      fields: [
        // Üçü de metre. Adım 10 mm: mobilya ölçüsü santimetreye yuvarlanır,
        // milimetrelik bir adım kaydırıcıyı kullanılmaz yapardı.
        { key: 'width', kind: 'number', min: 0.6, max: 4, step: 0.01 },
        { key: 'height', kind: 'number', min: 0.6, max: 1.2, step: 0.01 },
        { key: 'depth', kind: 'number', min: 0.4, max: 1.4, step: 0.01 },
      ],
    },
    {
      label: 'Fitment',
      fields: [
        {
          key: 'overhead',
          kind: 'enum',
          options: ['none', 'shelf', 'toolboard'],
          display: 'select',
        },
        { key: 'under', kind: 'enum', options: ['none', 'shelf', 'drawers'], display: 'select' },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'timberColor', kind: 'color' },
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
   * Uyarılar — hepsi ölçü ayarlanabilir olduğu için VAR OLAN durumlar.
   *
   * Varyant seçildiğinde bunların hiçbiri çıkmaz; kullanıcı kaydırıcıyı
   * çektiğinde çıkarlar, ve çıkmaları gereken yer tam orası: bir masa
   * fiziksel olarak imkânsız hâle geldiğinde bunu söyleyen tek şey burası.
   */
  /**
   * NOT — "ölçüye yapılmış" bilgisi burada DEĞİL, panelin okuma kartında.
   *
   * Host'un `Issue.severity`'si yalnız `error` ve `warning` tanıyor. Varyantın
   * yayınlanmış zarfından ayrılmak bir kusur değil, olağan bir tercih; onu
   * uyarı olarak basmak paneli sürekli sarıya boyar ve gerçek uyarıları
   * görünmez yapardı.
   */
  invariants: [
    (node) => {
      const issues: Issue[] = []
      const unit = unitNow()

      // Gömme terazi platformu tablaya sığmak zorunda. Sığmadığında mesh
      // sessizce tablanın kenarından taşar — ekranda "büyük bir gri kare"
      // görünür ve kimse sebebini anlamaz.
      if (topKindOf(node) === 'scale') {
        const clear = Math.min(widthM(node), depthM(node)) - 2 * LEG_M
        if (SCALE_PLATFORM_M > clear) {
          issues.push({
            severity: 'error',
            field: 'width',
            msg: `A ${lengthLabel(SCALE_PLATFORM_M, unit, 3)} scale platform does not fit a worktop with ${lengthLabel(clear, unit, 3)} clear between the legs. Widen or deepen the bench.`,
          })
        }
      }

      // Çekmece bloğu masanın yarısına oturuyor; yarı genişlik iki ayak
      // profilinden darsa blok ayakların içine girer.
      if (underOf(node) === 'drawers' && widthM(node) / 2 - LEG_M < 0.2) {
        issues.push({
          severity: 'warning',
          field: 'under',
          msg: 'This bench is too narrow for a drawer block — the drawers would take the whole knee space. An open shelf fits better below this width.',
        })
      }

      // Üst raflı bir tezgâh kapı altından geçmeyecek kadar uzayabilir.
      // Uyarı, hata değil: 2,4 m'lik bir tavan altına 2,5 m'lik tezgâh
      // koymak yasak değil, yalnız fark edilmesi gereken bir şey.
      const overall = overallHeightM(node)
      if (overall > 2.4) {
        issues.push({
          severity: 'warning',
          field: 'height',
          msg: `With its overhead structure this bench stands ${lengthLabel(overall, unit, 3)} tall — above a standard ${lengthLabel(2.4, unit, 1)} door head.`,
        })
      }

      return issues
    },
  ],
}
