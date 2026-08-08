import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'
import {
  CAPACITIES,
  FRAME_HEIGHTS,
  HINGED_LIPS,
  PALETTE,
  PLATFORM_LENGTHS,
  PLATFORM_WIDTHS,
} from './catalog'

/**
 * Yükleme rampası.
 *
 * Ölçüler ENUM, sayı değil: üretici bunları serbest bir aralık olarak değil
 * sipariş edilebilir seçenekler olarak yayımlıyor, ve rampa çukura göre
 * imal edildiği için "arada bir yer" diye bir şey yok. Tezgâhta kaydırıcı
 * doğruydu (masa ölçüye yapılıyor), burada yanlış olurdu.
 *
 * `inclination` makinenin TEK hareket kolu ve işaretli: `0` dinlenme —
 * tabla bitmiş zeminle aynı kotta, dudak yuvasında, üstünden forklift geçer.
 * `+1` yayımlanmış zemin üstü aralığın sonu, `−1` zemin altınınki. Aradaki
 * her değer o aralığın oranı; metre cinsinden karşılığı `metrics.ts`'te ve
 * tabla boyuna göre değişiyor.
 */
export const DockLevellerNode = BaseNode.extend({
  id: migratedObjectId('dockleveller', 'dockleveller'),
  type: nodeType('warehouse:dock-leveller'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /** Tabla genişliği, mm — katalog seçeneği. */
  width: z.enum(PLATFORM_WIDTHS).default('2000'),
  /** Tabla boyu (dudak HARİÇ), mm — katalog seçeneği. */
  length: z.enum(PLATFORM_LENGTHS).default('2500'),

  /**
   * Dudak tipi. Menteşeli dudak tablanın burnunda katlanır ve dinlenmede
   * yuvasına asılır; teleskopik dudak tablanın içindeki cepten KAYARAK
   * çıkar. İkisi ayrı makine ve burada tek alanla ayrılıyorlar çünkü geri
   * kalan her şeyleri aynı.
   */
  lip: z.enum(['hinged', 'telescopic']).default('hinged'),

  /** Menteşeli dudağın boyu, mm — katalog seçeneği. Teleskopikte okunmaz. */
  lipLength: z.enum(HINGED_LIPS).default('400'),

  /**
   * Teleskopik dudağın uzanım oranı, 0–1. Menteşelide okunmaz.
   *
   * Dinlenmede (`inclination === 0`) ETKİN uzanım her hâlükârda sıfır:
   * çekilmemiş bir dudakla kapanan rampa diye bir şey yok, EN 1398 dinlenme
   * konumunda dudağın emniyete alınmasını istiyor. Bkz. `metrics.ts`.
   */
  lipExtension: z.number().min(0).max(1).default(1),

  /** Dinamik kapasite, kN — katalog seçeneği. Geometriyi DEĞİŞTİRMEZ. */
  capacity: z.enum(CAPACITIES).default('60'),

  /** Çerçeve (çukur) yüksekliği, mm — katalog seçeneği. */
  frameHeight: z.enum(FRAME_HEIGHTS).default('585'),

  /**
   * −1 … +1. `0` = tabla zeminle aynı kotta (dinlenme / cross-traffic).
   * Pozitif zemin üstü, negatif zemin altı; ikisinin metre karşılığı
   * yayımlanmış çalışma aralığından geliyor ve simetrik DEĞİL.
   */
  inclination: z.number().min(-1).max(1).default(0),

  /** Kapı yüzündeki tamponlar. */
  hasBumpers: z.boolean().default(true),
  /** Yandaki kumanda direği. */
  hasControlPost: z.boolean().default(true),

  /** Çerçeve ve çukur astarı rengi. */
  frameColor: z.string().default(PALETTE.frame),
  /** Tabla ve dudak sacının rengi. */
  deckColor: z.string().default(PALETTE.deck),
})

export type DockLevellerNode = z.infer<typeof DockLevellerNode>
