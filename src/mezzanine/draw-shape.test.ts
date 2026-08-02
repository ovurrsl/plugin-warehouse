import { describe, expect, test } from 'bun:test'
import {
  centroidOf,
  closeEnough,
  finishOutline,
  isAxisAlignedRectangle,
  outlineBounds,
  type Point2,
  rectangleFrom,
  signedArea,
  withOutlineScaled,
  withRectangleSize,
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

// ── Dikdörtgen kısayolu ve ölçü ─────────────────────────────────────────────

describe('rectangleFrom', () => {
  test('iki karşı köşeden dört köşe', () => {
    const rect = rectangleFrom([0, 0], [4, 3])
    expect(rect).toHaveLength(4)
    expect(outlineBounds(rect)).toMatchObject({ widthM: 4, depthM: 3 })
  })

  test('köşeler ters sırada verilse de aynı dikdörtgen', () => {
    const a = outlineBounds(rectangleFrom([4, 3], [0, 0]))
    const b = outlineBounds(rectangleFrom([0, 0], [4, 3]))
    expect(a).toEqual(b)
  })

  test('üretilen şey gerçekten eksen hizalı dikdörtgen sayılıyor', () => {
    expect(isAxisAlignedRectangle(rectangleFrom([-2, -1], [2, 1]))).toBe(true)
  })
})

describe('isAxisAlignedRectangle — panelin ölçü kontrollerinin ÖLÇÜTÜ', () => {
  test('L şekli dikdörtgen değil', () => {
    expect(
      isAxisAlignedRectangle([
        [0, 0],
        [4, 0],
        [4, 2],
        [2, 2],
        [2, 4],
        [0, 4],
      ]),
    ).toBe(false)
  })

  test('döndürülmüş kare dikdörtgen sayılmıyor — sınır kutusu şekil değil', () => {
    expect(
      isAxisAlignedRectangle([
        [0, 2],
        [2, 0],
        [4, 2],
        [2, 4],
      ]),
    ).toBe(false)
  })

  test('bir köşesi elle kaydırılmış dörtgen dikdörtgenliğini KAYBEDER', () => {
    // Kullanıcı köşeyi sürükleyip neredeyse hizaladıysa şekli artık dikdörtgen
    // değil; genişlik/derinlik kontrollerini geri vermek onu sessizce
    // dikdörtgene çevirmek olurdu.
    expect(
      isAxisAlignedRectangle([
        [0, 0],
        [4, 0],
        [4.3, 3],
        [0, 3],
      ]),
    ).toBe(false)
  })

  test('üçgen dikdörtgen değil', () => {
    expect(
      isAxisAlignedRectangle([
        [0, 0],
        [4, 0],
        [0, 3],
      ]),
    ).toBe(false)
  })

  test('üst üste binen köşeli dejenere dörtgen reddediliyor', () => {
    expect(
      isAxisAlignedRectangle([
        [0, 0],
        [4, 0],
        [4, 0],
        [0, 3],
      ]),
    ).toBe(false)
  })
})

describe('withRectangleSize', () => {
  test('yeni ölçüyü veriyor ve MERKEZİ koruyor', () => {
    const before = rectangleFrom([-2, -1.5], [2, 1.5])
    const after = withRectangleSize(before, 8, 5)
    expect(after).not.toBeNull()
    if (!after) return
    const bounds = outlineBounds(after)
    expect(bounds.widthM).toBeCloseTo(8, 9)
    expect(bounds.depthM).toBeCloseTo(5, 9)
    // Merkez sabit: kenardan büyütmek yapıyı ekranda kaydırırdı.
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(0, 9)
    expect((bounds.minZ + bounds.maxZ) / 2).toBeCloseTo(0, 9)
  })

  test('dikdörtgen olmayan şekli REDDEDİYOR', () => {
    const l = [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
    ] as const
    expect(withRectangleSize(l as never, 6, 6)).toBeNull()
  })

  test('alanı asgarinin altına düşüren ölçü reddediliyor', () => {
    expect(withRectangleSize(rectangleFrom([0, 0], [4, 3]), 0.5, 0.5)).toBeNull()
  })
})

describe('withOutlineScaled', () => {
  test('L şeklini oranları bozmadan büyütüyor', () => {
    const l = [
      [-2, -2],
      [2, -2],
      [2, 0],
      [0, 0],
      [0, 2],
      [-2, 2],
    ] as const
    const scaled = withOutlineScaled(l as never, 2)
    expect(scaled).not.toBeNull()
    if (!scaled) return
    const before = outlineBounds(l as never)
    const after = outlineBounds(scaled)
    expect(after.widthM).toBeCloseTo(before.widthM * 2, 9)
    expect(after.depthM).toBeCloseTo(before.depthM * 2, 9)
    // Oran korunuyor — dikdörtgene dönüşmedi.
    expect(after.widthM / after.depthM).toBeCloseTo(before.widthM / before.depthM, 9)
  })

  test('sıfır ve negatif çarpan reddediliyor', () => {
    const rect = rectangleFrom([0, 0], [4, 3])
    expect(withOutlineScaled(rect, 0)).toBeNull()
    expect(withOutlineScaled(rect, -1)).toBeNull()
  })

  test('alanı asgarinin altına düşüren küçültme reddediliyor', () => {
    expect(withOutlineScaled(rectangleFrom([0, 0], [4, 3]), 0.05)).toBeNull()
  })
})
