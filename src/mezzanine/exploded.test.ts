import { describe, expect, test } from 'bun:test'
import { nextTierY, tierGapFor } from './exploded-tiers'
import { resolveTierElevations } from './metrics'
import { mezzanineParts, tierCount } from './parts'
import { emptyAccessories, MezzanineNode, type MezzanineTier } from './schema'

const tier = (index: number, patch: Partial<MezzanineTier> = {}): MezzanineTier => ({
  index,
  elevationM: 'auto',
  clearHeightM: 3,
  loadClass: 500,
  floorType: 'WOOD_CHIPBOARD_30',
  accessories: emptyAccessories(),
  ...patch,
})

const mezz = (tiers: MezzanineTier[]) =>
  MezzanineNode.parse({
    id: 'mezzanine_probe',
    tiers,
    grid: { baysX: 2, baysY: 2, bayWidthM: 5, bayDepthM: 5 },
  })

describe('kat etiketi — patlatmanın önşartı', () => {
  test('HER parça bir kata ait, etiketsiz parça yok', () => {
    // Etiketsiz bir parça patlatmada nereye gideceği bilinmeyen bir kutudur.
    // Damga aralık üzerinden vuruluyor, yani bir yardımcıyı atlamak imkânsız —
    // bu test onu kilitliyor.
    for (const part of mezzanineParts(mezz([tier(0), tier(1), tier(2)]))) {
      expect(Number.isInteger(part.tier), `${part.role} etiketsiz`).toBe(true)
    }
  })

  test('etiketler 0..N-1 aralığını TAM dolduruyor', () => {
    const node = mezz([tier(0), tier(1), tier(2)])
    const used = new Set(mezzanineParts(node).map((part) => part.tier))
    expect([...used].sort()).toEqual([0, 1, 2])
    expect(tierCount(node)).toBe(3)
  })

  test('tek katlı yapıda her şey kat 0’da', () => {
    const used = new Set(mezzanineParts(mezz([tier(0)])).map((part) => part.tier))
    expect([...used]).toEqual([0])
  })
})

describe('kolon kat başına BÖLÜNDÜ ama kısalmadı', () => {
  /**
   * Bölmenin tek sebebi patlatma: güvertesi kalkarken kolonu yerinde kalan bir
   * kat havada asılı dururdu. Ama bölme, kolonu KISALTMAMALI — parçalar uç uca
   * eklendiğinde eski tam boy çıkmalı, yoksa yapı sessizce kısalır.
   */
  test('parçalar uç uca tam yüksekliği veriyor — boşluk ve bindirme yok', () => {
    const node = mezz([tier(0), tier(1), tier(2)])
    const resolved = resolveTierElevations(node.tiers)
    const top = resolved[resolved.length - 1]?.deckTopM ?? 0

    // Tek bir kolon hattının gövde kutuları: aynı (x, z), rol 'column'.
    const columns = mezzanineParts(node).filter((part) => part.role === 'column')
    const first = columns[0]
    expect(first).toBeDefined()
    if (!first) return

    const line = columns
      .filter(
        (part) =>
          Math.abs(part.center[0] - first.center[0]) < 1e-9 &&
          Math.abs(part.center[2] - first.center[2]) < 1e-9,
      )
      .map((part) => ({
        tier: part.tier,
        y0: part.center[1] - part.size[1] / 2,
        y1: part.center[1] + part.size[1] / 2,
      }))
      .sort((a, b) => a.y0 - b.y0)

    expect(line.length).toBe(3)
    expect(line[0]?.y0).toBeCloseTo(0, 9)
    expect(line[line.length - 1]?.y1).toBeCloseTo(top, 9)
    for (let index = 1; index < line.length; index++) {
      // Bir parçanın üstü, bir sonrakinin altı. Eşitse ne boşluk ne bindirme.
      expect(line[index]?.y0).toBeCloseTo(line[index - 1]?.y1 ?? -1, 9)
    }
  })

  test('kolon parçalarının katı, üstünde durduğu güvertenin katı', () => {
    const node = mezz([tier(0), tier(1)])
    const resolved = resolveTierElevations(node.tiers)
    const columns = mezzanineParts(node).filter((part) => part.role === 'column')
    for (const part of columns) {
      const top = part.center[1] + part.size[1] / 2
      expect(top).toBeCloseTo(resolved[part.tier]?.deckTopM ?? -1, 9)
    }
  })

  test('taban plakası YALNIZ zemine basan katta', () => {
    // İkinci bir plaka, birinci katın ortasında havada duran bir çelik levha
    // demekti.
    const plates = mezzanineParts(mezz([tier(0), tier(1), tier(2)])).filter(
      (part) => part.role === 'footplate',
    )
    expect(plates.length).toBeGreaterThan(0)
    for (const plate of plates) expect(plate.tier).toBe(0)
  })
})

describe('açılma payı kendini sınırlıyor', () => {
  /**
   * Asma katın TOPLAM açılması host'un kat aralığını (5 m) aşarsa,
   * patlatılmış bir binada üst güverte bir üstteki katın içine girer ve iki
   * ayrı yapı tek bir karmaşa gibi okunur.
   */
  test('toplam açılma host kat aralığını hiçbir kat sayısında aşmıyor', () => {
    for (let count = 1; count <= 12; count++) {
      const total = tierGapFor(count) * (count - 1)
      expect(total, `${count} kat`).toBeLessThanOrEqual(5 + 1e-9)
    }
  })

  test('az katta pay 2 m’de tavanlı — sonsuza açılmıyor', () => {
    expect(tierGapFor(2)).toBeCloseTo(2, 9)
    expect(tierGapFor(3)).toBeCloseTo(2, 9)
  })

  test('çok katta pay küçülüyor', () => {
    expect(tierGapFor(6)).toBeLessThan(tierGapFor(3))
  })

  test('tek kat da bir sayı veriyor — sıfıra bölme yok', () => {
    expect(Number.isFinite(tierGapFor(1))).toBe(true)
  })
})

describe('hareket gerçekten BİTİYOR', () => {
  /** 60 fps'te bir karenin yumuşatma oranı (`LERP_RATE = 12`). */
  const T = Math.min(1, (1 / 60) * 12)

  test('hedefe TAM oturuyor — sonsuza kadar yaklaşmıyor', () => {
    /**
     * Sessiz hata: oransal lerp hedefe hiçbir zaman eşit olmaz, yalnız
     * yaklaşır. Eşiksiz hâlde patlatma açık kaldığı SÜRECE her kare kat başına
     * bir `position.y` yazımı sürüyordu — ekranda hareket çoktan bitmişken,
     * her yazım alt ağacın dünya matrisini yeniden çarptırarak.
     */
    let y = 0
    const target = 4
    let frames = 0
    while (y !== target && frames < 1000) {
      y = nextTierY(y, target, T)
      frames++
    }
    expect(y).toBe(target)
    // Yarım saniyelik bir hareket için makul bir üst sınır; asıl iddia
    // "bitiyor", bu yalnız "makul sürede" diyor.
    expect(frames).toBeLessThan(120)
    // Ve oturduktan sonra çağıran hiçbir yazım görmez.
    expect(nextTierY(y, target, T)).toBe(y)
  })

  test('eşik hareketi YUTMUYOR — uzaktan hedefe ışınlanma yok', () => {
    // Eşiği adıma (kalan × t) değil KALANA uygulamak zorunda: adıma
    // uygulanmış bir eşik, 4 m uzaktaki bir katı ilk karede hedefe
    // yapıştırırdı ve açılma animasyonu diye bir şey kalmazdı.
    const first = nextTierY(0, 4, T)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(4)
  })
})
