'use client'

import { useLayoutEffect } from 'react'
import type { Object3D } from 'three'

/**
 * Bir nesneyi three'nin her-kare matris hesabından çıkarır: yerel matrisi bir
 * kez basar, sonra bayrağı kapatır.
 *
 * ## Dönüşümsüz bir sarmalayıcı neden bedava DEĞİL
 *
 * `Object3D.updateMatrixWorld` (three 0.185, `src/core/Object3D.js:1165`) her
 * karede önce `if (this.matrixAutoUpdate) this.updateMatrix()` yapıyor (`:1167`),
 * `updateMatrix` de son satırında `matrixWorldNeedsUpdate = true` yazıyor
 * (`:1150`). Hemen ardından gelen `if (this.matrixWorldNeedsUpdate || force)`
 * bloğu dünya matrisini yeniden çarpıyor (`:1179`) ve çıkarken `force = true`
 * yapıyor (`:1187`) — bu bayrak ÇOCUKLARA yayılıyor (`:1199`).
 *
 * Sezgiye aykırı sonuç: konumu, dönüşü, ölçeği hiç yazılmamış — yani matrisi
 * zaten birim olan — bir `<group>` bile her karede kendi `compose`'unu yapıyor
 * VE altındaki DONMUŞ çocukların `multiplyMatrices`'ini tetikliyor. Çocuğun
 * `matrixAutoUpdate = false` olması onu yalnız kendi `compose`'undan kurtarıyor;
 * `force` geldiği sürece dünya çarpımından kurtarmıyor.
 *
 * Yani `collider.tsx` ile dondurulan çarpıştırıcıların ve
 * `static-transform.ts` ile dondurulan kayıtlı grupların kazancı, üstlerinde
 * auto-update bir sarmalayıcı kaldığı sürece yarı yarıya geri veriliyor:
 * `compose` gidiyor, `multiplyMatrices` kalıyor.
 *
 * ## Ne zaman KULLANILMAZ
 *
 * Kımıldayan bir nesnede değil. Bayrak kapalıyken `position`'a yazmak yerel
 * matrise hiç işlemiyor — sürüklenen ya da host tarafından yükseltilen bir
 * düğümün doğru aracı `static-transform.ts`, o sürükleme penceresinde bayrağı
 * three'ye geri veriyor.
 */
export function freezeMatrix(object: Object3D): void {
  object.matrixAutoUpdate = false
  object.updateMatrix()
}

/**
 * Dönüşümsüz bir sarmalayıcıyı mount'ta dondurur.
 *
 * Bağımlılık listesi boş, ve boş olması doğru — eksik değil: sarmalayıcı
 * dönüşümsüz kuruluyor ve ömrü boyunca kımıldamıyor, yani yeniden basılacak bir
 * değer yok. (Konumu değişen bir nesnenin bağımlılıkla dondurulmuş hâli
 * `collider.tsx`'teki `Collider`, canlı sürüklenenin hâli
 * `static-transform.ts`.)
 */
export function useFrozenMatrix(ref: { current: Object3D | null }): void {
  useLayoutEffect(() => {
    const object = ref.current
    if (object) freezeMatrix(object)
  }, [])
}
