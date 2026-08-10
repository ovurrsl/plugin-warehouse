import type { AnyNode } from '@pascal-app/core'

/**
 * Sahne ağacındaki satır adı.
 *
 * ## Neden gerekliydi
 *
 * Her kind `defaults()` içinde TEK bir sabit ad yazıyordu — rafta "Pallet
 * Rack", tezgâhta "Bench", rotada "Yaya Yolu" — ve altı tezgâh fişi de aynı
 * "Bench"i üretiyordu. Kullanıcının bildirdiği "lower rack ile pallet rack
 * aynı isimde görünüyor" bunun yalnız en görünür örneği; sorun on iki kind'da
 * aynı desende.
 *
 * Dahası, o sabit adlar bizim düğümlerimize hiç YAZILMIYOR: `defaults()`'ı
 * host'un kendi araçları çağırıyor, eklentinin araçları düğümü şemadan
 * kuruyor, ve `BaseNode.name` varsayılansız. Yani bugün her warehouse
 * düğümünün `name`'i `undefined` ve ağaç `presentation.label`'a düşüyor —
 * kind başına tek bir dizgi. Yirmi rafın yirmi satırı birebir aynı.
 *
 * ## Kural
 *
 * Kullanıcının verdiği ad her şeyi yener. Yalnız ad yokken düğümün kendi
 * alanlarından bir ad türetiliyor, ve türetilen ad AYIRT EDİCİ olanı söylüyor
 * — fişte hangi ürüne basıldıysa o.
 *
 * Türetme dinamik olduğu için varyantı sonradan değiştirmek satırı da
 * değiştiriyor. Adı `defaults()`'a yazmak bunu yapamazdı: yerleştirme anında
 * donar, kullanıcı rafı alçak rafa çevirir, satır eski adı söylemeye devam
 * ederdi.
 *
 * ## Bugün görünmüyor
 *
 * `site-panel/tree-node.tsx` eklenti türlerini haritasında bulamayıp satırı
 * hiç çizmiyor (`if (!Component) return null`), yani bu etiketleri okuyan
 * `RegistryTreeNode`'a sıra gelmiyor. Host tarafındaki tek satırlık düzeltme
 * ayrı bir iş; burada hazır duruyor ki o satır düşünce liste on iki özdeş
 * ad yerine ürün adlarıyla açılsın.
 */
export function treeLabel<N>(derive: (node: N) => string) {
  return (node: AnyNode): string => {
    const named = (node as { name?: unknown }).name
    if (typeof named === 'string' && named.trim() !== '') return named
    return derive(node as N)
  }
}
