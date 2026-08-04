import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  getAreaUnitLabel,
  getLinearUnitLabel,
  metersToLinearUnit,
  squareMetersToAreaUnit,
} from '@pascal-app/editor'
import {
  areaLabel,
  DEFAULT_UNIT,
  fieldToMetres,
  lengthLabel,
  lengthValue,
  metresToField,
  millimetreLabel,
  publishedMillimetres,
  unitOf,
} from './units'

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

/**
 * BEKÇİ: bir sayı alanının iki yönü birlikte çevrilir.
 *
 * Bu, paketteki tek SESSİZ VERİ hatası olabilecek birim sorunu — ötekiler
 * yalnız yanlış okunuyor, bu yanlış KAYDEDİYOR. Gösterimi çevirip ayrıştırmayı
 * çevirmezseniz Imperial kullanıcı 9 yazar, sahneye 9 metre girer ve alan bir
 * sonraki render'da 29.5 gösterir: hiçbir hata yok, nesne üç kat büyük.
 */
describe('sayı alanı gidiş-dönüşü', () => {
  test('gidiş-dönüş 0,2 mm içinde kalıyor — çelik için gürültünün altında', () => {
    /**
     * Tolerans keyfî değil, üç ondalık feet'in kendisi: 0,001 ft = 0,3048 mm,
     * yani yuvarlama en fazla ±0,15 mm kaydırabilir. Bunu 0 yazamayız —
     * yazsaydık test geçmek için ondalık sayısını şişirmeyi zorunlu kılardı ve
     * alan "8.5312 ft" gibi hiç kimsenin okumadığı bir sayı gösterirdi.
     *
     * 0,15 mm'nin bu pakette bir anlamı yok: dikme delik adımı 50 mm, palet
     * oturma payı 75 mm. Ve hata yalnız kullanıcı alanı DÜZENLERSE oluşuyor —
     * dokunulmamış bir değer hiç geri yazılmıyor.
     */
    for (const unit of ['metric', 'imperial'] as const) {
      for (const metres of [0, 0.05, 1.4, 2.675, 12.5]) {
        const roundTrip = fieldToMetres(metresToField(metres, unit), unit)
        expect({ unit, metres, drifted: Math.abs(roundTrip - metres) > 0.0002 }).toEqual({
          unit,
          metres,
          drifted: false,
        })
      }
    }
  })

  test('metrik yol her iki yönde de KİMLİK', () => {
    // Metrik kullanıcı için davranış bitine kadar eskisiyle aynı kalmalı;
    // bir yuvarlama eklemek, hiç dokunulmamış bir alanı ilk düzenlemede
    // kaydırırdı.
    for (const metres of [1 / 3, 2.675, 99.995]) {
      expect(metresToField(metres, 'metric')).toBe(metres)
      expect(fieldToMetres(metres, 'metric')).toBe(metres)
    }
  })

  test('Imperial gerçekten çeviriyor — sessizce kimlik değil', () => {
    // Bu iddia olmadan üstteki gidiş-dönüş testi, iki fonksiyon da hiçbir şey
    // yapmasa YEŞİL kalırdı: bekçinin en sinsi kendini kandırma biçimi.
    expect(metresToField(1, 'imperial')).toBeCloseTo(3.281, 3)
    expect(fieldToMetres(1, 'imperial')).toBeCloseTo(0.3048, 4)
  })

  test('çeviren her dosya İKİ yönü de kullanıyor', () => {
    // Asimetriyi kaynak düzeyinde yakalar: yeni bir alan eklerken yalnız
    // gösterimi çevirmek en kolay atlama, ve hiçbir tip hatası vermiyor.
    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8')
      if (file.endsWith('units.ts') || file.endsWith('units.test.ts')) continue
      const shows = source.includes('metresToField(')
      const parses = source.includes('fieldToMetres(')
      expect({ file, shows, parses }).toEqual({ file, shows: parses, parses })
    }
  })
})

/**
 * BEKÇİ: çevrilmiş bir sayı SABİT bir birim etiketi takmıyor.
 *
 * Yarım yapılmış bir dönüşümün tam olarak nasıl göründüğü bu: değer
 * `lengthLabel` ile feet'e çevrilir, ama yanındaki `m` elle yazıldığı için
 * kalır ve panel `8.53 m` yazar. Sayı doğru, birim yalan, ve hiçbir şey
 * şikâyet etmiyor.
 *
 * Bir alıntı figürünü kaynağının biriminde bırakmak bunun kapsamında DEĞİL:
 * orada sayı da etiket de belgeden geliyor ve `publishedMillimetres` bunu
 * söylüyor. Bu bekçi yalnız ÇEVRİLMİŞ bir değerin yanındaki sabit birimi arar,
 * o yüzden bir izin listesine ihtiyacı yok.
 */
describe('yarım çevrilmiş okuma yok', () => {
  const CONVERTERS = ['lengthLabel', 'lengthValue', 'areaLabel', 'millimetreLabel', 'metresToField']
  const HARD_UNIT = String.raw`\s*(?:m²|mm|m|ft²|ft)\b`

  test('çevrilmiş bir değerin ardından elle yazılmış birim gelmiyor', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      if (file.endsWith('units.test.ts')) continue
      const source = readFileSync(file, 'utf8')
      for (const fn of CONVERTERS) {
        // `${lengthLabel(...)} m` — kapanış parantezini dengelemek yerine
        // araya parantez ve süslü parantez GİRMEMESİNİ arıyoruz: iç içe bir
        // çağrı olduğunda eşleşme kurulmuyor, yani bu bekçi eksik uyarır,
        // fazla değil.
        const pattern = new RegExp(`\\$\\{${fn}\\([^(){}]*\\)\\}${HARD_UNIT}`, 'g')
        for (const match of source.matchAll(pattern)) {
          offenders.push(`${file}: ${match[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * BEKÇİ: alıntı ile ölçüm ayrımı gerçekten bir fark yaratıyor.
 *
 * İki fonksiyon aynı şeyi yapsaydı `publishedMillimetres` yalnız bir yorum
 * olurdu — ve bir yorum, birim ayarı değiştiğinde hiçbir şeyi korumaz.
 */
describe('alıntı figürü ile ölçülmüş figür ayrı', () => {
  test('ölçüm birimle DEĞİŞİYOR, alıntı değişmiyor', () => {
    expect(millimetreLabel(0.075, 'metric')).toBe('75 mm')
    expect(millimetreLabel(0.075, 'imperial')).not.toBe('75 mm')

    // EN ISO 14122-3'ün azami rıhtı: belge 220 mm yazıyor ve panel de öyle
    // yazmalı — Imperial'da bile. Çevirmek, belgede olmayan bir kesinlik
    // uydurmaktır.
    expect(publishedMillimetres(220)).toBe('220 mm')
  })

  test('mm ölçeği metrikte metreye YAYILMIYOR', () => {
    // `lengthLabel` ile yazılsaydı `0.08 m` çıkardı: doğru ama sektörün
    // konuşmadığı bir biçim, ve bu bir gerileme olurdu.
    expect(millimetreLabel(0.075, 'metric')).not.toContain('0.0')
  })
})

/**
 * BEKÇİ: `useUnit()` erken `return`'ün ÜSTÜNDE.
 *
 * Bu bir birim hatası değil, bir ÇÖKME — ve tam olarak bu değişiklikte bir kez
 * gerçekten oldu (`drivein-panel.tsx`). Panellerin hepsi aynı kalıpta:
 *
 *     const node = useInspected(provided)
 *     if (!node) return null        // müfettiş başka bir şey için açık
 *     ...
 *
 * Kancayı bu `return`'ün altına koymak, düğüm seçili DEĞİLKEN bir, seçiliyken
 * iki kanca çağırmak demek. React kanca sırasını konuma göre eşliyor, sayı
 * artınca "Rendered more hooks than during the previous render" fırlatıyor: yani
 * panel boş açılıp sonra bir raf seçildiğinde müfettiş çöküyor. Tipler sessiz,
 * testler yeşil, hata yalnız o sırada görülüyor.
 *
 * Kontrol fonksiyon fonksiyon yapılıyor: bir dosyada A bileşeninde koruma, B
 * bileşeninde kanca olması tamamen meşru ve yanlış alarm vermemeli.
 */
describe('kanca sırası', () => {
  const FUNCTION_START = /^(?:export\s+)?(?:default\s+)?function\s/
  const EARLY_RETURN = /^\s{0,4}if\s*\([^)]*\)\s*return\b/
  const HOOK = /\buseUnit\(\)/

  test('hiçbir bileşende useUnit() erken return’ün altında değil', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      if (!file.endsWith('.tsx')) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      let guardAt = -1
      for (const [index, line] of lines.entries()) {
        if (FUNCTION_START.test(line))
          guardAt = -1 // yeni bileşen, sayaç sıfırlanır
        else if (guardAt < 0 && EARLY_RETURN.test(line)) guardAt = index + 1
        else if (HOOK.test(line) && guardAt > 0) {
          offenders.push(`${file}:${index + 1} — useUnit() satır ${guardAt}'deki return'ün altında`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/** `src` altındaki her `.ts` / `.tsx` — testler dahil, `node_modules` hariç. */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
    }
  }
  walk(join(import.meta.dir))
  return out
}
