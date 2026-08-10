import { describe, expect, test } from 'bun:test'
import { bayPitch, uprightSection } from './levels'
import { type LongspanPart, longspanParts } from './parts'
import { LongspanNode } from './schema'

function bay(patch: Partial<LongspanNode> = {}): LongspanNode {
  return LongspanNode.parse({ ...patch })
}

function roles(parts: LongspanPart[], role: LongspanPart['role']): LongspanPart[] {
  return parts.filter((part) => part.role === role)
}

describe('koridor çaprazı — geriye dönük hata', () => {
  /**
   * İLK SÜRÜM YANLIŞTI ve bu test onu kilitliyor.
   *
   * Çapraz `tiltX` ile — Y–Z eğimiyle — çiziliyordu; `tiltX` X ekseni etrafında
   * döndürdüğü için X–Y düzleminde HİÇBİR eğim üretmiyor. Sonuç
   * `hypot(bayLength, rise)` uzunluğunda YATAY bir çubuktu: 1.9 m'lik gözde
   * 2.76 m, iki uçtan komşu gözün içine 40 cm taşan; üstelik iki kopya 1°
   * farkla neredeyse çakışık, yani z-savaşı.
   *
   * Kamerayı çerçevenin içine sokmadan görünmüyordu. Parça listesinden
   * ölçülüyor — düzeltme, paylaşılan emitter'a `tiltZ` eklemek oldu.
   */
  const braced = bay({ crossBracing: true, bayLength: 1.9, frameHeight: 2.5 })

  test('X–Y düzleminde gerçekten eğik', () => {
    const braces = roles(longspanParts(braced), 'brace').filter((part) => (part.tiltZ ?? 0) !== 0)
    expect(braces).toHaveLength(2)
    for (const brace of braces) {
      expect(Math.abs(brace.tiltZ ?? 0)).toBeGreaterThan(0.2)
    }
  })

  test('iki kopya zıt yönde — çakışmıyor', () => {
    const braces = roles(longspanParts(braced), 'brace').filter((part) => (part.tiltZ ?? 0) !== 0)
    expect(Math.sign(braces[0]?.tiltZ ?? 0)).not.toBe(Math.sign(braces[1]?.tiltZ ?? 0))
  })

  test('ekseni net göz boyunu tarıyor, göz adımını değil', () => {
    for (const brace of roles(longspanParts(braced), 'brace')) {
      if ((brace.tiltZ ?? 0) === 0) continue
      const projected = brace.size[0] * Math.abs(Math.cos(brace.tiltZ ?? 0))
      expect(projected).toBeCloseTo(braced.bayLength, 9)
      expect(projected).toBeLessThan(bayPitch(braced))
    }
  })

  test('çapraz istenmediğinde koridor çaprazı hiç yok', () => {
    const plain = bay({ crossBracing: false })
    expect(roles(longspanParts(plain), 'brace').filter((p) => (p.tiltZ ?? 0) !== 0)).toHaveLength(0)
  })
})

describe('kiriş net açıklıkta', () => {
  test('kiriş dikme yüzünde bitiyor, merkezinde değil', () => {
    // `parts.ts`'in başındaki uyarının kendisi: adıma göre ölçülen bir kiriş
    // her iki uçtan yarım dikme gömer.
    const node = bay({ bayLength: 2.3 })
    const uprightMinX = bayPitch(node) / 2 - uprightSection(node).width / 2
    for (const beam of roles(longspanParts(node), 'beam')) {
      expect(beam.center[0] + beam.size[0] / 2).toBeLessThanOrEqual(uprightMinX + 1e-9)
    }
  })
})

/**
 * DENETİMİN BULDUĞU DÖRT KUSUR.
 */
describe('çerçeve bir kafes, panel kirişle hizalı', () => {
  test('çerçevede yatay bağ VE zikzak çapraz var — iki katmanda da', () => {
    /**
     * Her çerçeve iki dikme + TEK bir çaprazdı; yatay bağ hiç yoktu ve
     * çaprazın yükselişi derinliğe kilitliydi. 6 m'lik bir çerçevede ortada
     * havada asılı 1,9 m'lik tek bir çubuk, altında ve üstünde 2,1'er metre
     * çıplak dikme kalıyordu. Üstelik çapraz `full`'e kapılıydı, yani
     * uzakta çerçeve gerçekten iki başıboş dikmeydi — dosyanın kendi yorumu
     * bunun bir ürün olmadığını söylediği hâlde.
     */
    for (const frameHeight of [2.5, 4.0, 6.0]) {
      for (const detail of ['full', 'simple'] as const) {
        const braces = longspanParts(bay({ frameHeight }), detail).filter(
          (part) => part.role === 'brace',
        )
        const ties = braces.filter((part) => (part.tiltX ?? 0) === 0)
        const diagonals = braces.filter((part) => (part.tiltX ?? 0) !== 0)
        expect(ties.length, `${frameHeight}/${detail}: yatay bağ yok`).toBeGreaterThanOrEqual(2)
        expect(diagonals.length, `${frameHeight}/${detail}: çapraz yok`).toBeGreaterThanOrEqual(2)
        // Yükseklik çapraz SAYISINI büyütüyor, tek çaprazın açısını değil.
        expect(new Set(diagonals.map((part) => Math.sign(part.tiltX ?? 0))).size).toBe(2)
      }
    }
    // Ve yükseklik arttıkça çapraz sayısı gerçekten artıyor.
    const low = longspanParts(bay({ frameHeight: 2.5 }), 'full').filter((p) => p.role === 'brace')
    const high = longspanParts(bay({ frameHeight: 6 }), 'full').filter((p) => p.role === 'brace')
    expect(high.length).toBeGreaterThan(low.length)
  })

  test('sunta panel kirişlerin ARASINA düşüyor — üstlerine oturmuyor', () => {
    /**
     * `beamTop` panel kalınlığı kadar aşağı iniyordu: panel kirişin üstünde
     * bir eşik gibi duruyor, 22 mm'lik göbek kenarı koridora açık kalıyordu.
     * Bu, paketin kendi kaynak notuyla çelişiyordu — "the beam's vertical edge
     * conceals the front edge".
     */
    const node = bay()
    const parts = longspanParts(node, 'full')
    const shelves = parts.filter((part) => part.role === 'shelf')
    const beams = parts.filter((part) => part.role === 'beam')
    expect(shelves.length).toBeGreaterThan(0)
    for (const shelf of shelves) {
      const shelfTop = shelf.center[1] + shelf.size[1] / 2
      // Aynı kattaki kirişin üstüyle AYNI düzlemde.
      const sameLevel = beams.filter(
        (beam) => Math.abs(beam.center[1] + beam.size[1] / 2 - shelfTop) < 1e-6,
      )
      expect(sameLevel.length, 'panel kirişle hizalı değil').toBeGreaterThan(0)
    }
  })

  test('panel derinliği İKİ kirişin arası', () => {
    // `frameDepth - beam.depth` panelin ön kenarını tam kirişin orta
    // düzlemine oturtuyordu: üstten bakınca iki uzun kenarda turuncu şerit.
    const node = bay()
    const parts = longspanParts(node, 'full')
    const shelf = parts.find((part) => part.role === 'shelf')
    const beam = parts.find((part) => part.role === 'beam')
    if (!shelf || !beam) throw new Error('panel ya da kiriş yok')
    expect(shelf.size[2]).toBeCloseTo(node.frameDepth - 2 * beam.size[2], 9)
    // Ve panelin kenarı kirişin iç yüzünü geçmiyor.
    const beamInner = Math.abs(beam.center[2]) - beam.size[2] / 2
    expect(shelf.size[2] / 2).toBeLessThanOrEqual(beamInner + 1e-9)
  })

  test('Z-TAM kelepçesi paneli GERÇEKTEN kavrıyor', () => {
    // Küp Y'de tamamen kirişin içindeydi ve paneli hiç kesmiyordu: suntayı
    // kirişe bastıran parça, bastırdığı şeye değmiyordu.
    const node = bay({ bayLength: 2.4 })
    const parts = longspanParts(node, 'full')
    const clamps = parts.filter((part) => part.role === 'ztam-clamp')
    const shelves = parts.filter((part) => part.role === 'shelf')
    expect(clamps.length, 'kelepçe yok').toBeGreaterThan(0)
    for (const clamp of clamps) {
      const cuts = shelves.some(
        (shelf) =>
          Math.abs(clamp.center[1] - shelf.center[1]) < (clamp.size[1] + shelf.size[1]) / 2 - 1e-9,
      )
      expect(cuts, 'kelepçe paneli kesmiyor').toBe(true)
    }
  })
})
