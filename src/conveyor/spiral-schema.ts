import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { SPIRAL_BELT_WIDTHS, SPIRAL_OUTER_DIAMETERS } from './spiral-catalog'

/**
 * Sarmal (spiral) konveyör — merkezi tahrik kolonu etrafında helis yörüngede
 * yükselen/alçalan sürekli taşıma yüzeyi (EN 619:2022).
 *
 * Helis matematiği tek yerde (`spiral-metrics.ts`) türetiliyor:
 *   R = (dış çap − bant)/2 · adım = 2πR·tan(eğim) · tur = yükseklik/adım
 *   nokta(t) = [R·cos t, (adım/2π)·t, R·sin t]
 *
 * İki yük sınıfı (spec §4): **hafif** (karton/tote, ≤12,5° eğim) ve **palet**
 * (min 2.400 mm dış çap, ≤13°). Geometri prensibi aynı, ölçek ve hız farklı.
 *
 * Kaynaklar: Ryson/FlexLink/EHS (hafif) · Konek Makine (palet).
 */
export const ConveyorSpiralNode = BaseNode.extend({
  // Aile adı ÖNDE (`conveyor-spiral`) — kind adlandırma kuralı 1, hattın
  // parçası. Tek token değil ama önekli olduğu için kural otomatik geçer.
  id: objectId('conveyor-spiral'),
  type: nodeType('warehouse:conveyor-spiral'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /**
   * Yük sınıfı. Geometriyi doğrudan bölmez — ölçüleri `outerDiameter` ve
   * `beltWidth` zaten taşıyor — yalnız hız sabitini ve palet asgari çap
   * kuralını seçer (spec §4).
   */
  loadClass: z.enum(['light', 'pallet']).default('light'),

  /**
   * Dış çap, mm STRING enum. Palet tabanı 2.400 mm YAYINLANMIŞ; hafif
   * kademeler SEÇİLMİŞ VARSAYILAN (bkz. `spiral-catalog.ts`).
   */
  outerDiameter: z.enum(SPIRAL_OUTER_DIAMETERS).default('1500'),

  /** Bant genişliği, mm string — SEÇİLMİŞ VARSAYILAN. */
  beltWidth: z.enum(SPIRAL_BELT_WIDTHS).default('500'),

  /**
   * Toplam dikey yükseliş, metre. Sınırlar SEÇİLMİŞ VARSAYILAN — katalog bir
   * ayar aralığı yayınlamıyor.
   */
  travelHeight: z.number().min(1).max(15).default(4),

  /**
   * Helis eğimi, derece. Zod'da çapraz sınıf üst sınırı 13; sınıf başına gerçek
   * sınır (hafif 12,5 / palet 13) `spiral-parametrics.ts`'te uyarıyla ve
   * `spiral.test.ts`'te kilitli. Alt sınır 3° pratik minimum.
   */
  inclineDeg: z.number().min(3).max(13).default(11),

  /**
   * Giriş (alt) tanjantının bant kotu, metre. VARSAYILAN 0,75 M — ailenin
   * bant-kotu standardı.
   *
   * Bu değer keyfî değil, birleşmenin ŞARTI: port mıknatısı bant kotunda SIFIR
   * tolerans istiyor (`port-magnet.ts` `blockingRule`, R2), roller ailesinin
   * varsayılanı 0,75 m. Başka bir varsayılan, varsayılan sarmalın varsayılan
   * bir roller hattına ASLA oturmaması demekti — teleskopiğin `transportHeight`
   * alanının belgelediği tuzağın aynısı.
   */
  entryHeight: z.number().min(0.37).max(3).default(0.75),

  /**
   * Kiralite: helisin dönme yönü. VERTEKS TAŞIR — `ccw` ve `cw` aynalanmış iki
   * helis üretir (`helixPoint`'in işareti), yani geometri anahtarında.
   */
  handedness: z.enum(['cw', 'ccw']).default('ccw'),

  /**
   * Akış yönü: giriş/çıkış rollerini ve slat animasyonunun yönünü belirler.
   * HİÇBİR VERTEKS TAŞIMAZ — geometri anahtarına girmez, yalnız port rolü ve
   * animasyon işaretidir (`up` alttan üste, `down` üstten alta).
   */
  flow: z.enum(['up', 'down']).default('up'),

  /** Yarı saydam güvenlik kafesi — birleştirilmiş buffer'da DEĞİL, renderer'da
   *  ayrı silindir; bu yüzden geometri anahtarına girmez. */
  hasCage: z.boolean().default(true),
  /** İnce korkuluk, helisi bir ofsetle takip eder. Yalnız tam katmanda çizilir. */
  hasHandrail: z.boolean().default(true),

  /** Merkez kolon / gövde boyası — RAL 7016 (koyu antrasit gri). */
  frameColor: z.string().default('#383e42'),
  /** Çevre destek ayakları — RAL 7035 (açık gri). */
  legColor: z.string().default('#d1d3d4'),

  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorSpiralNode = z.infer<typeof ConveyorSpiralNode>
