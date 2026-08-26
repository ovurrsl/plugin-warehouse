import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { PALLET_PRESET_IDS } from '../pallet/presets'
import { CAPACITY_CLASSES } from './catalog'

/**
 * Palet asansörü — mastlı (2-4 kolonlu), zincir tahrikli, platformunda entegre
 * rulo konveyör taşıyan çok katlı dikey palet taşıma sistemi (EN 1570-1/-2).
 *
 * ## KAT SAYISI BİR ALAN DEĞİL
 *
 * Asansörün hizmet verdiği katlar şemada TUTULMUYOR: host editörünün asansör
 * kind'ının yaptığının aynısı, katlar binanın `level` çocuklarından
 * türetiliyor (`levels.ts` → `host-adapter.ts levelElevationsOfBuilding`).
 * Sabit bir kat sayısı yazmak, binadan bağımsız — ve bina değişince yanlış —
 * bir makine çizerdi. `fromLevelId`/`toLevelId` yalnız hizmet ARALIĞINI
 * kısıtlar (host asansör deseni); ikisi de null ise bütün istif servis edilir.
 *
 * Ölçüler `mm × 0.001`; yayınlanmış olmayan her sayı `catalog.ts`'te VARSAYIM
 * olarak işaretli. Kaynaklar: Mecalux, SSI Schäfer, PFlow, Ekol/Avemak/İdas.
 */
export const PalletLiftNode = BaseNode.extend({
  id: objectId('pallet-lift'),
  type: nodeType('warehouse:pallet-lift'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /**
   * Kapasite kademesi, kg — dikey hızı ve mast kesitini seçer (spec §4,
   * `catalog.ts`). 1000/1500 kg hızları YAYINLANMIŞ; 4500 kg VARSAYIM.
   * Geometriyi doğrudan bölmez: çözülmüş sonuçları (mast kesiti) taşır.
   */
  capacityClass: z.enum(CAPACITY_CLASSES).default('1000'),

  /**
   * Taşınan palet tipi — palet ailesinin ortak preset enum'undan
   * (`pallet/presets.ts`), iki şemanın da tek listeden doğrulanması için.
   * Platform ölçüsü = palet ölçüsü + 2 × açıklık payı (spec §3, VARSAYIM).
   */
  palletPreset: z.enum(PALLET_PRESET_IDS).default('epal-1'),

  /**
   * Mast (kılavuz kolon) sayısı. Spec §1: 2-4 kolon. `4500` kapasite `4` mast
   * zorunlu kılar (parametrics invariant'ı); `parametrics.ts` bunu kilitler.
   */
  mastCount: z.enum(['2', '4']).default('2'),

  /**
   * Hizmet aralığının alt/üst kat kimliği — host asansör deseni
   * (`elevator-service.ts`). null ise o uç açık; ikisi de null ise binanın
   * bütün istifi servis edilir. Kimlik olduğu için `ref` alanı (level seçici)
   * ile panelden düzenlenir.
   */
  fromLevelId: z.string().nullable().default(null),
  toLevelId: z.string().nullable().default(null),

  /**
   * `fromLevelId` ve `toLevelId` alanlarının alternatif/eşanlamlı takma adları
   * (StairNode / ElevatorNode / ConveyorSpiralNode paritesi).
   */
  baseLevelId: z.string().nullable().default(null),
  topLevelId: z.string().nullable().default(null),

  /**
   * Çok katlı erişim ve varsayılan durak metadatası (host ElevatorNode paritesi).
   */
  defaultLevelId: z.string().nullable().default(null),
  disabledLevelIds: z.array(z.string()).default([]),
  serviceOnlyLevelIds: z.array(z.string()).default([]),

  /**
   * İki kattan azı çözüldüğünde (bina dışına konmuş / tek katlı sahne) kullanılan
   * yedek seyahat yüksekliği, metre — SEÇİLMİŞ VARSAYILAN. Bina katları
   * çözülürse OKUNMAZ.
   */
  fallbackTravelM: z.number().min(1.5).max(12).default(3),

  /**
   * `fallbackTravelM` için alternatif/yedek alan.
   */
  travelHeight: z.number().optional(),

  /** Yarı saydam güvenlik muhafazası (spec §2 satır 7). */
  hasEnclosure: z.boolean().default(true),
  /** Kat kapıları/bariyerleri (spec §2 satır 6) — tek panel, YUKARI kayar. */
  hasDoors: z.boolean().default(true),
  /** Yan kontrol panosu (spec §2 satır 8). */
  hasControlPanel: z.boolean().default(true),

  /** Mast ve tahrik gövdesi boyası — RAL 7016 (antrasit). */
  mastColor: z.string().default('#383e42'),
  /** Platform sacı boyası — RAL 7035 (açık gri). */
  platformColor: z.string().default('#d1d3d4'),
  /** Kat kapısı çerçeve/panel boyası — RAL 1003 (sinyal sarı). */
  doorColor: z.string().default('#e8b200'),

  supportSlabId: z.string().nullable().default(null),
})

export type PalletLiftNode = z.infer<typeof PalletLiftNode>
