import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { TELESCOPIC_BELT_WIDTHS, TELESCOPIC_MODEL_IDS } from './telescopic-catalog'

/**
 * Teleskopik bant konveyör — araç yükleme bomu.
 *
 * Roller ailesinin aksine bir HAT parçası değildir: portu yoktur, komşuya
 * eklenmez; sabit gövdesinden (A) araca doğru B kadar uzayan bağımsız bir
 * makinedir. Ölçüler düğümde DEĞİL katalogdadır — düğüm yalnız model,
 * bant genişliği ve anlık uzama oranını taşır; katalog düzeltmesi kayıtlı
 * her sahneye kendiliğinden yayılır (aracın T16 kuralının aynısı).
 *
 * "Fixed Type": yükseklik modelindir, alan değildir.
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

  // ── Finish — aile mavisi: teleskopik, roller hattıyla aynı tesiste aynı
  // boyayı giyer (kullanıcı kararı). ───────────────────────────────────────
  frameColor: z.string().default('#1e56a0'),
  beltColor: z.string().default('#2b2f34'),

  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorTelescopicNode = z.infer<typeof ConveyorTelescopicNode>
