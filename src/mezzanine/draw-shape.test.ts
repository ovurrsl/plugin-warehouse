import { describe, expect, test } from 'bun:test'
import {
  centroidOf,
  closeEnough,
  finishOutline,
  type Point2,
  signedArea,
  withVertexInserted,
  withVertexMoved,
  withVertexRemoved,
} from './draw-shape'

const square: Point2[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

describe('çizim geçerliliği', () => {
  test('üç köşeden az bir şekil değil', () => {
    expect(finishOutline([])).toBeNull()
    expect(
      finishOutline([
        [0, 0],
        [1, 1],
      ]),
    ).toBeNull()
  })

  test('neredeyse doğrusal üç tıklama reddedilir', () => {
    // Alanı sıfıra yakın: kolonu yok, üstüne bir şey konamaz, ama sahnede
    // seçilebilir bir düğüm olarak dururdu. Reddetmek silmeye zorlamaktan iyi.
    expect(
      finishOutline([
        [0, 0],
        [10, 0],
        [5, 0.01],
      ]),
    ).toBeNull()
  })

  test('geçerli kare kabul edilir', () => {
    expect(finishOutline(square)).not.toBeNull()
  })
})

describe('normalleştirme', () => {
  test('konum ağırlık merkezi, poligon ona GÖRE', () => {
    const finished = finishOutline(square)
    if (!finished) throw new Error('kare reddedildi')
    expect(finished.position[0]).toBeCloseTo(2, 9)
    expect(finished.position[2]).toBeCloseTo(2, 9)
    // Merkeze göre: köşeler ±2.
    for (const [x, z] of finished.polygon) {
      expect(Math.abs(x)).toBeCloseTo(2, 9)
      expect(Math.abs(z)).toBeCloseTo(2, 9)
    }
  })

  test('sarım yönü tek yöne normalleştiriliyor', () => {
    // Aynı şeklin iki sarımı aynı poligonu vermeli — yoksa aynı şekil iki
    // farklı veri olarak saklanır ve karşılaştırma ayrışır.
    const forward = finishOutline(square)
    const reversed = finishOutline([...square].reverse())
    expect(forward?.polygon).toEqual(reversed?.polygon ?? [])
    expect(signedArea(forward?.polygon ?? [])).toBeGreaterThan(0)
  })

  test('merkeze taşımak taşımayı doğru kılıyor', () => {
    // Poligon dünya koordinatında bırakılsaydı mezzanine'i taşımak şekli
    // yerinde bırakırdı.
    const shifted = square.map(([x, z]) => [x + 100, z - 50] as Point2)
    const a = finishOutline(square)
    const b = finishOutline(shifted)
    expect(a?.polygon).toEqual(b?.polygon ?? [])
    expect(b?.position[0]).toBeCloseTo(102, 9)
    expect(b?.position[2]).toBeCloseTo(-48, 9)
  })
})

describe('kapanma toleransı', () => {
  test('yakın nokta kapanış sayılır, uzak sayılmaz', () => {
    expect(closeEnough([0, 0], [0.3, 0.3])).toBe(true)
    expect(closeEnough([0, 0], [5, 5])).toBe(false)
  })
})

describe('ağırlık merkezi', () => {
  test('dejenere poligonda aritmetik ortalamaya düşer', () => {
    // Tanımsız bir merkez yerine NaN döndürmek, düğümü sahnenin dışına
    // fırlatırdı.
    const centre = centroidOf([
      [0, 0],
      [1, 0],
      [2, 0],
    ])
    expect(Number.isFinite(centre[0])).toBe(true)
    expect(Number.isFinite(centre[1])).toBe(true)
  })
})

describe('anahat düzenleme — yeniden merkezleme YOK', () => {
  test('köşe taşımak konumu değil yalnız köşeyi değiştirir', () => {
    // Merdivenler mezzanine-YEREL koordinatta; merkez kaysaydı yerlerinden
    // oynarlardı. Düzenleme bu yüzden `finishOutline`dan farklı: recenter yok.
    const moved = withVertexMoved(square, 0, [-2, -2])
    expect(moved).not.toBeNull()
    expect(moved?.[0]).toEqual([-2, -2])
    expect(moved?.[1]).toEqual([4, 0])
  })

  test('alanı yok eden hamle REDDEDİLİR', () => {
    // Kareyi karşı köşesinin üstüne katlamak alanı sıfıra indirir.
    const collapsed = withVertexMoved(
      [
        [0, 0],
        [4, 0],
        [4, 0.01],
      ],
      2,
      [2, 0],
    )
    expect(collapsed).toBeNull()
  })

  test('kenara köşe eklenir ve alan korunur', () => {
    const inserted = withVertexInserted(square, 0, [2, 0])
    expect(inserted).toHaveLength(5)
    expect(inserted?.[1]).toEqual([2, 0])
  })

  test('köşe silinir ama üçten aşağı İNİLMEZ', () => {
    const removed = withVertexRemoved(square, 0)
    expect(removed).toHaveLength(3)
    expect(withVertexRemoved(removed ?? [], 0)).toBeNull()
  })
})
