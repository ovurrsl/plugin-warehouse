/**
 * Mezzanine güvertelerinin host `slab` karşılıkları.
 *
 * **Neden slab?** Host'ta "üstüne bir şey konabilen yüzey" olmanın tek yolu
 * `slab` tipinde olmaktır: `spatialGridManager` yalnız `type === 'slab'`
 * düğümlerini `slabsByLevel` haritasına alır, ve `getSlabSupportForItem` /
 * `getPointedSupportSurface` / `getSupportCandidatesForFootprint` üçlüsünün
 * tamamı yalnız o haritayı okur. Kayıt API'si yok. Dolayısıyla mezzanine'in
 * güvertesine raf/palet/konveyör konabilmesinin tek yolu, her tier için
 * gerçek bir slab düğümü yayınlamaktır.
 *
 * Bunun karşılığında iki şey BEDAVA geliyor ve ikisi de kullanıcının açıkça
 * istediği şeydi:
 *
 *   1. **Host katı farkındalığı** — destek sorgularının hepsi `levelId` ile
 *      süzülür, yani başka bir kattaki mezzanine'in güvertesi hiç aday
 *      olmaz.
 *   2. **Tier seçimi** — `getPointedSupportSurface` imleç ışınının kestiği
 *      EN YAKIN slab düzlemini seçer, yani kullanıcı hangi tier'e nişan
 *      alırsa oraya yerleşir; ayrı bir "kat seç" kontrolü gerekmez.
 *
 * **Slab kat düğümünün çocuğudur, mezzanine'in değil.** `spatialGridManager`
 * poligonu kat-yerel çerçevede saklar ve mezzanine'in `position`/`rotation`
 * dönüşümünü UYGULAMAZ; mezzanine'in altına asılsaydı çizilen yüzey ile
 * seçim matematiği birbirinden kayardı. Bu yüzden dönüşümü burada, poligon
 * noktalarına baştan uyguluyoruz.
 *
 * Saf: three yok, React yok, store yazımı yok.
 */

import { FLOOR_TYPES } from './catalog'
import { outlinePolygon, pointInPolygon, resolveTierElevations } from './metrics'
import { tierVoidRects } from './railing'
import type { MezzanineNode } from './schema'
import type { Rect } from './stairs'

/** Host'un düzenleme-zamanı slab kalınlık tabanı (`MIN_SLAB_THICKNESS`). */
const MIN_SLAB_THICKNESS_M = 0.02

/**
 * "Taşıyıcı bir slab değil, katın tabanı" anlamına gelen kalıcı sentinel.
 *
 * Host'ta `GROUND_SUPPORT_ID` diye dışa açılıyor, ama BİLEREK kopyalandı:
 * bu eklentinin peer aralığı `@pascal-app/core >=0.9.2` ve o sabit 0.9.2'de
 * DIŞA AÇIK DEĞİL. Import etseydik eski bir core'a kurulumda değer
 * `undefined` olurdu, `supportSlabId` boş kalırdı ve tam olarak engellemek
 * için yazdığımız kendi-üstüne-tırmanma hatası geri gelirdi — üstelik
 * sessizce.
 *
 * Bu bir API değil, DİSKE YAZILAN bir değer: sahne dosyalarında duruyor,
 * dolayısıyla host'un onu değiştirmesi zaten kendi kayıtlı sahnelerini
 * bozardı. Kopyalamanın güvenli olmasının sebebi bu.
 */
export const GROUND_SUPPORT_ID = 'ground'

/**
 * Türetilmiş güverte slab'ının sahiplik kaydı — `BaseNode.metadata` içinde.
 *
 * **Kimlik AYRIŞTIRILMIYOR.** Sahibi düğüm kimliğinden okumak cazip
 * görünüyor (`slab_mezzdeck0-mezzanine_a1b2`), ama bu repoda tam olarak o
 * hata bir kez ısırdı: kimlik önekleri yanlış alt çizgiden bölünüyordu
 * (`83517b3c`). Sahiplik açık bir alanda duruyor, kimlik yalnız kararlılık
 * için deterministik.
 */
export const DECK_OWNER_KEY = 'warehouseMezzanineDeck'

export type DeckOwner = { mezzanineId: string; tierIndex: number }

/** Bir düğümün türetilmiş güverte olup olmadığı ve sahibi. */
export function deckOwnerOf(node: unknown): DeckOwner | null {
  const metadata = (node as { metadata?: Record<string, unknown> } | null)?.metadata
  const record = metadata?.[DECK_OWNER_KEY] as Partial<DeckOwner> | undefined
  if (!record) return null
  if (typeof record.mezzanineId !== 'string' || typeof record.tierIndex !== 'number') return null
  return { mezzanineId: record.mezzanineId, tierIndex: record.tierIndex }
}

/** Aynı (mezzanine, tier) için her zaman aynı kimlik — uzlaştırıcıyı
 *  idempotent yapan şey budur. */
export function deckSlabId(mezzanineId: string, tierIndex: number): string {
  return `slab_mezzdeck${tierIndex}-${mezzanineId}`
}

export type DeckSlabSpec = {
  id: string
  tierIndex: number
  /** Kat-yerel [x, z] köşeler — mezzanine dönüşü UYGULANMIŞ. */
  polygon: [number, number][]
  /** Merdiven boşlukları; host bunları gerçek delik olarak keser, yani
   *  boşluğun üstüne raf seçilemez. */
  holes: [number, number][][]
  /** Yürüme yüzeyi, kat-yerel metre. */
  elevation: number
  thickness: number
}

/**
 * Mezzanine yerelinden kat-yereline.
 *
 * Three'nin Y-dönme kuralı — renderer'ın güverteyi içine koyduğu
 * `<group rotation={[0, rotationY, 0]}>` ile AYNI olmak zorunda:
 * yerel (x, z) → (x·cos + z·sin, −x·sin + z·cos). Ayrışırlarsa güverte
 * çizildiği yerde seçilmez; kullanıcı gördüğü yüzeye nişan alır, raf
 * başka yere oturur. Test 90°'de genişlik/derinlik takasını doğruluyor.
 */
function toLevelLocal(node: MezzanineNode, localX: number, localZ: number): [number, number] {
  const [px, , pz] = node.position ?? [0, 0, 0]
  const rotationY = node.rotation?.[1] ?? 0
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [px + localX * cos + localZ * sin, pz - localX * sin + localZ * cos]
}

/**
 * Kat-yerel bir nokta bu mezzanine'in taban izinin içinde mi.
 *
 * `toLevelLocal`in tersi. Yerleştirme yolu bunu kullanıyor: kullanıcı bir
 * güverteyi hedef seçtiğinde, tıklama o mezzanine'in üstünde değilse hedef
 * yok sayılmalı — yoksa binanın öbür ucuna konan bir palet de güverteye
 * uçardı.
 */
export function mezzanineContains(node: MezzanineNode, x: number, z: number): boolean {
  const [px, , pz] = node.position ?? [0, 0, 0]
  const rotationY = node.rotation?.[1] ?? 0
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const dx = x - px
  const dz = z - pz
  // `toLevelLocal`in tersi.
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos
  // Güvertenin GERÇEK şekli — L şeklinin çentiğine tıklamak güverteyi
  // hedeflememeli, orada güverte yok.
  return pointInPolygon(localX, localZ, outlinePolygon(node))
}

function rectToPolygon(node: MezzanineNode, rect: Rect): [number, number][] {
  return [
    toLevelLocal(node, rect.x0, rect.z0),
    toLevelLocal(node, rect.x1, rect.z0),
    toLevelLocal(node, rect.x1, rect.z1),
    toLevelLocal(node, rect.x0, rect.z1),
  ]
}

/**
 * Her tier için bir güverte slab'ı.
 *
 * `baseElevationM` mezzanine'in kendi tabanının kat-yerel kotu — host
 * `getFloorPlacedElevation` ile hesaplar, biz burada saf kalabilmek için
 * parametre olarak alıyoruz. Düz zeminde 0'dır.
 */
export function deckSlabSpecs(node: MezzanineNode, baseElevationM: number): DeckSlabSpec[] {
  // Güverte slab'ının poligonu güverteNİN kendi şekli. Dikdörtgen varsaymak,
  // L şeklinde bir mezzanine'in boşluğuna da raf konabilmesi demekti.
  const outline: [number, number][] = outlinePolygon(node).map(([x, z]) => toLevelLocal(node, x, z))

  return resolveTierElevations(node.tiers).map((tier) => {
    const thickness = Math.max(MIN_SLAB_THICKNESS_M, FLOOR_TYPES[tier.floorType].structuralDepthM)
    // Merdiven bu tier'e ALTINDAKİNDEN çıkar — `parts.ts`'in aynı hesabı.
    const elevationDelta = tier.deckTopM - tier.resolvedElevationM
    const voids = tierVoidRects(node, tier, elevationDelta)

    return {
      id: deckSlabId(node.id, tier.index),
      tierIndex: tier.index,
      polygon: outline,
      holes: voids.map((rect) => rectToPolygon(node, rect)),
      elevation: baseElevationM + tier.deckTopM,
      thickness,
    }
  })
}
