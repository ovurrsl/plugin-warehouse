import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from './index'
import { CLICK_TRIGGER_KINDS } from './placement'

/**
 * BEKÇİ: kaydedilen her kind yerleştirme tıklamasını TETİKLEMELİ.
 *
 * ## Neden bir test gerekiyor
 *
 * Bu atlama üç kez üst üste yapıldı — asma kat ve canlı raf bir turda, sonra
 * drive-in, M7 ve M3 sırayla — ve her seferinde aynı sebeple: bir kind'ı
 * eklemenin doğal adımları (şema, geometri, renderer, tanım, manifest, katalog)
 * bu listeye uğramıyor.
 *
 * ## Belirtisi neden fark edilmiyor
 *
 * Boş bir zeminde her şey çalışır. Hata yalnız imleç BAŞKA bir eklenti
 * nesnesinin üzerindeyken görünür — ve tam olarak o an, raf sıralarının
 * kurulduğu an. R3F tıklamayı en yakın mesh'e gönderiyor; yerleştirilmiş bir
 * gözün görünmez seçim kolideri o mesh. Kind bu listede yoksa `grid:click` hiç
 * gelmiyor, tıklama sessizce yutuluyor: hata yok, uyarı yok, sadece hiçbir şey
 * olmuyor. Kullanıcı ikinci kez tıklıyor, yine olmuyor.
 *
 * Kural bilerek İSTİSNASIZ: bu eklentinin kaydettiği her kind yerleştirilebilir
 * ve her birinin bir çarpma hedefi var. Bir gün gerçekten istisna gereken bir
 * kind gelirse, doğru hamle bu testi gevşetmek değil, istisnayı gerekçesiyle
 * buraya yazmak — panel erişilebilirlik bekçisinin yaptığı gibi.
 */
describe('yerleştirme tıklaması', () => {
  // `Plugin.nodes` host tipinde OPSİYONEL. `?? []` bu yüzden var, ve altındaki
  // "boş değil" testi de bu yüzden var: boşa düşerse döngü hiç dönmez ve dosya
  // sıfır iddiayla yeşil kalırdı — bekçinin en sinsi kendini kandırma biçimi.
  const registered = (warehousePlugin.nodes ?? []).map((node) => (node as { kind: string }).kind)

  test('eklenti gerçekten kind kaydediyor — liste boşsa test kendini kandırır', () => {
    expect(registered.length).toBeGreaterThan(10)
  })

  for (const kind of registered) {
    test(`${kind} tıklama tetikleyicisi olarak kayıtlı`, () => {
      expect(
        (CLICK_TRIGGER_KINDS as readonly string[]).includes(kind),
        `${kind} CLICK_TRIGGER_KINDS'te yok: bu kind'ın kolideri üzerindeyken yapılan yerleştirme tıklaması yutulur`,
      ).toBe(true)
    })
  }

  test('host kind’leri de listede duruyor — zemin, slab ve duvar', () => {
    // Yalnız eklenti kind'larını saymak, listenin asıl işini gölgede bırakırdı:
    // "zemin" diye tıklanan şey çoğu zaman bir slab.
    for (const kind of ['grid', 'slab', 'wall', 'item']) {
      expect((CLICK_TRIGGER_KINDS as readonly string[]).includes(kind)).toBe(true)
    }
  })

  test('listede tekrar yok', () => {
    // Bir kind iki kez yazılırsa her tıklama iki kez abone olur ve tek tıkla iki
    // nesne yerleşir — bu dosyanın kendi başındaki çift-tetikleme hikâyesi.
    expect(new Set(CLICK_TRIGGER_KINDS).size).toBe(CLICK_TRIGGER_KINDS.length)
  })
})
