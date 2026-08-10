import { bayWidthM, channelDepthM, channelPitchM, frameHeightM } from './metrics'
import type { LiveRackingNode } from './schema'

/**
 * Hangi kanal hangisine bitişik.
 *
 * ## Canlı raf bir BLOK
 *
 * `definition.ts` bir zamanlar tersini yazıyordu — "canlı raf kanalları çerçeve
 * paylaşmıyor". O cümle mıknatıs kapsam dışıyken yazılmıştı ve bir katalog
 * ölçüsüne değil, o günkü koda dayanıyordu. Yerçekimi kanalları gerçekte bir
 * blok olarak kuruluyor: dikme hatları kanal aralığında dizilir ve her hat, iki
 * yanındaki kanalın ortak taşıyıcısıdır. On kanal on bir hatta oturur, yirmi
 * hatta değil.
 *
 * Kanal kendi düğümü olduğu için, önlem alınmazsa her biri iki hattını da
 * kuruyor ve her ek yerinde aynı yerde iki sıra dikme oluyor: iki katı çelik,
 * çakışan yüzlerde z-fighting, ve yan kafesin iki panelinin 90 mm arayla
 * birbirine girmesi.
 *
 * Bu yüzden bir kanal **sol** hattını her zaman, **sağ** hattını yalnız
 * bitişiğinde kimse yokken kuruyor. Bir aralıkta duran iki kanal böylece üç hat
 * üretiyor. Kanalı çekip ayırın, sağ komşusu gitmiş olduğu için kendi kapatıcı
 * hattını geri büyütüyor.
 *
 * ## Neden drive-in ile paylaşılmıyor
 *
 * Dosya `drivein/neighbours.ts`'in `lanePitch` yerine `channelPitchM` konmuş
 * hâli. Paylaşılmamasının sebebi iki kindʼin birbiriyle çerçeve
 * PAYLAŞMAMASI gereken şey olması: aynı aralıkta duran bir drive-in koridoru ile
 * bir canlı raf kanalının dikmeleri farklı derinliklerde ve farklı
 * yüksekliklerde duruyor. Birinin hattını atlamak çeliği toparlamaz, açık bırakır.
 *
 * Bir kanalın başka bir düğüme baktığı tek yer burası, ve salt okunur.
 */

/** Yarım milimetre. Konumlar ızgara ve mıknatıstan geliyor, yani bundan çok
 *  daha iyi uyuşuyorlar; tolerans float sapması için, "yeterince yakın" için
 *  değil. */
const POSITION_EPSILON = 5e-4
/** ~0.03°. İki kanalın çerçevesinin çakışması için aynı yöne bakmaları şart. */
const ANGLE_EPSILON = 5e-4
const TWO_PI = Math.PI * 2

type ChannelLike = {
  id: string
  type?: unknown
  position?: unknown
  rotation?: unknown
}

function asChannel(node: unknown): ChannelLike | null {
  const record = node as ChannelLike | null
  if (record?.type !== 'warehouse:live-rack') return null
  if (typeof record.id !== 'string') return null
  if (!Array.isArray(record.position) || !Array.isArray(record.rotation)) return null
  return record
}

/**
 * Düğüm nesnesine memoize: store yalnız gerçekten değişen düğümü değiştiriyor,
 * ve bu indeks HER store yazımında yeniden kuruluyor — sürükleme sırasında her
 * `pointermove`'da. Kaydırıcı taranırken kanalların neredeyse hepsi bir önceki
 * yazımdaki nesnenin aynısı, dolayısıyla anahtarı bir dizi tahsisi ve birleştirme
 * değil, tek bir arama oluyor.
 */
const shapeKeys = new WeakMap<object, string>()

export function shapeKeyOf(channel: unknown): string | null {
  const record = asChannel(channel)
  return record ? shapeKey(record as unknown as LiveRackingNode) : null
}

/**
 * İki kanalın bir dikme hattını paylaşabilmesi için uyuşması gereken anahtar.
 *
 * Ham alanlar değil TÜRETİLMİŞ ölçüler: hattı yerleştiren şey bay genişliği,
 * kanal derinliği ve çerçeve yüksekliği. Farklı `levels` ile aynı toplam
 * yüksekliğe çıkan iki kanalın çerçevesi gerçekten aynı, ve ham alan listesi
 * onları boş yere ayırırdı. Ters yön daha önemli: `gradient` ya da
 * `withRetainers` gibi hattı dolaylı oynatan bir alanı listeye yazmayı unutmak
 * mümkün değil, çünkü ikisi de bu üç sayıdan geçiyor.
 *
 * `cladRack` ayrıca duruyor — yüksekliği değiştirmesinin yanında iki hattı
 * bağlayan başlık kirişini de ekliyor. `uprightColor` da: paylaşılan hat
 * komşunun rengini alır, ve iki farklı renkte kanalın ek yerinde hangisinin
 * kazandığı sessiz bir sürpriz olurdu.
 */
function shapeKey(channel: LiveRackingNode): string {
  const cached = shapeKeys.get(channel as unknown as object)
  if (cached !== undefined) return cached
  const rotation = channel.rotation?.[1] ?? 0
  // Kuantalamadan önce [0, 2π)'ye normalleniyor: 0 ile 2π aynı yöne bakıyor, ve
  // host'un döndürme aracı sarmak yerine biriktirdiği için tam turu atmış bir
  // kanal oraya gerçekten ulaşıyor.
  const turn = ((rotation % TWO_PI) + TWO_PI) % TWO_PI
  const key = [
    Math.round(turn / ANGLE_EPSILON),
    bayWidthM(channel).toFixed(5),
    channelDepthM(channel).toFixed(5),
    frameHeightM(channel).toFixed(5),
    channel.cladRack,
    channel.uprightColor,
  ].join('|')
  shapeKeys.set(channel as unknown as object, key)
  return key
}

function positionKey(x: number, z: number): string {
  return `${Math.round(x / POSITION_EPSILON)}:${Math.round(z / POSITION_EPSILON)}`
}

/**
 * Sağ komşunun duracağı yer: kanalın kendi yerel +X'i boyunca bir aralık,
 * dünyaya döndürülmüş.
 *
 * +Y dönüşü yerel +X'i dünya (cos, −sin)'e taşıyor — yerleştirme aracının ve
 * mıknatısın kullandığı işaret uzlaşımının aynısı. Ters yazmak kanalı komşusunun
 * yanlış tarafına mıknatıslardı ve neredeyse doğru görünürdü.
 */
export function rightNeighbourPosition(channel: LiveRackingNode): [number, number] {
  const [x, , z] = channel.position
  const rotationY = channel.rotation?.[1] ?? 0
  const pitch = channelPitchM(channel)
  return [x + pitch * Math.cos(rotationY), z - pitch * Math.sin(rotationY)]
}

let indexedFrom: unknown = null
let index: ReadonlySet<string> = new Set()

function build(nodes: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const byPlace = new Map<string, string>()
  const channels: Array<{ channel: LiveRackingNode; shape: string }> = []

  for (const value of Object.values(nodes)) {
    const record = asChannel(value)
    if (!record) continue
    const channel = record as unknown as LiveRackingNode
    const shape = shapeKey(channel)
    channels.push({ channel, shape })
    const [x, , z] = channel.position
    byPlace.set(`${shape}@${positionKey(x ?? 0, z ?? 0)}`, channel.id)
  }

  const withRight = new Set<string>()
  for (const { channel, shape } of channels) {
    const [x, z] = rightNeighbourPosition(channel)
    const found = byPlace.get(`${shape}@${positionKey(x, z)}`)
    // `found !== channel.id` sıfır aralığa karşı: bay genişliğinin alt sınırı
    // varken olamaz, ama kendini kendi komşusu sayan bir kanal sağ çerçevesini
    // sessizce silerdi ve hiçbir şey sebebini söylemezdi.
    if (found !== undefined && found !== channel.id) withRight.add(channel.id)
  }
  return withRight
}

/** Sağında bitişik bir kanal var mı — varsa sağ dikme hattını ona bırakıyor. */
export function hasRightNeighbour(
  nodes: Readonly<Record<string, unknown>>,
  channelId: string,
): boolean {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index.has(channelId)
}

/** Memo'yu düşürür. Yalnız testler arasında indeks sızmasın diye gerekli. */
export function resetNeighbourIndex(): void {
  indexedFrom = null
  index = new Set()
}

export function placeKey(x: number, z: number): string {
  return positionKey(x, z)
}
