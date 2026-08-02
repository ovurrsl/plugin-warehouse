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

// ── Dikdörtgen kısayolu ─────────────────────────────────────────────────────

/**
 * İki karşı köşeden eksen hizalı dikdörtgen.
 *
 * Çizim artık asma katın TEK yerleştirme yolu, ve bir asma katın çoğu zaman
 * dikdörtgen olduğu doğru. Dört köşeyi tek tek tıklatmak, sık olanı zor
 * yapmak olurdu — iki tıklama + Enter bir dikdörtgen veriyor.
 *
 * Sarım burada normalleştirilmiyor; `finishOutline` zaten yapıyor ve iki yerde
 * yapmak ikisinin ayrışması demekti.
 */
export function rectangleFrom(a: Point2, b: Point2): Point2[] {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ]
}

// ── Ölçü ────────────────────────────────────────────────────────────────────

export type OutlineBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  widthM: number
  depthM: number
}

export function outlineBounds(polygon: readonly Point2[]): OutlineBounds {
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return { minX, maxX, minZ, maxZ, widthM: maxX - minX, depthM: maxZ - minZ }
}

/**
 * Anahat eksen hizalı bir dikdörtgen mi.
 *
 * Panelin "Genişlik / Derinlik" kontrollerini göstermesinin ÖLÇÜTÜ bu. Keyfî
 * bir L şeklinde genişlik ve derinlik yazmak, ölçüyü sınır kutusuna
 * indirgeyip şekli sessizce dikdörtgene çevirmek olurdu — bu turda temizlenen
 * "yalan söyleyen kontrol" hatasının aynısı.
 *
 * Tolerans milimetre altı: bir köşeyi elle sürükleyip neredeyse hizalayan
 * kullanıcı dikdörtgen kontrollerini geri kazanmamalı, çünkü şekli artık
 * dikdörtgen değil.
 */
export function isAxisAlignedRectangle(polygon: readonly Point2[], tolerance = 1e-4): boolean {
  if (polygon.length !== 4) return false
  const { minX, maxX, minZ, maxZ } = outlineBounds(polygon)
  if (maxX - minX < tolerance || maxZ - minZ < tolerance) return false
  // Dört köşenin dördü de sınır kutusunun dört köşesinden biri olmalı, ve
  // hepsi FARKLI köşeler olmalı — aksi hâlde ikisi üst üste binen dejenere bir
  // dörtgen de geçerdi.
  const seen = new Set<string>()
  for (const [x, z] of polygon) {
    const onX = Math.abs(x - minX) < tolerance || Math.abs(x - maxX) < tolerance
    const onZ = Math.abs(z - minZ) < tolerance || Math.abs(z - maxZ) < tolerance
    if (!onX || !onZ) return false
    seen.add(`${Math.abs(x - minX) < tolerance ? 0 : 1}${Math.abs(z - minZ) < tolerance ? 0 : 1}`)
  }
  return seen.size === 4
}

/**
 * Dikdörtgen anahattı yeni ölçüye getir — merkez sabit.
 *
 * Merkezden büyütmek, kenardan büyütmekten daha az sürpriz: düğümün
 * `position`'ı ağırlık merkezinde duruyor ve bir kenarı sabitlemek, panelden
 * genişliği değiştiren kullanıcının yapıyı ekranda KAYIYOR görmesi demekti.
 *
 * Dikdörtgen olmayan şekle uygulanmaz — çağıran `isAxisAlignedRectangle` ile
 * ayırıyor; yine de burada `null` dönerek sözleşmeyi tek yerde kilitliyoruz.
 */
export function withRectangleSize(
  polygon: readonly Point2[],
  widthM: number,
  depthM: number,
): Point2[] | null {
  if (!isAxisAlignedRectangle(polygon)) return null
  if (widthM * depthM < MIN_AREA_M2) return null
  const { minX, maxX, minZ, maxZ } = outlineBounds(polygon)
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const hw = widthM / 2
  const hd = depthM / 2
  return rectangleFrom([cx - hw, cz - hd], [cx + hw, cz + hd])
}

/**
 * Keyfî anahattı merkezden ölçekle.
 *
 * Dikdörtgen olmayan bir güvertenin ölçüsünü değiştirmenin ŞEKLİ BOZMAYAN tek
 * yolu bu. Genişlik/derinlik yazdırmak L şeklini dikdörtgene çevirirdi;
 * ölçekleme oranları koruyor ve panel ne yaptığını söylüyor.
 */
export function withOutlineScaled(polygon: readonly Point2[], factor: number): Point2[] | null {
  if (!(factor > 0)) return null
  const scaled = polygon.map(([x, z]) => [x * factor, z * factor] as Point2)
  return Math.abs(signedArea(scaled)) < MIN_AREA_M2
    ? null
    : scaled.map((p) => [...p] as [number, number])
}

/**
 * Var olan bir anahatta köşe taşı / ekle / sil.
 *
 * **Yeniden merkezleme YOK — bilerek.** `finishOutline` yeni çizimde konumu
 * ağırlık merkezine oturtuyor; ama düzenlemede merkez her köşe hamlesinde
 * kayar, ve merdivenler/kapılar mezzanine-YEREL koordinatta durduğu için
 * yerel çerçevenin kayması onları görsel olarak yerinden oynatırdı. Düzenleme
 * konumu sabit tutar, yalnız köşeleri değiştirir.
 *
 * Üçü de dejenere sonucu REDDEDER (null): alanı `MIN_AREA_M2` altına düşüren
 * bir hamle commit edilmemeli — çağıran eski hâli korur.
 */
export function withVertexMoved(
  polygon: readonly Point2[],
  index: number,
  next: Point2,
): Point2[] | null {
  if (index < 0 || index >= polygon.length) return null
  const moved = polygon.map((p, i) => (i === index ? next : p))
  return Math.abs(signedArea(moved)) < MIN_AREA_M2
    ? null
    : moved.map((p) => [...p] as [number, number])
}

/** `index` kenarının ortasına yeni köşe — kenar `index → index+1`. */
export function withVertexInserted(
  polygon: readonly Point2[],
  edgeIndex: number,
  point: Point2,
): Point2[] | null {
  if (edgeIndex < 0 || edgeIndex >= polygon.length) return null
  const inserted = [...polygon.slice(0, edgeIndex + 1), point, ...polygon.slice(edgeIndex + 1)]
  return Math.abs(signedArea(inserted)) < MIN_AREA_M2
    ? null
    : inserted.map((p) => [...p] as [number, number])
}

export function withVertexRemoved(polygon: readonly Point2[], index: number): Point2[] | null {
  // Üç köşe bir alanın alt sınırı — daha azı şekil değil.
  if (polygon.length <= 3 || index < 0 || index >= polygon.length) return null
  const removed = polygon.filter((_, i) => i !== index)
  return Math.abs(signedArea(removed)) < MIN_AREA_M2
    ? null
    : removed.map((p) => [...p] as [number, number])
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
 * ortasından olmasını sağlıyor. (Düzenleme bunun TERSİNİ yapıyor — bkz.
 * `withVertexMoved`ün notu.)
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
