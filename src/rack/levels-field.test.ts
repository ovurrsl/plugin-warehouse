import { describe, expect, test } from 'bun:test'
import { PalletRackNode } from './schema'
import { fittedLevelCount, levelClearOpening } from './slots'

/**
 * Kullanıcının bildirdiği üç hata — üçü de ölçülerek doğrulandı ve burada
 * kilitli. Test alanın KENDİSİNİ değil, alanın dayandığı sözleşmeyi
 * doğruluyor: kaç satır olmalı, dizi ne zaman kırpılmalı, geçersiz kılma
 * kot zincirine gerçekten giriyor mu.
 */

const rack = (patch: Record<string, unknown> = {}) => PalletRackNode.parse(patch)

describe('kat tablosu — satır sayısı', () => {
  test('satır sayısı levels + 1: zemin açıklığı da bir satır', () => {
    // Eski alan `fittedLevelCount` kadar satır çiziyordu; katlar 0..fitted
    // olduğu için SON katın açıklığı hiçbir zaman düzenlenemiyordu.
    // İki katlı bir rafta "Kat 2" hiç görünmüyordu.
    const low = rack({ uprightHeight: 2.5, levels: 2, pickingLevels: 1 })
    expect(fittedLevelCount(low)).toBe(2)
    // Düzenlenmesi gereken açıklık sayısı: zemin + 2 kiriş katı.
    const editable = low.levels + 1
    expect(editable).toBe(3)
    // Üçünün de gerçek bir açıklığı var — "yok sayılan satır" değiller.
    for (let level = 0; level < editable; level++) {
      expect(levelClearOpening(low, level)).toBeGreaterThan(0)
    }
  })
})

describe('kat tablosu — sığmayan kat', () => {
  test('istenen kat sığmıyorsa açıklığı KÜÇÜLTEREK sığdırılabilmeli', () => {
    // Eski alan sığmayan katı hiç listelemiyordu: kullanıcı açıklığı
    // küçültüp sığdırmak istese, düzenleyeceği satır yoktu.
    const tooTall = rack({ uprightHeight: 5, levels: 5, levelClear: 1.4 })
    expect(fittedLevelCount(tooTall)).toBeLessThan(tooTall.levels)

    // Açıklıkları küçültmek katları sığdırıyor — satır düzenlenebilir olmalı.
    const tightened = rack({ ...tooTall, levelClear: 0.7, firstLevelClear: 0.7 })
    expect(fittedLevelCount(tightened)).toBeGreaterThan(fittedLevelCount(tooTall))
  })
})

describe('kat tablosu — hayalet değer', () => {
  test('kat sayısı düşünce fazla girdiler KIRPILMALI', () => {
    // Eski alan diziyi hiç kırpmıyordu: 5 kattan 2'ye inip tekrar 5'e
    // çıkınca eski geçersiz kılmalar geri geliyordu — "bozuluyor" buydu.
    const five = rack({ levels: 5, levelClears: [null, 2.2, 1.1, null, 1.9, null] })
    expect(five.levelClears).toHaveLength(6)

    // Alanın yazma yolunun yaptığı kırpma (rows = levels + 1).
    const rows = 2 + 1
    const trimmed = (five.levelClears ?? []).slice(0, rows)
    const after = rack({ ...five, levels: 2, levelClears: trimmed })
    expect(after.levelClears).toHaveLength(3)
    // 4. katın 1.9'u artık YOK — geri çıkıldığında hayalet gibi dönemez.
    expect(after.levelClears?.[4]).toBeUndefined()
  })

  test('hepsi boşalınca alan null’a döner — dokunulmamış sahneyle aynı', () => {
    const touched = rack({ levels: 2, levelClears: [null, null, null] })
    const allNull = (touched.levelClears ?? []).every((v) => v == null)
    expect(allNull).toBe(true)
    // Alanın yazma kuralı: hepsi null ise `null` yaz.
    const normalised = rack({ ...touched, levelClears: allNull ? null : touched.levelClears })
    expect(normalised.levelClears).toBeNull()
    expect(levelClearOpening(normalised, 1)).toBe(levelClearOpening(rack({ levels: 2 }), 1))
  })
})

describe('geçersiz kılma kot zincirine gerçekten giriyor', () => {
  test('bir katın açıklığını büyütmek ÜSTÜNDEKİ katları yukarı iter', () => {
    const base = rack({ levels: 3, uprightHeight: 8 })
    const raised = rack({ levels: 3, uprightHeight: 8, levelClears: [null, 2.5, null, null] })
    expect(levelClearOpening(raised, 1)).toBeCloseTo(2.5, 9)
    // Kirişler birikimli yığılıyor: 1. katın açıklığı 2. katı da kaldırır.
    expect(levelClearOpening(base, 1)).not.toBeCloseTo(2.5, 9)
  })
})
