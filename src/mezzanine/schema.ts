import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { CONSTRUCTIVE_SYSTEM_IDS, STEEL_FRAME_COLOR } from './catalog'

/**
 * Mecalux asma kat (mezzanine) — çok katlı yapısal çelik platform.
 *
 * **Host'un "Level" kavramıyla karıştırılmaz.** Bir mezzanine düğümü host'ta
 * TEK bir yere (bir Level içinde bir Item olarak) yerleşir; kaç iç kat
 * (`tiers.length`) taşıdığı tamamen kendi konfigürasyonundandır. N-katlı bir
 * mezzanine için N host-Level düğümü OLUŞTURULMAZ — bu yüzden alan adı
 * `levels: number` değil `tiers: Tier[]`dir (kullanıcının onayladığı v1.1
 * düzeltmesi).
 */

const TierSchema = z.object({
  /** 0-tabanlı, zeminden yukarı. */
  index: z.number().int().min(0),
  /**
   * `'auto'` → önceki tier'ların `(clearHeightM + floorType.structuralDepthM)`
   * toplamı, kümülatif (`resolveTierElevations`). Kenar durumlar (kasıtlı
   * boşluk vb.) için açık bir sayı yazılabilir.
   */
  elevationM: z.union([z.literal('auto'), z.number()]).default('auto'),
  clearHeightM: z.number().min(2).max(6).default(3),
  loadClass: z.union([
    z.literal(250),
    z.literal(350),
    z.literal(500),
    z.literal(750),
    z.literal(1000),
  ]),
  floorType: z.enum([
    'WOOD_CHIPBOARD_30',
    'WOOD_MELAMINE_MA_ML_30',
    'WOOD_GALV_SHEET_1_5',
    'METAL_CORRUGATED',
    'METAL_SLOTTED',
    'METAL_PERFORATED',
    'METAL_GRID',
  ]),
})
export type MezzanineTier = z.infer<typeof TierSchema>

const DEFAULT_TIERS: MezzanineTier[] = [
  { index: 0, elevationM: 'auto', clearHeightM: 3, loadClass: 500, floorType: 'WOOD_CHIPBOARD_30' },
]

export const MezzanineNode = BaseNode.extend({
  id: objectId('mezzanine'),
  type: nodeType('warehouse:mezzanine'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  constructiveSystem: z.enum(CONSTRUCTIVE_SYSTEM_IDS).default('SIGMA'),

  grid: z
    .object({
      baysX: z.number().int().min(1).max(20),
      baysY: z.number().int().min(1).max(20),
      bayWidthM: z.number().min(2).max(8),
      bayDepthM: z.number().min(2).max(8),
    })
    .default({ baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 }),

  columnType: z.enum(['single', 'double']).default('single'),

  /**
   * Profil geçersiz kılmaları — `null` kurucu sistemin ailesine göre bir
   * varsayılan profil seçer (`parts.ts` `resolveProfiles`). GL2000 gibi
   * ağır yük örnekleri katalogda açık profil veriyor (IPE300/IPE160/HEA240);
   * SIGMA/MIXED için genelde `null` yeterli.
   */
  mainBeamProfile: z.string().nullable().default(null),
  secondaryBeamProfile: z.string().nullable().default(null),
  columnProfile: z.string().nullable().default(null),

  /**
   * Faz 1: yalnız yapısal alanlar (index/elevation/clearHeight/loadClass/
   * floorType). `accessories` (merdiven/kapı/korkuluk) Faz 2'de eklenir —
   * kullanılmayan bir alanı şimdiden koymak ölü kod olurdu.
   */
  tiers: z.array(TierSchema).min(1).default(DEFAULT_TIERS),

  // ── Finish ────────────────────────────────────────────────────────────────
  frameColor: z.string().default(STEEL_FRAME_COLOR),

  /** Slab the mezzanine stands on, elected at placement time. */
  supportSlabId: z.string().nullable().default(null),
})

export type MezzanineNode = z.infer<typeof MezzanineNode>
