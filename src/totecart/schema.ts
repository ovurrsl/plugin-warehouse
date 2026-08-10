import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'
import { ALL_TOTE_HEIGHTS, CASTOR_DIAMETERS, PALETTE, TOTE_FOOTPRINTS } from './catalog'

/**
 * Sipariş toplama arabası.
 *
 * ## Toplam yükseklik alan DEĞİL, TÜRETİLİYOR
 *
 * Bu şemanın en önemli kararı. Yükseklik saklansaydı kat aralığı ondan
 * çıkarılırdı, ve kullanıcı yüksekliği kısınca ya da kat sayısını artırınca
 * aralık kasa boyunun altına düşerdi: kasalar birbirinin içinden geçen,
 * hiçbir hata vermeyen bir araba. Bunun yerine yükseklik kasadan yukarı
 * doğru hesaplanıyor (`metrics.ts`) — gerçek makinenin de böyle boylandığı
 * gibi: 506CT ailesi tam olarak "6 × 110'luk kasa → 1100 mm" diye yayımlıyor.
 *
 * Kullanıcının kendi spec'indeki 1500 mm zarfına en yakın araba 5 kat ×
 * 220 mm kasa ve 1396 mm çıkıyor — 10 cm altında. Fark bilinçli: eski
 * uygulama yüksekliği SABİTLEYİP rafları ona yayıyordu (220 mm'lik kasanın
 * üstünde 180 mm boşluk), bu model kasayı sabitleyip yüksekliği hesaplıyor.
 * Test hem rakamı hem gerekçeyi kilitliyor.
 *
 * ## Kasa yüksekliği neden serbest bir enum
 *
 * `toteHeight` bütün ailelerin merdivenlerinin birleşimi, ama her aile
 * kendi merdivenini taşıyor ve `metrics.ts` seçilen değeri ailenin
 * merdivenine yaslıyor. Şemada iki ayrı alan tutmak, aile değişince
 * ötekinin sessizce geçersiz kalması demekti.
 */
export const ToteCartNode = BaseNode.extend({
  id: migratedObjectId('totecart', 'totecart'),
  type: nodeType('warehouse:tote-cart'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /** Kasa tabanı — ISO 3394 modülü ya da alt katı. */
  toteFootprint: z.enum(TOTE_FOOTPRINTS).default('600x400'),

  /**
   * Kasa dış yüksekliği, mm. Seçilen tabanın merdiveninde yoksa `metrics.ts`
   * en yakınına yaslıyor — geçersiz bir kasa çizmektense.
   */
  toteHeight: z.enum(ALL_TOTE_HEIGHTS).default('220'),

  /** Kat sayısı. Üst sınır katalogdan değil: 8 kattan sonra araba
   *  itilemeyecek kadar uzuyor ve panelin uyarısı bunu söylüyor. */
  tiers: z.number().int().min(1).max(8).default(5),

  /**
   * Kaç katta gerçekten kasa var — kısmen toplanmış bir arabayı çizmek için.
   * Boş bırakılırsa hepsi dolu.
   */
  loadedTiers: z.number().int().min(0).max(8).optional(),

  /** Tekerlek çapı, mm. */
  castorDiameter: z.enum(CASTOR_DIAMETERS).default('100'),

  /**
   * Eğimli tepsiler. Gerçek bir ürün sınıfı, ama açıyı hiçbir üretici
   * yayımlamıyor — kullanılan 15° kullanıcının kendi eski uygulamasından.
   */
  tilt: z.boolean().default(false),

  /** İtme kolu. Kolsuz varyantlar var (raflar arası besleme arabası). */
  hasHandle: z.boolean().default(true),

  /** Çerçeve rengi. */
  frameColor: z.string().default(PALETTE.frame),
  /** Kasa rengi. */
  toteColor: z.string().default(PALETTE.tote),
})

export type ToteCartNode = z.infer<typeof ToteCartNode>
