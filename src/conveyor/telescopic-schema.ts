import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { TELESCOPIC_BELT_WIDTHS, TELESCOPIC_MODEL_IDS } from './telescopic-catalog'

/**
 * Teleskopik bant konveyör — araç yükleme bomu.
 *
 * Sabit gövdesinden (A) araca doğru B kadar uzar. Ölçüler düğümde DEĞİL
 * katalogdadır — düğüm yalnız model, bant genişliği ve anlık uzama oranını
 * taşır; katalog düzeltmesi kayıtlı her sahneye kendiliğinden yayılır (aracın
 * T16 kuralının aynısı).
 *
 * "Fixed Type": yükseklik modelindir, alan değildir.
 *
 * ## Tek portlu, ve bu kasten
 *
 * Bir zamanlar "portu yoktur, komşuya eklenmez" yazıyordu ve bu, hatta
 * bağlanamamak demekti. Gerçekte bu makinenin KUYRUĞU bir hatta beslenir;
 * uzayan bom ucu ise dorsenin içine girer, oraya konveyör bağlanmaz. Yani
 * asimetrik: **yalnız sabit uç port taşır** (`ports.ts` → `localPorts`).
 *
 * İki ucu da port yapmak, bom ucuna yapışan bir modülün her uzama
 * değişiminde kopması ya da sürüklenmesi demekti — sistem, kurulamayacak bir
 * düzene izin vermiş olurdu.
 */
export const ConveyorTelescopicNode = BaseNode.extend({
  // Yeni kind, eski kimlik yok — tireli tek token, kimlik sözleşmesine uygun.
  id: objectId('conveyor-telescopic'),
  type: nodeType('warehouse:conveyor-telescopic'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /** Katalog satırı. Eklenir, asla yeniden adlandırılmaz. */
  model: z.enum(TELESCOPIC_MODEL_IDS).default('a4-6+12'),

  /** Bant genişliği, mm sınıfı — üç seçenek her modelde aynı. */
  beltWidth: z.enum(TELESCOPIC_BELT_WIDTHS).default('800'),

  /**
   * Uzama oranı, 0 (B tamamen kapalı) … 1 (tam açık, boy = C).
   * Park edilmiş bir sahne durumu — simülasyon değil, yerleşim kararı:
   * rampaya uzanmış bomun kapladığı zemin planın konusudur.
   */
  extension: z.number().min(0).max(1).default(0),

  /**
   * Malın hangi yöne aktığı — ailenin `flow` alanının aynısı.
   *
   * Tek portlu bir makinede bile ANLAMLI, çünkü kuyruk ucunun rolünü bu
   * belirliyor: `forward` yükleme (mal hattan gelir, kuyruktan girer, bomdan
   * dorseye çıkar) → kuyruk `in`; `reverse` boşaltma (mal dorseden gelir,
   * bomdan girer, kuyruktan hatta çıkar) → kuyruk `out`. Rol, kuyruğun hangi
   * komşu porta yapışabileceğini belirlediği için bu alan olmadan mıknatıs
   * rolleri TERS atardı (`inletPort` tanımsız `flow`'u `reverse` sayardı).
   */
  flow: z.enum(['forward', 'reverse']).default('forward'),

  // ── Finish — aile mavisi: teleskopik, roller hattıyla aynı tesiste aynı
  // boyayı giyer (kullanıcı kararı). ───────────────────────────────────────
  frameColor: z.string().default('#1e56a0'),
  beltColor: z.string().default('#2b2f34'),

  // ── Burun donanımı — üreticiler arası opsiyonel, standart değil. ────────
  /** Anti-çarpışma sensörü (fotoelektrik) — burun ucunda. */
  hasSensor: z.boolean().default(true),
  /** Operatör basamağı + korkuluk — konsol tarafında, burunda. */
  hasPlatform: z.boolean().default(true),

  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorTelescopicNode = z.infer<typeof ConveyorTelescopicNode>
