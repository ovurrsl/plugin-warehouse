import { describe, expect, test } from 'bun:test'
import { memoizeSlabSupport } from './host-tune'

/**
 * Sarmalayıcının üç sessiz hata modu, üçü de burada kilitli:
 * tabloyu görmeyen önbellek BAYAT cevap verirdi (silinen döşemenin desteği
 * hortlardı), canlı sürüklemeyi görmeyen önbellek sürükleme boyunca duvarı
 * eski kotta DONDURURDU, ve hiç önbelleklemeyen sarmalayıcı da sessizce
 * "kurulu ama işe yaramaz" olurdu. Üçü de kullanıcıya hata olarak değil,
 * yanlış geometri ya da yavaşlık olarak görünür.
 */
describe('memoizeSlabSupport', () => {
  const deps = (nodes: () => object, busy: () => boolean) => ({ nodesOf: nodes, liveBusy: busy })

  test('aynı tablo + aynı argümanlar = tek gerçek çağrı', () => {
    let calls = 0
    const table = {}
    const fn = memoizeSlabSupport(
      (...args: unknown[]) => {
        calls++
        return { got: args }
      },
      deps(
        () => table,
        () => false,
      ),
    )
    const a = fn('level-1', [0, 0], [4, 0], 0, 0.1)
    const b = fn('level-1', [0, 0], [4, 0], 0, 0.1)
    expect(calls).toBe(1)
    expect(b).toBe(a)
    // Farklı argüman farklı sorgudur.
    fn('level-1', [0, 0], [8, 0], 0, 0.1)
    expect(calls).toBe(2)
  })

  test('düğüm tablosunun kimliği değişince önbellek ölür', () => {
    let calls = 0
    let table = {}
    const fn = memoizeSlabSupport(
      () => ++calls,
      deps(
        () => table,
        () => false,
      ),
    )
    fn('x')
    fn('x')
    expect(calls).toBe(1)
    table = {} // sahneye yazıldı: store yeni nesne döndürür
    fn('x')
    expect(calls).toBe(2)
  })

  test('canlı sürükleme sırasında önbellek tamamen atlanır', () => {
    let calls = 0
    let busy = true
    const table = {}
    const fn = memoizeSlabSupport(
      () => ++calls,
      deps(
        () => table,
        () => busy,
      ),
    )
    fn('x')
    fn('x')
    // Sürükleme akarken her sorgu gerçek: host canlı kayıtları sorgunun
    // İÇİNDE okuyor, önbellek o akışı göremez.
    expect(calls).toBe(2)
    busy = false
    fn('x')
    fn('x')
    expect(calls).toBe(3)
  })

  test('bağımlılık patlarsa sarmalayıcı orijinale düşer — hata modu "yavaş", "yanlış" değil', () => {
    let calls = 0
    const fn = memoizeSlabSupport(
      () => ++calls,
      deps(
        () => {
          throw new Error('host şekli değişti')
        },
        () => false,
      ),
    )
    expect(fn('x')).toBe(1)
    expect(fn('x')).toBe(2)
  })
})
