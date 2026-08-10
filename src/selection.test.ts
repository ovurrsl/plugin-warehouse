import { describe, expect, test } from 'bun:test'
import { isSelected } from './selection'

/**
 * Kimlik memo'sunun sessiz hatası BAYAT KÜME: yeni bir dizi geldiği hâlde
 * eskisinin cevabı verilirse hiçbir şey patlamaz — seçim çerçevesi bir önceki
 * seçimin üstünde kalır ve kullanıcı "tıkladım, seçilmedi" der. Kimlik
 * karşılaştırması yerine uzunluk gibi bir vekil kullanmak tam olarak bunu
 * üretir, o yüzden asıl bekçi aşağıdaki "aynı uzunluk, farklı içerik" hâli.
 */

/**
 * `new Set(...)` dizinin yineleyicisini çağırır — sayaç, kümenin KAÇ KEZ
 * kurulduğunun tek dışarıdan gözlemlenebilir kanıtı.
 */
function countingIds(ids: string[]): { ids: readonly string[]; builds: () => number } {
  const array = ids.slice()
  let builds = 0
  const iterate = array[Symbol.iterator].bind(array)
  Object.defineProperty(array, Symbol.iterator, {
    value: () => {
      builds++
      return iterate()
    },
  })
  return { builds: () => builds, ids: array }
}

describe('isSelected', () => {
  test('dizi kimliği aynıyken küme yeniden KURULMAZ', () => {
    // Kazancın tamamı burada: seçim kımıldamadan gelen her store yazımı tek
    // referans karşılaştırmasına inmeli, yeni bir Set'e değil.
    const { builds, ids } = countingIds(['a', 'b', 'c'])
    for (const id of ['a', 'b', 'c', 'yok', 'a']) isSelected(ids, id)
    expect(builds()).toBe(1)
  })

  test('AYNI UZUNLUKTA farklı içerikli yeni dizi bayat cevap vermez', () => {
    expect(isSelected(['a', 'b'], 'a')).toBe(true)
    expect(isSelected(['c', 'd'], 'a')).toBe(false)
    expect(isSelected(['c', 'd'], 'c')).toBe(true)
  })

  test('aynı içerikli yeni dizi de doğru cevap verir', () => {
    // Host seçim yazmasa da diziyi tazeleyebilir; kimlik değişince küme
    // yeniden kurulur ve cevap değişmez.
    expect(isSelected(['x', 'y'], 'y')).toBe(true)
    expect(isSelected(['x', 'y'], 'y')).toBe(true)
  })

  test('boş seçimde hiçbir düğüm seçili değil', () => {
    expect(isSelected(['a'], 'a')).toBe(true)
    expect(isSelected([], 'a')).toBe(false)
  })
})
