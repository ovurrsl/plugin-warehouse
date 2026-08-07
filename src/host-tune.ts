import {
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'

/**
 * Host'un `spatialGridManager.getSlabSupportForWall`'una çalışma zamanı
 * memoizasyonu — EDİTÖRE DOKUNMADAN.
 *
 * ## Neden buradan, neden bu yöntemle
 *
 * Ölçüm (kullanıcının izleri, 2026-08-07, Güzeller sahnesi): kamera hareketi
 * sırasında host'un duvar sistemleri her duvarı tazeliyor ve duvar başına
 * `getSlabSupportForWall` koşuyor; içindeki `computeWallSlabSupport` döngüsü
 * tek başına kare CPU'sunun ~%15'i. Sorgunun cevabı iki tazeleme arasında
 * DEĞİŞMİYOR — duvarlar kımıldamıyor, döşemeler kımıldamıyor; değişen yalnız
 * kamera. Aynı soruya her seferinde sıfırdan cevap üretiliyor.
 *
 * Temiz çözüm host'ta yaşar (`storey.ts` / `wall-cutout` memoizasyonu) ve
 * upstream'e ayrıca önerilecek; ama kullanıcının kararı fork'un integration
 * dalına upstream diff'i sokmamak. Eklentiden erişilebilir olan tek nokta bu:
 * host bu sorguyu bir SINGLETON NESNENİN METODU üzerinden çağırıyor
 * (`spatialGridManager.getSlabSupportForWall(...)`, hem `wall-system` hem
 * `wall-cutout`), ve nesne metodu çalışma zamanında sarmalanabilir. Serbest
 * fonksiyon importları (ör. `getWallPlaneTop` → `getLevelElevations`)
 * SARMALANAMAZ — ES modül bağları çağrı anında çözülür; o maliyetin
 * eklenti-tarafı cevabı düğüm sayısını küçültmek (bake).
 *
 * ## Doğruluk sınırları — bu sarmalayıcının sözleşmesi
 *
 * - **Önbellek yalnız sahne yazısına kadar yaşar.** Store her yazışta `nodes`
 *   nesnesini değiştirir; kimlik değişince önbellek tamamen boşalır. Yanlış
 *   cevabın yaşayabileceği en uzun süre, bir sahne yazısının süresidir: sıfır.
 * - **Canlı sürükleme sırasında tamamen devre dışı.** Döşeme/duvar sürüklemesi
 *   store'a yazmadan `useLiveNodeOverrides` / `useLiveTransforms` üzerinden
 *   akar ve host bu sorgunun İÇİNDE onları okur — önbellek o akışı göremez.
 *   Herhangi bir canlı kayıt varken sorgu doğrudan orijinale gider; sürükleme
 *   hızı bugünkünden kötüleşmez, sadece iyileşmez.
 * - **Host imzayı değiştirirse sarmalayıcı hiç kurulmaz.** Kurulum, metodu ve
 *   store'ları çalışma zamanında yoklar (CLAUDE.md'nin host-şeması kuralıyla
 *   aynı ruh: sürüm korumalı olmayan her host okuması koruma arkasında).
 *   Şüphede kalan her yol orijinali çağırır — sarmalayıcının hata modu
 *   "yavaş", asla "yanlış".
 */

type SlabSupportFn = (...args: unknown[]) => unknown

type MemoDeps = {
  /** Sahne düğüm tablosunun kimliği — değişince önbellek ölür. */
  nodesOf: () => object
  /** Canlı sürükleme var mı — varken önbellek tamamen atlanır. */
  liveBusy: () => boolean
}

/**
 * Saf sarmalayıcı; kurulumdan ayrık, çünkü test edilmesi gereken davranış
 * bu: aynı argümanlar aynı tabloda tek çağrı, tablo değişince taze çağrı,
 * canlı kayıt varken hiç önbellek.
 */
export function memoizeSlabSupport(original: SlabSupportFn, deps: MemoDeps): SlabSupportFn {
  const cache = new Map<string, unknown>()
  let lastNodes: object | null = null

  return function memoized(this: unknown, ...args: unknown[]): unknown {
    try {
      if (deps.liveBusy()) return original.apply(this, args)
      const nodes = deps.nodesOf()
      if (nodes !== lastNodes) {
        cache.clear()
        lastNodes = nodes
      }
      // Argümanlar küçük: kimlikler, sayılar, [x,z] çiftleri. Stringify'ın
      // maliyeti sorgunun kendisinin binde biri mertebesinde.
      const key = JSON.stringify(args)
      if (cache.has(key)) return cache.get(key)
      const result = original.apply(this, args)
      cache.set(key, result)
      return result
    } catch {
      return original.apply(this, args)
    }
  }
}

/** Kurulumun tuttuğu iz — iki kez sarmalamayı ve testte sızıntıyı önler. */
const INSTALLED = Symbol.for('warehouse.slabSupportMemo')

/**
 * Sarmalayıcıyı gerçek host singleton'ına kur. İdempotent; her koşul
 * sağlanamazsa sessizce hiçbir şey yapmaz (bir performans iyileştirmesinin
 * yokluğu hata değildir).
 */
export function installSlabSupportMemo(): void {
  const manager = spatialGridManager as unknown as Record<PropertyKey, unknown>
  const original = manager.getSlabSupportForWall
  if (typeof original !== 'function') return
  if ((original as unknown as Record<PropertyKey, unknown>)[INSTALLED]) return
  if (typeof useScene?.getState !== 'function') return
  if (typeof useLiveNodeOverrides?.getState !== 'function') return
  if (typeof useLiveTransforms?.getState !== 'function') return

  const wrapped = memoizeSlabSupport(original.bind(manager) as SlabSupportFn, {
    nodesOf: () => useScene.getState().nodes as object,
    liveBusy: () => {
      const overrides = useLiveNodeOverrides.getState().overrides as Map<unknown, unknown>
      if (overrides.size > 0) return true
      const transforms = useLiveTransforms.getState().transforms as Map<unknown, unknown>
      return transforms.size > 0
    },
  })
  ;(wrapped as unknown as Record<PropertyKey, unknown>)[INSTALLED] = true
  manager.getSlabSupportForWall = wrapped
}
