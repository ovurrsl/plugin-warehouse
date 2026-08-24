/**
 * Kat döşemesi/tavanı delme plumbing'i — host'un `verticalOpening` yeteneği
 * için ortak taban.
 *
 * Host, bu yeteneği bildiren her kind'a iki soru soruyar: *deliğin dünya XZ
 * poligonu nedir* ve *bu yüzeyi deliyor musun*. İkinci soru göründüğünden
 * incelikli, ve yanlış cevabı sessiz: fazla delmek zemini boşaltır, eksik
 * delmek makineyi kapalı bir döşemenin içinden geçirir. İkisi de hata vermez.
 *
 * ## Kotların yeniden tabanlanması
 *
 * Host, düğümü KENDİ katının kotuna yerleştiriyor; dolayısıyla bir düğümün
 * dikey aralığı da kendi katına GÖRE ifade edilir (kendi katı = 0). Aynı
 * kural `palletlift/levels.ts`'te de geçerli ve orada bir testle kilitli.
 * Buradaki kat kotları da aynı biçimde yeniden tabanlanıyor, yoksa bina
 * zemininden ölçülen mutlak kotlarla karşılaştırma yapılır ve delikler
 * makineyle birlikte kaymaz.
 *
 * ## Yüzey düzlemi nerede
 *
 * Bir katın DÖŞEMESİ katın tabanında, TAVANI ise tepesinde — yani bir üstteki
 * katın döşemesiyle aynı düzlemde. `surfacePlaneY` bu ikisini ayırır; host
 * yüzey türünü argüman olarak veriyor (bkz. `VerticalOpeningConfig`).
 */

import { buildingOfLevel, levelElevationsOfBuilding, parentLevelIdOf } from './host-adapter'

/** mm'nin binde biri — kat kotu karşılaştırmalarının toleransı. */
const EPS = 1e-6

/** Host'un yüzey türü argümanı. */
export type OpeningSurface = 'slab' | 'ceiling'

/** Bir düğümün kendi katına GÖRE dikey aralığı, metre. */
export type VerticalSpan = { bottom: number; top: number }

/**
 * Bir yüzeyin düzlem kotu, düğümün kendi katına göre — çözülemezse `null`.
 *
 * Döşeme katın tabanında. Tavan katın tepesinde: bir üst kat varsa ONUN
 * tabanıyla aynı düzlem (`baseElevation` kaymalarını da böyle miras alır),
 * yoksa kat tabanı + kat yüksekliği.
 */
export function surfacePlaneY(
  nodes: Readonly<Record<string, unknown>>,
  node: unknown,
  levelId: string,
  surface: OpeningSurface,
): number | null {
  const ownLevelId = parentLevelIdOf(nodes, node)
  const buildingId = buildingOfLevel(nodes, ownLevelId)
  if (!buildingId) return null

  const entries = levelElevationsOfBuilding(nodes, buildingId)
  const index = entries.findIndex((entry) => entry.id === levelId)
  if (index < 0) return null

  const own = entries.find((entry) => entry.id === ownLevelId)
  if (!own) return null

  const entry = entries[index]!
  const planeY =
    surface === 'slab' ? entry.baseY : (entries[index + 1]?.baseY ?? entry.baseY + entry.height)

  return planeY - own.baseY
}

/**
 * Aralık bu yüzeyi deliyor mu?
 *
 * Kapsayıcılık host asansörünün davranışını yansıtıyor: makinenin OTURDUĞU
 * döşeme delinmez (aralığın tabanı ona eşit), vardığı döşeme delinir
 * (aralığın tepesi ona eşit). Yani alt uç dışlayıcı, üst uç kapsayıcı —
 * `bottom < düzlem ≤ top`. Diğer türlüsü makinenin altındaki zemini de
 * keserdi.
 */
export function crossesSurface(
  nodes: Readonly<Record<string, unknown>>,
  node: unknown,
  levelId: string,
  surface: OpeningSurface,
  span: VerticalSpan,
): boolean {
  const planeY = surfacePlaneY(nodes, node, levelId, surface)
  if (planeY === null) return false
  return planeY > span.bottom + EPS && planeY <= span.top + EPS
}

/**
 * Dünya XZ'de eksen-hizalı olmayan dikdörtgen — yerel yarı-boyutlar, düğümün
 * Y sapması ve dünya konumundan.
 */
export function rectOpening(
  position: readonly [number, number, number],
  yaw: number,
  halfWidth: number,
  halfDepth: number,
): Array<[number, number]> {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]
  // three'nin Y dönüşü konvansiyonu — `spiral-metrics.ts screwYawPerStep`'in
  // işaretiyle aynı çerçeve.
  return corners.map(([x, z]) => [
    position[0] + (x * cos + z * sin),
    position[2] + (-x * sin + z * cos),
  ])
}

/** Çokgene yaklaştırılmış daire — yuvarlak gövdeli makineler için. */
export function circleOpening(
  position: readonly [number, number, number],
  radius: number,
  segments = 16,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    out.push([position[0] + radius * Math.cos(t), position[2] + radius * Math.sin(t)])
  }
  return out
}

/**
 * `capabilities.verticalOpening` — host sözleşmesinde var, YAYINLANMIŞ
 * `@pascal-app/core` tiplerinde HENÜZ YOK.
 *
 * Yetenek editörün `integration` dalında; npm'deki sürüm onu tanımıyor. Anahtarı
 * doğrudan `capabilities` sözlüğüne yazmak, eklenti CI'ının kurduğu yayınlanmış
 * peer'e karşı TS2353 ("bilinmeyen özellik") verir — bu paket `ItemCatalog`
 * yüzünden bir kez böyle kırıldı ve 925 test modül yüklenemediği için hiç
 * koşmamıştı.
 *
 * Yayılım (spread) fazla-özellik denetimini atlar, yani anahtar tip hatası
 * vermeden geçer ve host onu ÇALIŞMA ZAMANINDA zaten dinamik olarak okur
 * (`nodeRegistry.get(type)?.capabilities?.verticalOpening`). Böylece eski bir
 * host'ta hiçbir şey olmaz, yenisinde çalışır.
 *
 * `HostVerticalOpening` host tipinin AYNASI — `levels.ts`'in
 * `elevator-service.ts`'i aynalamasının aynısı. Host tipi yayınlandığında bu
 * yardımcı silinip anahtar doğrudan yazılabilir; `compat.ts` sondası o güne
 * kadar sessiz uyumsuzluğu görünür kılar.
 */
export type HostVerticalOpening = {
  polygon: (node: unknown, nodes: Readonly<Record<string, unknown>>) => Array<[number, number]>
  servesLevel: (
    node: unknown,
    levelId: string,
    nodes: Readonly<Record<string, unknown>>,
    surface: OpeningSurface,
  ) => boolean
}

export function verticalOpening(config: HostVerticalOpening): {
  readonly verticalOpening: HostVerticalOpening
} {
  return { verticalOpening: config }
}
