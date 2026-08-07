/**
 * Geometri anahtarı üreticileri için düğüm-nesnesine memoizasyon.
 *
 * `rack/geometry-builder.ts`'in ölçülmüş deseninin (41×, commit 28e63c7)
 * paylaşılan hâli: host store değişen düğümü YERİNDE değiştirmez, yenisiyle
 * değiştirir — yani düğüm nesnesinin kimliği "bu alanlar kımıldamadı" demektir
 * ve anahtar bir kez kurulup nesneye iliştirilebilir. Anahtar üreticileri
 * mount başına dört, her re-render'da iki kez çağrılıyor (`useCollective`
 * kaydı + geometri tutma) ve bir depoda binlerce düğüm aynı birkaç dizgeye
 * çözülüyor; memo'suz her çağrı seviye yapısını sıfırdan geziyordu.
 *
 * `variantOf` düğüm DIŞINDAKİ argümanları tek dizgeye indirir — katman ve
 * komşuluk gibi, bir düğüm için meşru olarak değişebilen eksenler. Düğüm
 * başına girdi sayısı varyant sayısıyla sınırlı kalır (rafta en çok dört).
 *
 * Tehlike `CLAUDE.md`'nin adlandırdığı: yerinde mutasyona uğrayan bir düğüm
 * bayat anahtar döndürür ve görünüşte farklı iki düğüm tek geometriyi
 * paylaşır. Kapsama testleri memoize yol üzerinden koşmaya devam ettiği
 * sürece bu sınıf hata orada yakalanır.
 */
type RestOf<F> = F extends (node: infer _N, ...rest: infer R) => string ? R : never

/** Dönüş tipi `F`'in KENDİSİ: üreticinin varsayılanlı (isteğe bağlı) argüman
 *  imzası sarmalayıcıda aynen korunur — iki argümanlı test çağrıları da,
 *  üç argümanlı renderer çağrıları da derlenmeye devam eder. */
export function memoiseGeometryKey<F extends (...args: never[]) => string>(
  build: F,
  variantOf: (...rest: RestOf<F>) => string,
): F {
  const cache = new WeakMap<object, Map<string, string>>()
  const memoised = (node: object, ...rest: unknown[]): string => {
    const variant = (variantOf as unknown as (...rest: unknown[]) => string)(...rest)
    let byVariant = cache.get(node)
    if (byVariant) {
      const hit = byVariant.get(variant)
      if (hit !== undefined) return hit
    } else {
      byVariant = new Map()
      cache.set(node, byVariant)
    }
    const key = (build as unknown as (node: object, ...rest: unknown[]) => string)(node, ...rest)
    byVariant.set(variant, key)
    return key
  }
  return memoised as unknown as F
}
