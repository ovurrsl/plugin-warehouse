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
