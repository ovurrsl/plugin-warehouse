import { describe, expect, test } from 'bun:test'
import { deckTopOf } from './bake-replace'
import { specOf } from './presets'
import { PalletNode } from './schema'

const DECK = specOf('epal-1').height

/**
 * Baked görünümde yük, paletin güvertesine oturmak ZORUNDA — ve bu, editörde
 * bedava gelen tek şeyin bake yolunda elle yapılması gereken yeri.
 *
 * Editörde yük paletin alt ağacında duruyor: konumu `[0, h, 0]` ve dönüşü three
 * uyguluyor. Bake yolu matrisleri düz düğüm verisinden kurduğu için alt ağaç
 * yok, yani ofsetin paletin kendi çerçevesinde taşınması buranın işi. Yanlış
 * cevap makul görünüyor (`y + h`) ve yalnız döndürülmüş palette ortaya çıkıyor.
 */
describe('bake — yükün güverte üstü çapası', () => {
  test('döndürülmemiş palette yük tam güverte yüksekliğinde', () => {
    const node = PalletNode.parse({ id: 'pallet_flat', position: [2, 0, -3], cargo: 'carton' })
    const [x, y, z] = deckTopOf(node)
    expect(x).toBeCloseTo(2, 9)
    expect(y).toBeCloseTo(DECK, 9)
    expect(z).toBeCloseTo(-3, 9)
  })

  test('Y ekseninde dönmüş palette yük yine tam üstünde', () => {
    // Saf Y dönüşü `[0, h, 0]`'ı kımıldatmaz. Testin işi ters yönü sabitlemek:
    // dönüşü fazladan uygulayan bir hesap yükü yandaki paletin üstüne taşırdı,
    // ve rafın gözlerinde bu iki paletlik bir kayma olarak görünürdü.
    const node = PalletNode.parse({
      id: 'pallet_turned',
      position: [1, 0, 1],
      rotation: [0, Math.PI / 3, 0],
      cargo: 'carton',
    })
    const [x, y, z] = deckTopOf(node)
    expect(x).toBeCloseTo(1, 9)
    expect(y).toBeCloseTo(DECK, 9)
    expect(z).toBeCloseTo(1, 9)
  })

  test('yatırılmış palette yük paletin KENDİ çerçevesinde duruyor', () => {
    // Z ekseninde çeyrek tur: güvertenin üstü artık −X yönünde bakıyor.
    // `y + h` yazan bir bake yolu burada yükü havada bırakır ve palet yan
    // yatarken yük dik durur. Şema dönüşü üç serbest sayı olarak tutuyor
    // (`rotatable` yalnız Y bildirse de içe aktarılan ya da MCP ile kurulan
    // sahne yatık palet taşıyabilir), yani bu hâl temsil edilebilir.
    const node = PalletNode.parse({
      id: 'pallet_tipped',
      position: [0, 0, 0],
      rotation: [0, 0, Math.PI / 2],
      cargo: 'carton',
    })
    const [x, y, z] = deckTopOf(node)
    expect(x).toBeCloseTo(-DECK, 9)
    expect(y).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(0, 9)
  })
})
