import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { lengthLabel, unitNow } from '../units'
import {
  CAPACITIES,
  EN1398_MAX_GRADIENT,
  FRAME_HEIGHTS,
  HINGED_LIPS,
  PLATFORM_LENGTHS,
  PLATFORM_WIDTHS,
} from './catalog'
import {
  capacityKN,
  frameHeightM,
  gradient,
  isStored,
  platformLengthM,
  telescopicLipMaxM,
  workingRangeM,
} from './metrics'
import type { DockLevellerNode } from './schema'

/**
 * Müfettiş alanları — ailenin deseni: `customPanel` yok, alanlar bildirilir
 * ve host'un kendi editörleri çizer.
 *
 * Ölçüler ENUM: üretici bunları sipariş seçeneği olarak yayımlıyor ve rampa
 * çukura göre imal ediliyor, yani "arada bir yer" diye bir şey yok. Tezgâhta
 * kaydırıcı doğruydu, burada yanlış olurdu.
 *
 * Tek serbest kol `inclination`, ve o da bir ölçü değil bir POZ: makinenin
 * çalışma aralığındaki yeri. Metre karşılığı tabla boyuna göre değişiyor,
 * bu yüzden kaydırıcı oran gösteriyor ve uyarılar metreyi yazıyor.
 */
export const dockLevellerParametrics: ParametricDescriptor<DockLevellerNode> = {
  groups: [
    {
      label: 'Size',
      fields: [
        { key: 'width', kind: 'enum', options: [...PLATFORM_WIDTHS], display: 'select' },
        { key: 'length', kind: 'enum', options: [...PLATFORM_LENGTHS], display: 'select' },
        { key: 'frameHeight', kind: 'enum', options: [...FRAME_HEIGHTS], display: 'select' },
      ],
    },
    {
      label: 'Lip',
      fields: [
        { key: 'lip', kind: 'enum', options: ['hinged', 'telescopic'], display: 'select' },
        { key: 'lipLength', kind: 'enum', options: [...HINGED_LIPS], display: 'select' },
        { key: 'lipExtension', kind: 'number', min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      label: 'Operation',
      fields: [
        // −1 … +1, sıfır dinlenme. Adım 0,05: aralığın yirmide biri, yani en
        // uzun tablada bile ~2 cm — daha ince bir adım kaydırıcıyı
        // kullanılmaz yapardı, daha kalın bir adım kapıyı ayarlamaya yetmez.
        { key: 'inclination', kind: 'number', min: -1, max: 1, step: 0.05 },
        { key: 'capacity', kind: 'enum', options: [...CAPACITIES], display: 'select' },
        { key: 'hasBumpers', kind: 'boolean' },
        { key: 'hasControlPost', kind: 'boolean' },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'deckColor', kind: 'color' },
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
   * Uyarılar — hiçbiri süs. Üçü de kullanıcının panelde kurabileceği,
   * gerçekte var olmayan bir makineyi anlatıyor ve hiçbirinin ekranda
   * görünür bir belirtisi yok: rampa her hâlükârda çizilir.
   */
  invariants: [
    (node) => {
      const issues: Issue[] = []
      const unit = unitNow()

      // EN 1398'in %12,5'i. Eğim tabla ARTI dudak üstünden ölçülüyor
      // (`metrics.ts`) — yalnız tablaya bakan bir hesap kısa rampaları
      // haksız yere sınırın üstünde gösterirdi.
      const slope = gradient(node)
      if (slope > EN1398_MAX_GRADIENT) {
        issues.push({
          severity: 'warning',
          field: 'inclination',
          msg: `At this setting the ramp climbs ${(slope * 100).toFixed(1)}% over its platform and lip — above the ${(EN1398_MAX_GRADIENT * 100).toFixed(1)}% (1:8) that EN 1398 allows. A longer platform or a longer lip brings it back.`,
        })
      }

      // Teleskopik dudak kısa tablada 785 mm'yi geçemiyor (KAYNAK: Stertil
      // X serisi) — cebi yok. Kullanıcı menteşeliden teleskopiğe geçince
      // uzanım oranı korunuyor ve sessizce kısa bir dudak elde ediyor.
      if (node.lip === 'telescopic') {
        const max = telescopicLipMaxM(node)
        if (max < 1 && node.lipExtension > 0.9) {
          issues.push({
            severity: 'warning',
            field: 'lipExtension',
            msg: `A ${lengthLabel(platformLengthM(node), unit, 2)} platform has no pocket for a full telescopic lip: this one reaches ${lengthLabel(max, unit, 3)}, not ${lengthLabel(1, unit, 2)}. A platform of 2.5 m or longer takes the full lip.`,
          })
        }
      }

      // 10 t yalnız teleskopik seride yayımlanıyor (KAYNAK: Stertil — S
      // serisi 6/8 t, X serisi 6/8/10 t). Menteşeli + 100 kN, katalogda
      // olmayan bir makine.
      if (node.lip === 'hinged' && capacityKN(node) > 80) {
        issues.push({
          severity: 'warning',
          field: 'capacity',
          msg: 'A 100 kN (10 t) rating is published for the telescopic-lip series only; the hinged-lip range stops at 80 kN (8 t). Switch the lip type or drop the capacity.',
        })
      }

      // Çukur derinliği ile çalışma aralığı birbirine bağlı: tabla aşağı
      // inerken arka menteşe sabit kalıyor ve burun çukurun tabanına doğru
      // gidiyor. Yayımlanmış zemin altı aralık standart 585 mm çerçeveye
      // göre; onu aşan bir iniş çerçevenin içine çarpardı.
      const range = workingRangeM(node)
      if (range.belowM > frameHeightM(node)) {
        issues.push({
          severity: 'error',
          field: 'frameHeight',
          msg: `This platform's published below-dock range is ${lengthLabel(range.belowM, unit, 3)}, deeper than the ${lengthLabel(frameHeightM(node), unit, 3)} frame it sits in. A deeper frame is required.`,
        })
      }

      // Dinlenme konumunda dışarı uzanmış dudak — makinenin var olmayan
      // hâli. Kullanıcıya panelde neden hiçbir şey görmediğini söylüyor.
      if (isStored(node) && node.lip === 'telescopic' && node.lipExtension > 0) {
        issues.push({
          severity: 'warning',
          field: 'inclination',
          msg: 'At rest the lip is retracted and the deck sits flush with the floor, whatever the extension slider says — EN 1398 requires the lip secured in the stored position. Move the incline off zero to deploy it.',
        })
      }

      // Kolları tamamen kapatmak rampayı çalıştırılamaz kılar. Uyarı, hata
      // değil: bir mimari çizimde tampon ve direk bilerek gizlenebilir.
      if (!node.hasControlPost && !isStored(node)) {
        issues.push({
          severity: 'warning',
          field: 'hasControlPost',
          msg: 'A deployed leveller with no control post has nothing to operate it from. EN 1398 expects hold-to-run controls beside the platform, not on it.',
        })
      }

      return issues
    },
  ],
}
