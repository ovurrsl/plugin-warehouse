import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { MAST_ROW_ID_LIST } from '../handling/masts'
import { TRUCK_MODEL_ID_LIST } from '../handling/models'

const tuple3 = z.tuple([z.number(), z.number(), z.number()])

/** Raf yuvası adresi: hangi raf, hangi `Bx-Ly-Pz`. */
const SlotRef = z.object({ rackId: z.string(), address: z.string() })
/**
 * Bir iş makinesi. Ölçü YOK: her figür `model` üzerinden katalogdan okunur,
 * düğüm yalnız seçimleri taşır. Bir katalog düzeltmesi böylece kaydedilmiş
 * her sahneye kendiliğinden yayılır — düğümde saklanan bir `l1` o düzeltmeyi
 * sonsuza kadar ıskalardı (T16 bunu kilitler).
 *
 * **Her alan `.default()` taşır.** Harici bir paket host'un `migrateNodes`
 * tablosuna satır ekleyemez; eski bir sahnenin bilinmediği her alan burada
 * kendi varsayılanına düşmek zorundadır.
 *
 * Şemada KASTEN olmayanlar:
 *   - `variant` — modelden çözülür; iki yerde durursa ayrışır.
 *   - `l1`/`b1`/`Ast`/`Wa`/`Q` — figür düğümde tutulmaz (yukarısı).
 *   - `guidance` — VNA kılavuz rayı ZEMİNE cıvatalıdır, araca değil
 *     (plan §10 soru 5: eklenmedi).
 *   - `tilt`/`swivel`/`traverse`/`steerMode` — görevden türeyen animasyon
 *     durumu; canlı poz düğümde yaşamaz (`conveyor/flow-simulation.ts`
 *     kuralı: simülasyon sahneye yazmaz).
 */
export const TruckNode = BaseNode.extend({
  // Tek token: host `lastIndexOf('_')` ile öneki çözer ve mevcut kindler
  // underscore'suz tek kelime kullanır.
  id: objectId('truck'),
  type: nodeType('warehouse:truck'),

  position: tuple3.default([0, 0, 0]),
  rotation: tuple3.default([0, 0, 0]),

  /** Katalog satırı. `z.enum` doğrulaması kalır; kural yorumla çivili:
   *  kimlik EKLENİR, asla yeniden adlandırılmaz — yeniden adlandırmak
   *  kaydedilmiş sahnelerin düğümünü parse'tan düşürür. */
  model: z.enum(TRUCK_MODEL_ID_LIST).default('forklift-1300'),

  /** Sipariş edilen mast — SATIR KİMLİĞİ, figür değil. Modelin sunmadığı
   *  bir satır şema hatası değil, panel uyarısıdır: sahne yüklenir, panel
   *  "bu modelde sunulmuyor" der. */
  mastRowId: z.enum(MAST_ROW_ID_LIST).nullable().default(null),

  /** Ast'ın hangi yük için okunduğu — yük ÖLÇÜSÜYLE adlandırılır,
   *  yönelim sıfatıyla değil (AstPair'in gerekçesi). */
  referenceLoad: z.enum(['1000x1200', '800x1200']).default('1000x1200'),

  /** Park hâlindeki çatal kotu, metre. Simülasyon bunun ÜZERİNE yazmaz —
   *  canlı poz `useLiveTransforms`'ta yaşar, düğümde değil. */
  forkHeight: z.number().min(0).max(18).default(0),

  // ── Görev ─────────────────────────────────────────────────────────────
  routeId: z.string().nullable().default(null),
  routeAnchor: z.number().min(0).max(1).default(0),
  duty: z.enum(['parked', 'shuttle']).default('parked'),
  /**
   * Kullanıcının SABİTLEDİĞİ kaynak/hedef yuva — plan §6.1'in alanları.
   *
   * `null` → çevrim yuvayı deterministik kurayla seçer (`assignmentFor`,
   * araç kimliğinden hash). Sabitlenmişse VE hâlâ geçerliyse (kaynak dolu,
   * hedef boş ve hayaletsiz, ikisi de rotadan erişilebilir) kura yerine bu
   * kullanılır; geçersiz kalmış bir sabit sessizce kuraya düşer ve panel
   * bunu söyler — silinen bir rafın yuvasına çevrimi kilitlemek simülasyonu
   * durdurmak olurdu.
   *
   * (Bir kez "yer tutucu" diye silinmişti; kullanıcı düzeltti — amaç tam
   * buydu: simülasyonda paletin NEREDEN alınıp NEREYE konacağını seçmek.)
   */
  pickSlot: SlotRef.nullable().default(null),
  dropSlot: SlotRef.nullable().default(null),
  carryingPalletId: z.string().nullable().default(null),

  /** Üzerinde durduğu slab, yerleştirmede seçilir — istatistik panelinin
   *  slab süzgeci poligon testi yerine alan karşılaştırmasıyla çalışsın. */
  supportSlabId: z.string().nullable().default(null),
})

export type TruckNode = z.infer<typeof TruckNode>
