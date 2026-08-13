import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useWarehouseStore, WAREHOUSE_PREFERENCE_PERSISTENCE } from './store'

/**
 * BEKÇİ: kalıcılık iki alanla sınırlı ve bozuk kaydı ayıklıyor.
 *
 * ## Neden var
 *
 * "Toplu çizim" ve LOD kolu makineye özgü render ayarları; her yenilemede
 * varsayılana dönmeleri, tümleşik GPU'lu kullanıcının kıstığı detayın sessizce
 * geri açılması demekti. İkisi artık `warehouse-preferences` altında kalıcı.
 *
 * ## Neden seçenekler export edilip doğrudan ölçülüyor
 *
 * zustand v5, `localStorage` yoksa — bun altında yok — `persist`'i sessizce
 * düz store'a düşürüyor ve `store.persist` API'sini hiç takmıyor. Seçenekleri
 * çalışan store'dan okumak bu ortamda mümkün değil; o yüzden adlandırılmış
 * export ölçülüyor, store'un onları gerçekten kullandığı da kaynaktan
 * tutuluyor.
 *
 * ## İki tehlike
 *
 * 1. **Genişleme.** `partialize` kalkarsa zustand HER ŞEYİ yazar — fırçalar
 *    dahil. Bir hafta önceki kayıtlı fırçanın yerleştirme sırasında kullanıcıyı
 *    şaşırtması, kazandırdığı tek tıktan pahalı.
 * 2. **Bozuk kayıt.** localStorage kullanıcı verisidir. Bozuk `lodQuality`
 *    fırlatmaz: `lodScaleSq` tabloda `undefined` bulur, k² NaN olur ve mesafe
 *    katmanları — ayarın var olma sebebi — sessizce devre dışı kalır.
 */

const { name, partialize, merge } = WAREHOUSE_PREFERENCE_PERSISTENCE

describe('depo tercihleri kalıcılığı', () => {
  test('anahtar adı sabit', () => {
    // Ad, kullanıcıların tarayıcısındaki veriyi adresliyor; değişirse herkesin
    // tercihi bir kere "kaybolur". Bilerek değiştirilecekse bu satır da
    // bilerek değişmeli.
    expect(name).toBe('warehouse-preferences')
  })

  test('yalnız iki render ayarı yazılıyor — fırçalar asla', () => {
    const persisted = partialize(useWarehouseStore.getState())

    // `toEqual` kümenin TAMAMINI sabitliyor: üçüncü bir anahtar eklenirse
    // burada kırmızı yanar ve ekleyen, yukarıdaki gerekçeyle yüzleşir.
    expect(persisted).toEqual({
      instancingEnabled: useWarehouseStore.getState().instancingEnabled,
      lodQuality: useWarehouseStore.getState().lodQuality,
    })
  })

  test('geçerli kayıt geri yükleniyor', () => {
    const current = useWarehouseStore.getState()
    const merged = merge({ instancingEnabled: false, lodQuality: 'near' }, current)

    expect(merged.instancingEnabled).toBe(false)
    expect(merged.lodQuality).toBe('near')
    // Kalıcı olmayan alanlar mevcut hâlden geliyor.
    expect(merged.rackBrush).toBe(current.rackBrush)
  })

  test.each([
    ['bozuk lodQuality', { lodQuality: 'ultra' }],
    ['sayı instancing', { instancingEnabled: 1 }],
    ['null kayıt', null],
    ['dizi kayıt', ['garbage']],
  ])('bozuk kayıt (%s) varsayılana düşüyor', (_label, persisted) => {
    const current = useWarehouseStore.getState()
    const merged = merge(persisted, current)

    expect(merged.instancingEnabled).toBe(current.instancingEnabled)
    expect(['near', 'balanced', 'wide']).toContain(merged.lodQuality)
  })

  /**
   * Export ile store arasındaki bağ. Seçenekler ne kadar doğru olursa olsun,
   * `persist(...)` çağrısı onları kullanmıyorsa hiçbir şey kalıcı değildir —
   * ve bu ayrışma derlenir, tip verir, yukarıdaki her testi geçer.
   */
  test('store bu seçenekleri gerçekten persist ediyor', () => {
    const source = readFileSync(join(import.meta.dir, 'store.ts'), 'utf8')
    expect(source).toContain('persist(')
    expect(
      /persist\(\s*\(set, get\) => \(\{[\s\S]*WAREHOUSE_PREFERENCE_PERSISTENCE,\s*\)/m.test(source),
    ).toBe(true)
  })
})
