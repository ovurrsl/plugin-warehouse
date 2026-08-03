import { describe, expect, test } from 'bun:test'
import { emitter } from '@pascal-app/core'
import { warehousePlugin } from './index'
import {
  CLICK_TRIGGER_KINDS,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
} from './placement'

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

/**
 * BEKÇİ: hareket kare başına bir kez işlenir — ama tıklama ASLA bayat konuma
 * yerleştirmez.
 *
 * Host `grid:move`'u ham `pointermove` dinleyicisinden yayınlıyor, düğme
 * koşulu olmadan: fare tuval üzerinde yalnızca gezinirken bile akıyor ve bir
 * oyun faresi saniyede 1000 olay üretebiliyor. Her olayda tam yerleştirme
 * hattını koşturmak (hizalama, şema ayrıştırma, çakışma taraması, React
 * `setState`'leri) işin yirmide on dokuzunu çizilmeyen kareler için harcamaktı.
 *
 * Birleştirmenin bedeli, dikkat edilmezse, gerçek bir hata: tıklama imleci son
 * hareketin bıraktığı yerden okuyor, yani bekleyen hareket işlenmeden gelen bir
 * tıklama nesneyi BİR KARE ESKİ konuma koyar. Hızlı bir "sürükle ve bırak"ta
 * gözle görülür ve hiçbir hata vermez. Bu blok ikisini birden tutuyor.
 */
describe('ızgara hareketi kareye kilitlenir', () => {
  const frames = new Map<number, () => void>()
  let nextFrameId = 1

  const installFakeFrames = () => {
    frames.clear()
    nextFrameId = 1
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
      callback: () => void,
    ) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    }
    ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => {
      frames.delete(id)
    }
  }

  const removeFakeFrames = () => {
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined
    ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = undefined
  }

  const runFrame = () => {
    const due = [...frames.values()]
    frames.clear()
    for (const callback of due) callback()
  }

  const move = (x: number, z: number) =>
    emitter.emit('grid:move', {
      position: [x, 0, z],
      localPosition: [x, 0, z],
      nativeEvent: {} as never,
    } as never)

  test('bir karedeki üç hareket TEK kez işlenir, ve SON konumla', () => {
    installFakeFrames()
    const seen: number[] = []
    const unsubscribe = subscribeGridMove(([x]) => seen.push(x))

    move(1, 0)
    move(2, 0)
    move(3, 0)
    // Kare henüz dönmedi: hiçbiri işlenmemiş olmalı.
    expect(seen).toEqual([])

    runFrame()
    expect(seen).toEqual([3])

    unsubscribe()
    removeFakeFrames()
  })

  test('tıklama, bekleyen hareketi ÖNCE işler — bir kare eski konuma yerleşmez', () => {
    installFakeFrames()
    const seen: number[] = []
    const committed: number[] = []
    let last = Number.NaN
    const unsubscribeMove = subscribeGridMove(([x]) => {
      last = x
      seen.push(x)
    })
    const unsubscribeClicks = subscribePlacementClicks(() => committed.push(last))

    move(1, 0)
    runFrame()
    // İmleç yeni bir yere gitti ve kullanıcı kareyi beklemeden tıkladı.
    move(9, 0)
    emitter.emit('grid:click', {
      position: [9, 0, 0],
      localPosition: [9, 0, 0],
      nativeEvent: {} as never,
    } as never)

    expect(seen).toEqual([1, 9])
    expect(committed).toEqual([9])

    unsubscribeMove()
    unsubscribeClicks()
    removeFakeFrames()
  })

  test('abonelik sökülünce bekleyen hareket ÇALIŞMAZ', () => {
    installFakeFrames()
    const seen: number[] = []
    const unsubscribe = subscribeGridMove(([x]) => seen.push(x))

    move(5, 0)
    unsubscribe()
    runFrame()

    expect(seen).toEqual([])
    removeFakeFrames()
  })

  test('rAF olmayan ortamda (sunucu ön-render) senkron kalır', () => {
    // Ertelenecek bir kare yoksa ertelemek, olayı hiç işlememek olurdu.
    removeFakeFrames()
    const seen: number[] = []
    const unsubscribe = subscribeGridMove(([x]) => seen.push(x))
    move(7, 0)
    expect(seen).toEqual([7])
    unsubscribe()
  })
})

describe('aynı noktayı iki kez bildirmemek', () => {
  test('ızgaraya oturmuş imleç "değişmedi" der, gerçekten kımıldayan demez', () => {
    // Tek amacı bir React render'ını atlatmak; eşiği görünür bir mesafeye
    // çekmek, yerleştirme kutusunun imlecin gerisinde kalması demek olurdu.
    expect(samePlacementPoint([1, 0, 2], [1, 0, 2])).toBe(true)
    expect(samePlacementPoint(null, [1, 0, 2])).toBe(false)
    expect(samePlacementPoint([1, 0, 2], [1.00001, 0, 2])).toBe(true)
    expect(samePlacementPoint([1, 0, 2], [1.001, 0, 2])).toBe(false)
    expect(samePlacementPoint([1, 0, 2], [1, 0.001, 2])).toBe(false)
  })
})
