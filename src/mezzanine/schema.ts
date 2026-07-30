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

/**
 * Merdiven — İKİ tier'i (ya da zemini bir tier'e) bağlar.
 *
 * `placement` ayrık birleşim: çevre kenarına oturan bir merdiven
 * (`edge`+`offset`) ile iç mekânda duran bir merdiven (`xz`) aynı alanlarla
 * tarif edilemez; addendum'un kendi notu: "interior stair … NOT on the
 * building perimeter, so edge+offset does not apply".
 */
const StaircaseSpec = z.object({
  id: z.string(),
  placement: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('edge'),
      edge: z.enum(['north', 'south', 'east', 'west']),
      offsetM: z.number(),
    }),
    z.object({
      mode: z.literal('xz'),
      xM: z.number(),
      zM: z.number(),
      rotationDeg: z.number(),
    }),
  ]),
  /** EN ISO 14122-3: 800 tek kullanıcı, 1000 çok kullanıcı. */
  widthM: z.union([z.literal(0.8), z.literal(1)]).default(1),
  landing: z.enum(['continuous', 'turn90', 'turn180']).default('turn180'),
  /**
   * Korkuluk sayısı — katalog "bir ya da iki korkuluk" veriyor. Duvara
   * dayalı kolda tek korkuluk yeter; serbest duran kolda iki. Kolun AÇIK
   * kenarı korkuluksuz bırakılamaz, o yüzden 0 seçeneği yok.
   */
  railings: z.union([z.literal(1), z.literal(2)]).default(2),
  /** `'auto'` → gerçek kot farkından hesaplanır (`resolveSteps`). Hazır bir
   *  katalog ürünü (8/10/12/15 basamak) seçilebilir ama AYNI doğrulamadan
   *  geçer — uymuyorsa panel söyler. */
  steps: z.union([z.literal('auto'), z.number().int().positive()]).default('auto'),
})
export type StaircaseSpec = z.infer<typeof StaircaseSpec>

/** Menteşeli kapı — korkulukta bir açıklık açar, içeri doğru açılır. */
const SwingGateSpec = z.object({
  edge: z.enum(['north', 'south', 'east', 'west']),
  offsetM: z.number(),
  /** Katalog: tek 750 mm, çift 1500 mm. */
  widthM: z.union([z.literal(0.75), z.literal(1.5)]).default(0.75),
})
export type SwingGateSpec = z.infer<typeof SwingGateSpec>

/** Devrilir (karşı ağırlıklı) palet kapısı — kenar hiçbir zaman açıkta
 *  kalmaz; forklift paleti buradan bırakır. */
const UpAndOverGateSpec = z.object({
  edge: z.enum(['north', 'south', 'east', 'west']),
  offsetM: z.number(),
  widthM: z.number().min(1).max(3).default(1.5),
})
export type UpAndOverGateSpec = z.infer<typeof UpAndOverGateSpec>

/** Zincirle korunan güvenlik bölgesi — korkulukta açıklık, kapı değil. */
const SafetyZoneSpec = z.object({
  edge: z.enum(['north', 'south', 'east', 'west']),
  offsetM: z.number(),
  widthM: z.number().min(0.5).max(4).default(1.5),
})
export type SafetyZoneSpec = z.infer<typeof SafetyZoneSpec>

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

  /**
   * Bu tier'in aksesuarları. Merdiven bu tier'e ÇIKAR (altındakinden ya da
   * zeminden); kapılar ve güvenlik bölgeleri bu tier'in korkuluğunu deler.
   *
   * Korkuluğun kendisi bir aksesuar DEĞİL: açık çevrede zorunludur
   * (katalog), yani bir alan değil bir kuraldır — `railing.ts` onu
   * açıklıklardan türetir.
   */
  accessories: z
    .object({
      staircases: z.array(StaircaseSpec).default([]),
      swingGates: z.array(SwingGateSpec).default([]),
      upAndOverGates: z.array(UpAndOverGateSpec).default([]),
      safetyZones: z.array(SafetyZoneSpec).default([]),
    })
    .default({ staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] }),
})
export type MezzanineTier = z.infer<typeof TierSchema>

/**
 * Aksesuarsız bir tier'in `accessories`'i.
 *
 * Zod'un `.default()`'ü GİRDİDE alanı isteğe bağlı yapar ama ÇIKTIDA
 * zorunludur, yani elle bir tier nesnesi yazan her yer (katalog fişleri,
 * panel "tier ekle", testler) bunu taşımak zorunda. Tek bir kaynak: dört
 * boş dizinin dört ayrı kopyası, birine yeni bir aksesuar türü eklendiğinde
 * ötekilerin sessizce geride kalması demekti.
 *
 * Fonksiyon, sabit değil: paylaşılan bir nesne döndürmek, bir çağıranın
 * kendi dizisine push etmesiyle ötekini de değiştirirdi.
 */
export function emptyAccessories(): MezzanineTier['accessories'] {
  return { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] }
}

const DEFAULT_TIERS: MezzanineTier[] = [
  {
    index: 0,
    elevationM: 'auto',
    clearHeightM: 3,
    loadClass: 500,
    floorType: 'WOOD_CHIPBOARD_30',
    accessories: emptyAccessories(),
  },
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
   * Güvertenin şekli — mezzanine-yerel `[x, z]` köşeler, merkezi orijinde.
   *
   * `null` (varsayılan) → `grid`den çıkan dikdörtgen. Bu, alanın eklenmesinden
   * ÖNCE kaydedilmiş her sahnenin davranışını birebir koruyor: poligon
   * yoksa hesap eskisinin aynısı.
   *
   * **`grid` ortadan kalkmıyor**, anlamı daralıyor: artık güvertenin
   * SINIRINI değil KOLON ARALIĞINI tanımlıyor. Kolonlar ızgarada duruyor
   * ama yalnız poligonun içinde kalanlar çiziliyor — gerçek bir mezzanine de
   * böyle kurulur, kolonlar keyfî yerlere değil bir aksa oturur.
   *
   * En az üç köşe; ikisi bir alan tarif etmiyor.
   */
  polygon: z
    .array(z.tuple([z.number(), z.number()]))
    .min(3)
    .nullable()
    .default(null),

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
