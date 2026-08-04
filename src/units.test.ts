import { describe, expect, test } from 'bun:test'
import {
  getAreaUnitLabel,
  getLinearUnitLabel,
  metersToLinearUnit,
  squareMetersToAreaUnit,
} from '@pascal-app/editor'
import { areaLabel, DEFAULT_UNIT, lengthLabel, lengthValue, unitOf } from './units'

/**
 * Birim çevirisi host'unkiyle AYNI sayıyı vermek zorunda.
 *
 * Bu bir stil tercihi değil: eklentinin paneli host'un panelinin yanında
 * duruyor ve ikisi aynı slab'ın alanını yazıyor. `catalog-panel.tsx` kendi
 * `SQUARE_FEET_PER_SQUARE_METRE = 10.7639` sabitini taşıyordu; host aynı sayıyı
 * `1 / 0.3048`ten türetiyor. Fark altıncı anlamlı basamakta — yani hiçbir zaman
 * "yanlış" görünmüyor, yalnız host'unkinden başka. Fark edilmesi en zor hata
 * biçimi bu, ve bir kopyalanmış sabitin kaçınılmaz sonu.
 */

describe('çeviri host ile birebir aynı', () => {
  test('alan, host’un kendi çevirisinden geçiyor', () => {
    for (const m2 of [0, 1, 12.5, 1234.567, 15000]) {
      const mine = areaLabel(m2, 'imperial', 4)
      const host = `${squareMetersToAreaUnit(m2, 'imperial').toFixed(4)} ${getAreaUnitLabel('imperial')}`
      expect({ m2, mine }).toEqual({ m2, mine: host })
    }
  })

  test('eski kopya sabit host ile aynı DEĞİL', () => {
    /**
     * Kaldırılan sabit `10.7639`; host `1 / 0.3048²`den türetiyor, yani
     * `10.76391041…`. Fark altıncı anlamlı basamakta: 15 000 m²'lik bir depoda
     * 0,16 ft², ve `toFixed(0)` ile yazılan bir panelde çoğu zaman hiç
     * görünmüyor.
     *
     * Kaldırma gerekçesi bu yüzden büyüklük DEĞİL. Bir sabiti kopyalamak, aynı
     * çeviriye ikinci bir tanım vermek demek: host `METERS_PER_FOOT`unu bir gün
     * daha kesin yazsa ya da başka bir yuvarlama seçse, buradaki kopya sessizce
     * ayrışır ve iki panel aynı slab için iki sayı gösterir. Test büyüklüğü
     * değil, ikinci tanımın var olduğunu kilitliyor.
     */
    const REMOVED = 10.7639
    const host = squareMetersToAreaUnit(1, 'imperial')
    expect(host).not.toBe(REMOVED)
    expect(Math.abs(host - REMOVED)).toBeLessThan(1e-4)
  })

  test('uzunluk, host’un kendi çevirisinden geçiyor', () => {
    for (const m of [0, 0.144, 2.6, 10.3, 260]) {
      expect(lengthLabel(m, 'imperial')).toBe(
        `${metersToLinearUnit(m, 'imperial').toFixed(2)} ${getLinearUnitLabel('imperial')}`,
      )
      expect(lengthLabel(m, 'metric')).toBe(`${m.toFixed(2)} m`)
    }
  })

  test('metrik yol sayıyı HİÇ değiştirmiyor', () => {
    // Sahne metre saklıyor; metrik kullanıcı için çeviri kimlik olmalı, yoksa
    // yuvarlama sahnedeki değerden sapmaya başlar.
    for (const m of [1 / 3, 2.675, 99.995]) {
      expect(lengthValue(m, 'metric', 3)).toBe(m.toFixed(3))
    }
  })
})

describe('birim okunamayan bağlamlar', () => {
  test('floorplan viewState opsiyonel — varsayılan metrik', () => {
    // `ctx.viewState` tipte opsiyonel ve 3B geometri yolunda her zaman
    // `undefined`. Varsayılansız bırakmak `undefined ft` yazdırırdı.
    expect(unitOf(undefined)).toBe(DEFAULT_UNIT)
    expect(unitOf({})).toBe(DEFAULT_UNIT)
    expect(unitOf({ unit: 'imperial' })).toBe('imperial')
  })

  test('sonlu olmayan değer bir birim etiketi taşımaz', () => {
    // `--` yerine `–– ft` yazmak, olmayan bir ölçümü ölçülmüş gibi gösterirdi.
    expect(lengthLabel(Number.NaN, 'imperial')).toBe('––')
    expect(areaLabel(Number.POSITIVE_INFINITY, 'metric')).toBe('––')
  })
})
