/**
 * Güverte şekli çizmenin saf matematiği.
 *
 * Araçtan ayrı: tıklama/klavye olayları React'te, geçerlilik ve
 * normalleştirme burada. Bir poligonun ne zaman "bitmiş" sayıldığı bir ürün
 * kararı ve test edilebilir olmalı — imleç olaylarının içine gömülü kalmamalı.
 *
 * Ölçüler metre, koordinatlar dünya `[x, z]`.
 */

/** İlk köşeye bu kadar yaklaşınca çizim kapanır — metre. */
export const CLOSE_TOLERANCE_M = 0.6

/**
 * Kabul edilebilir en küçük güverte alanı.
 *
 * Kazara üç tıklama neredeyse doğrusal bir üçgen üretebiliyor: alanı sıfıra
 * yakın, kolonu yok, üstüne hiçbir şey konamaz — ama sahnede seçilebilir bir
 * düğüm olarak duruyor. Reddetmek, kullanıcıyı silmek zorunda bırakmaktan iyi.
 */
export const MIN_AREA_M2 = 1

export type Point2 = readonly [number, number]

/** İki nokta kapanma toleransı içinde mi. */
export function closeEnough(a: Point2, b: Point2, tolerance = CLOSE_TOLERANCE_M): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance
}

/**
 * İşaretli alan (ayakkabı bağı formülü).
 *
 * İşaret sarım yönünü veriyor; `finishOutline` bunu tek yöne normalleştirmek
 * için kullanıyor.
 */
export function signedArea(points: readonly Point2[]): number {
  let sum = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if (!a || !b) continue
    sum += (b[0] - a[0]) * (b[1] + a[1])
  }
  return sum / 2
}

/** Poligonun ağırlık merkezi — düğümün konumu olacak. */
export function centroidOf(points: readonly Point2[]): Point2 {
  let area = 0
  let cx = 0
  let cz = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if (!a || !b) continue
    const cross = a[0] * b[1] - b[0] * a[1]
    area += cross
    cx += (a[0] + b[0]) * cross
    cz += (a[1] + b[1]) * cross
  }
  area /= 2
  // Dejenere poligon: ağırlık merkezi tanımsız, aritmetik ortalamaya düş.
  if (Math.abs(area) < 1e-9) {
    const n = points.length || 1
    return [
      points.reduce((sum, p) => sum + p[0], 0) / n,
      points.reduce((sum, p) => sum + p[1], 0) / n,
    ]
  }
  return [cx / (6 * area), cz / (6 * area)]
}

export type FinishedOutline = {
  /** Düğümün dünya konumu — poligonun ağırlık merkezi. */
  position: [number, number, number]
  /** Merkeze göre yerel köşeler — şemanın `polygon` alanı. */
  polygon: [number, number][]
}

/**
 * Çizimi bitir: doğrula, merkeze taşı, sarımı normalleştir.
 *
 * `null` dönüyorsa çizim kabul edilemez ve araç onu commit ETMEMELİ —
 * dejenere bir düğüm yaratmaktansa kullanıcıyı çizmeye devam ettirmek iyi.
 *
 * **Neden merkeze taşınıyor:** düğümün `position`'ı ile `polygon`'ı ayrı
 * yaşıyor; poligon dünya koordinatında bırakılsaydı mezzanine'i taşımak
 * şekli yerinde bırakırdı. Merkez = konum kuralı, döndürmenin de şeklin
 * ortasından olmasını sağlıyor.
 */
export function finishOutline(points: readonly Point2[]): FinishedOutline | null {
  if (points.length < 3) return null
  const area = signedArea(points)
  if (Math.abs(area) < MIN_AREA_M2) return null

  // Tek yöne normalleştir: iki farklı sarım, aynı şekli iki farklı poligon
  // olarak saklamak demekti ve karşılaştırma/testler ayrışırdı.
  const ordered = area < 0 ? [...points].reverse() : [...points]
  const [cx, cz] = centroidOf(ordered)

  return {
    position: [cx, 0, cz],
    polygon: ordered.map(([x, z]) => [x - cx, z - cz]),
  }
}
