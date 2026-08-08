import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'
import { BENCH_VARIANT_IDS, PALETTE } from './catalog'

/**
 * Paketleme / işleme tezgâhı — altı varyantın tek kind'ı.
 *
 * Varyant, zarf ölçülerini ve donanımı birlikte seçiyor (`catalog.ts`), ve
 * varsayılan olarak ölçüler ondan okunuyor. Üç ölçü alanı yine de var ve
 * `optional`: bir depoda tezgâh çoğu zaman ölçüye yaptırılıyor, ve zarfı
 * kilitlemek kullanıcıyı katalog satırından birini seçmeye zorlardı. Boş
 * bırakıldıklarında varyantın kendi değeri okunuyor — sabit bir varsayılan
 * yazmak altı satırdan beşini sessizce yanlışlardı.
 *
 * `heightM` TABLA kotudur, toplam yükseklik değil: üst raflı bir varyantın
 * tepesi bu kotun üstünde kalır ve `overallHeightM` onu ayrıca veriyor.
 */
export const BenchNode = BaseNode.extend({
  id: migratedObjectId('bench', 'bench'),
  type: nodeType('warehouse:bench'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /** Katalog satırı. Eklenir, asla yeniden adlandırılmaz — kullanıcı verisi. */
  variant: z.enum(BENCH_VARIANT_IDS).default('processing'),

  /** Tabla genişliği, metre. Boşsa varyantın kendi ölçüsü. */
  width: z.number().min(0.6).max(4).optional(),
  /** Tabla üst yüzeyinin kotu, metre. Boşsa varyantın kendi ölçüsü.
   *  Alt sınır oturarak çalışılan bir tezgâh, üst sınır ayakta yüksek
   *  tezgâh — ikisi de SEÇİLMİŞ VARSAYILAN, spec bir aralık yayınlamıyor. */
  height: z.number().min(0.6).max(1.2).optional(),
  /** Tabla derinliği, metre. Boşsa varyantın kendi ölçüsü. */
  depth: z.number().min(0.4).max(1.4).optional(),

  /**
   * Üst yapı — varyantın kendi seçimini EZER.
   *
   * Ayrı bir alan, çünkü aynı masayı raflı ve rafsız isteyen iki yerleşim
   * gerçek: raf duvara dayalı bir istasyonda işe yarar, adanın ortasında
   * görüşü keser. Boş bırakıldığında varyant ne diyorsa o.
   */
  overhead: z.enum(['none', 'shelf', 'toolboard']).optional(),

  /** Alt donanım — varyantın seçimini ezer. Aynı gerekçe. */
  under: z.enum(['shelf', 'drawers', 'none']).optional(),

  /** Çerçeve rengi. */
  frameColor: z.string().default(PALETTE.frame),
  /** Tabla ve raf ahşabının rengi. */
  timberColor: z.string().default(PALETTE.timber),
})

export type BenchNode = z.infer<typeof BenchNode>
