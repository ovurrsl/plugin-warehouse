import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { PALLET_PRESET_IDS } from '../pallet/presets'
import { DEFAULT_GRADIENT, DEFAULT_ROLLER_PITCH_M, GRADIENT_RANGE, PALETTE } from './catalog'

/**
 * Mecalux Canlı Palet Rafı — **bir kanal sütunu**.
 *
 * Selective rafın kazanılmış dersinin aynısı: bir düğüm bir bay. Bir blok
 * değil. Spesifikasyon `bays: number` diye bir alan öneriyordu; o alan tam
 * olarak `warehouse:pallet-rack`'in içinden çıkarıldığı hatadır — bir sayıyı
 * büyütmek tek nesneyi sessizce yirmi nesneye çevirir ve kullanıcı hiçbirini
 * tek tek seçemez, taşıyamaz, silemez. Yan yana yerleştirilen kanallar
 * ayrı düğümlerdir.
 *
 * Yerel çerçeve: **derinlik ekseni +Z** (giriş yüksek, çıkış alçak — akış
 * −Z yönünde), **genişlik ekseni X**, kat ekseni Y. Kanal +Z'ye doğru
 * yükselir; palet +Z'den yüklenir, yerçekimiyle −Z'ye akar ve çıkış ucunda
 * durur.
 *
 * Her ölçü metre.
 */
export const LiveRackingNode = BaseNode.extend({
  id: objectId('live-racking'),
  type: nodeType('warehouse:live-racking'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /**
   * FIFO: giriş ve çıkış ayrı uçlarda, iki koridor.
   * LIFO (push-back): tek koridor, aynı uçtan yükle ve al.
   *
   * Geometrik fark gerçek: LIFO'da çıkış ucu YOK, onun yerine son
   * durdurucu var ve akış yönü göstergesi çift başlı.
   */
  variant: z.enum(['FIFO', 'LIFO']).default('FIFO'),

  /** Kanalın taşıdığı palet standardı — mevcut ön ayarlar yeniden
   *  kullanılıyor, ikinci bir palet tablosu kurulmuyor. */
  palletPreset: z.enum(PALLET_PRESET_IDS).default('epal-1'),

  /** Kanal derinliği, palet adedi. Katalog en fazla 30 veriyor. */
  palletsDeep: z.number().int().min(1).max(30).default(8),

  /** Kat sayısı — her kat bağımsız bir kanal. */
  levels: z.number().int().min(1).max(12).default(4),

  /**
   * Kat başına SKU — canlı rafta **bir kanal bir referans taşır.**
   *
   * Bu, kataloğun tek-SKU kuralının veri karşılığı: paletler kanalda
   * yerçekimiyle sıraya girer, araya başka bir referans sokulamaz. Kat
   * sayısıyla aynı uzunlukta olmak ZORUNDA değil — eksik girişler boş
   * sayılır, çünkü kullanıcı kat sayısını SKU'ları doldurmadan önce
   * değiştirebilmeli. `skuOfLevel` bu boşluğu tek yerde soğuruyor.
   *
   * Dizi `levels` sayısının yanında duruyor, onun İÇİNDE değil: canlı rafta
   * bütün katlar aynı palet kanalı ve aynı açıklığı paylaşıyor (ilk kat
   * `firstLevelClear` ile zaten ayrı) — kat başına değişen tek şey referans.
   * Kat başına nesne dizisine geçmek, tek alan için şema göçü demekti.
   */
  skus: z.array(z.string()).default([]),

  /** Kanal altındaki serbest yükseklik (ilk kat), metre. */
  firstLevelClear: z.number().min(0.4).max(6).default(1.5),
  /** Katlar arası serbest yükseklik. */
  levelClear: z.number().min(0.4).max(6).default(1.6),

  /** Kanal eğimi. Katalog ~%4 veriyor; sektör bandı %3–5. */
  gradient: z.number().min(GRADIENT_RANGE.min).max(GRADIENT_RANGE.max).default(DEFAULT_GRADIENT),

  /** Makara aralığı — 75 mm'nin katı olmalı (katalog ölçüsü Y). */
  rollerPitch: z.number().min(0.05).max(0.6).default(DEFAULT_ROLLER_PITCH_M),

  // ── Konfigürasyon (katalogun "adaptations" bölümü) ────────────────────

  /** Palet tutucu: ilk paletin ağırlığıyla çalışan pedal, ikinciyi tutar.
   *  İki palet arasında ~300 mm boşluk ister ve kanal derinliğini uzatır. */
  withRetainers: z.boolean().default(false),
  /** Bölünmüş makara — sert mastlı araçlar (istif, turret, transtoker). */
  splitRollers: z.boolean().default(false),
  /** Ara tutucular — uzun kanallarda. */
  intermediateRetainers: z.boolean().default(false),
  /** Menteşeli kanal — zemin katta bakım erişimi. */
  hingedChannels: z.boolean().default(false),
  /**
   * Zemin seviyesi transpalet katı — en alt kanal doğrudan zemine oturur,
   * altında serbest yükseklik bırakılmaz. Transpalet paleti yerden alır.
   *
   * Açıkken `firstLevelClear` okunmaz: kot zinciri zeminden başlar.
   */
  floorSetPalletTruckLevel: z.boolean().default(false),
  /**
   * Giydirme raf (clad-rack) — raf yapısı binanın kendisini taşır.
   *
   * Dikmeler en üst kanalın üstünde çatı bağlantısı için uzar ve tepede bir
   * başlık kirişi taşır. Bu, rafın bir depoya KONMASI ile depo OLMASI
   * arasındaki fark.
   */
  cladRack: z.boolean().default(false),

  // ── Finish ────────────────────────────────────────────────────────────
  uprightColor: z.string().default(PALETTE.upright),
  beamColor: z.string().default(PALETTE.beam),

  /** Rafın üstünde durduğu slab, yerleştirmede seçilir. */
  supportSlabId: z.string().nullable().default(null),
})

export type LiveRackingNode = z.infer<typeof LiveRackingNode>
