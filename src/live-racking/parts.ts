/**
 * Canlı raf parçaları — kutu listesi, ailenin `role+center+size` deseni.
 *
 * Eğik olan tek şey kanal profilidir ve `tiltX` onun için var. **Makaralar
 * eğilmez ve bu bir eksiklik değil:** makara ekseni X'tir (bay genişliği),
 * bir silindiri kendi ekseni etrafında döndürmek görsel olarak hiçbir şey
 * yapmaz. Makaranın eğimi konumundan gelir — art arda gelen her makara bir
 * öncekinden `pitch · gradient` kadar alçakta durur.
 *
 * Akış donanımı (fren makarası + tamburu, ortalayıcı, tutucu, çıkış kirişi,
 * son durdurucu) bu dosyada; kanalın FIFO mu LIFO mu olduğu gerçek bir şekil
 * farkı üretir — `pushChannelEnd` ikisini ayırır.
 */

import {
  ANCHOR_BOLT_HEIGHT_M,
  ANCHOR_BOLT_M,
  BRACE_BAY_TARGET_M,
  BRAKE_DRUM_DIAMETER_M,
  BRAKE_DRUM_WIDTH_M,
  BRAKE_ROLLER_RAISE_M,
  CENTRALISING_STRIP_ANGLE_RAD,
  CENTRALISING_STRIP_HEIGHT_M,
  CENTRALISING_STRIP_LENGTH_M,
  CENTRALISING_STRIP_THICKNESS_M,
  CHANNEL_PROFILE_HEIGHT_M,
  CHANNEL_PROFILE_WIDTH_M,
  CLAD_RACK_HEADER_M,
  DIAGONAL_THICKNESS_M,
  DYNAMIC_BEAM_HEIGHT_M,
  DYNAMIC_BEAM_THICKNESS_M,
  END_STOP_HEIGHT_M,
  EXIT_BEAM_BUMPER_M,
  EXIT_BEAM_HEIGHT_M,
  HINGE_KNUCKLE_M,
  LEVELLING_PLATE_THICKNESS_M,
  RETAINER_BODY_HEIGHT_M,
  RETAINER_BODY_THICKNESS_M,
  RETAINER_PEDAL_LENGTH_M,
  RETAINER_PEDAL_THICKNESS_M,
  ROLLER_DIAMETER_M,
  ROLLER_TO_BRAKE_M,
  SPLIT_ROLLER_GAP_M,
  UPRIGHT_DEPTH_M,
  UPRIGHT_WIDTH_M,
} from './catalog'
import {
  bayWidthM,
  channelDepthM,
  channelDropM,
  frameHeightM,
  hasBrakeRollers,
  hasIntermediateRetainers,
  levelExitYM,
  rollerLengthM,
} from './metrics'
import type { LiveRackingNode } from './schema'

export type LiveRackingPartRole =
  | 'upright'
  | 'diagonal'
  | 'footplate'
  | 'anchor'
  | 'beam'
  | 'channel'
  | 'roller'
  | 'brake-roller'
  | 'brake-drum'
  | 'centraliser'
  | 'retainer'
  | 'exit-beam'
  | 'end-stop'
  | 'hinge'

export type LiveRackingPart = {
  role: LiveRackingPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  /** ZY düzleminde eğim — kanal profili ve `simple` makara şeridi kullanır. */
  tiltX?: number
  /** Plan düzleminde dönüş — yalnız ortalayıcı şeritler kullanır. */
  rotationY?: number
}

/** Uzak katman: makaralar teker teker çizilmez, kanal tek bir şerit olur. */
export type LiveRackingDetail = 'full' | 'simple'

/**
 * Bir dikme, plakası ve ankrajlarıyla birlikte.
 *
 * Üçü tek yerde, çünkü ayrıyken ayrılabiliyorlardı: yan kafesin ara dikmeleri
 * plaka alıp ankraj almadan eklenmişti. Zemine bağlanmamış bir plaka hiçbir
 * hata vermiyor, yalnız testin saydığı ankraj sayısı tutmuyor — ve o test
 * olmasa kimse fark etmezdi.
 */
function pushPost(parts: LiveRackingPart[], x: number, z: number, height: number): void {
  parts.push({
    role: 'upright',
    center: [x, height / 2, z],
    size: [UPRIGHT_WIDTH_M, height, UPRIGHT_DEPTH_M],
  })
  parts.push({
    role: 'footplate',
    center: [x, LEVELLING_PLATE_THICKNESS_M / 2, z],
    size: [UPRIGHT_WIDTH_M * 1.6, LEVELLING_PLATE_THICKNESS_M, UPRIGHT_DEPTH_M * 1.6],
  })
  // Ankraj: plakanın iki ucundan zemine. Silindir değil kutu — bu paketin
  // bütün geometrisi kutu-listesi ve emitter silindir üretmiyor.
  for (const bolt of [-1, 1] as const) {
    parts.push({
      role: 'anchor',
      center: [x, ANCHOR_BOLT_HEIGHT_M / 2, z + bolt * UPRIGHT_DEPTH_M * 0.6],
      size: [ANCHOR_BOLT_M, ANCHOR_BOLT_HEIGHT_M, ANCHOR_BOLT_M],
    })
  }
}

/**
 * Dikmeler + taban plakaları + ankrajlar. Kafes AYRI (`pushSideBracing`).
 *
 * Kanal derinliği boyunca iki dikme hattı: giriş (+Z) ve çıkış (−Z) uçlarında.
 * Gerçek bir kanal daha fazla ara dikme taşır ama görsel olarak uçlar yapının
 * okunmasına yetiyor ve ara ÇERÇEVELER makaraları gizliyor.
 */
function pushFrames(parts: LiveRackingPart[], node: LiveRackingNode): void {
  const halfWidth = bayWidthM(node) / 2
  const halfDepth = channelDepthM(node) / 2
  const height = frameHeightM(node)

  for (const z of [-halfDepth, halfDepth] as const) {
    for (const side of [-1, 1] as const) {
      pushPost(parts, side * (halfWidth - UPRIGHT_WIDTH_M / 2), z, height)
    }
    // Giydirme rafta dikmeler çatıyı taşıyor: tepede onları bağlayan başlık
    // kirişi olmadan yük aktaracak bir yol yok, ve raf gözle de bir bina
    // gibi okunmaz.
    if (node.cladRack) {
      parts.push({
        role: 'beam',
        center: [0, height - CLAD_RACK_HEADER_M / 2, z],
        size: [halfWidth * 2, CLAD_RACK_HEADER_M, CLAD_RACK_HEADER_M],
      })
    }
  }
}

/**
 * Kafes, kanalın UZUN kenarlarında — giriş ve çıkış yüzleri açık kalıyor.
 *
 * ## Neden burası, orası değil
 *
 * Kafes önce giriş (+Z) ve çıkış (−Z) yüzlerine kuruluyordu: çaprazlar X
 * boyunca, iki dikme hattının arasında geriliyordu. Yani paletin İÇERİ
 * girdiği ve dışarı çıktığı iki yüz çelikle kapatılmıştı. Canlı rafta o iki
 * yüz forkliftin geçtiği yer; kapalı olamaz.
 *
 * Doğrusu paketin kendi palet rafında zaten yazılı (`rack/parts.ts`,
 * `pushFrameBracing`): kafes DERİNLİK düzleminde, dikme hattı boyunca durur;
 * koridora bakan yüzü kirişler bağlar, çaprazlar değil. Canlı raf da aynı
 * ailenin üyesi — tek farkı derinliğin bir palet değil bir kanal boyu olması.
 *
 * ## Neden Z boyunca bölünüyor
 *
 * Palet rafında derinlik ~1,1 m, yükseklik ~5 m, dolayısıyla zikzak yalnız
 * yüksekliğe bölünür ve her çapraz derinliği bir adımda geçer. Burada tam
 * tersi: kanal 8–10 m, çerçeve 2–4 m. Aynı formül neredeyse YATAY çubuklar
 * üretirdi — kafes değil, korkuluk.
 *
 * Bu yüzden kafes bir IZGARA: kanal önce Z'de gözlere bölünüyor
 * (`BRACE_BAY_TARGET_M`), sonra her göz kendi boyu kadar yüksek katlara. İki
 * bölme birbirini izlediği için hücreler kareye yakın kalıyor ve çaprazlar
 * ~45°'ye oturuyor. Oran SEÇİLMİŞ bir varsayılan, katalog ölçüsü değil —
 * kaynağı çaprazlı gözün standart pratiği; belirli bir üreticinin canlı raf
 * yan kafesi için yayımlanmış göz boyunu bulamadım.
 *
 * Göz sınırlarına ara dikme giriyor, yoksa çapraz hiçbir şeye bağlanmadan
 * havada biterdi. Bunlar kanalın yanında duruyor, karşıdan karşıya geçmiyor,
 * yani uç ÇERÇEVELERİN aksine makaraları gizlemiyorlar.
 */
function pushSideBracing(parts: LiveRackingPart[], node: LiveRackingNode): void {
  const halfWidth = bayWidthM(node) / 2
  const halfDepth = channelDepthM(node) / 2
  const height = frameHeightM(node)

  // Rafınkiyle aynı pay: en alttaki bağ taban plakasının üstünde, en üstteki
  // dikmenin tepesinin altında kalıyor. Döndürülmüş kesiti uçlarından taşan
  // çaprazın zeminden çıkmasını da bu engelliyor.
  const braceBottom = 0.15
  const braceTop = Math.max(braceBottom + 0.3, height - 0.1)
  const bracedHeight = braceTop - braceBottom

  // Dikme yüzleri arasındaki net açıklık — dikmelerin kendi kalınlığı düşülmüş.
  const span = 2 * halfDepth - UPRIGHT_DEPTH_M
  const bays = Math.max(1, Math.round(span / BRACE_BAY_TARGET_M))
  const bayLength = span / bays
  // Düşey bölme göz boyunu İZLİYOR, sabit bir modülü değil: gözler kareye
  // yakın kalınca çaprazlar ~45°'ye oturuyor. Sabit modül (rafın 0,9 m'si)
  // burada 2,4 m'lik bir gözde neredeyse yatay çubuk üretirdi.
  const lifts = Math.max(2, Math.round(bracedHeight / bayLength))
  const liftHeight = bracedHeight / lifts
  // Çubuğun yerel +Y'si (bayLength, liftHeight) köşegenine oturmalı, yani açı
  // atan2(yatay, düşey). Tümleyeni — kolay hata — iki izdüşümü takas edip
  // çaprazı kafesin dışına savuruyor.
  const lean = Math.atan2(bayLength, liftHeight)
  const diagonal = Math.hypot(bayLength, liftHeight)

  for (const side of [-1, 1] as const) {
    const x = side * (halfWidth - UPRIGHT_WIDTH_M / 2)

    // Kafesi kapatan iki yatay bağ, kanal boyu.
    for (const tieY of [braceBottom, braceTop]) {
      parts.push({
        role: 'diagonal',
        center: [x, tieY, 0],
        size: [DIAGONAL_THICKNESS_M, DIAGONAL_THICKNESS_M, span],
      })
    }

    for (let bay = 0; bay < bays; bay++) {
      const centerZ = -span / 2 + (bay + 0.5) * bayLength
      for (let lift = 0; lift < lifts; lift++) {
        parts.push({
          role: 'diagonal',
          center: [x, braceBottom + (lift + 0.5) * liftHeight, centerZ],
          size: [DIAGONAL_THICKNESS_M, diagonal, DIAGONAL_THICKNESS_M],
          // Üst üste binen gözler zıt yöne yatıyor — zikzak bu. Göz sütunu da
          // kaydırılıyor, yoksa komşu sütunlar birbirinin aynası olurdu.
          tiltX: ((bay + lift) % 2 === 0 ? 1 : -1) * lean,
        })
      }

      // Gözü kapatan ara dikme. Son gözün öteki kenarı zaten uç dikmesi.
      if (bay === bays - 1) continue
      pushPost(parts, x, -span / 2 + (bay + 1) * bayLength, height)
    }
  }
}

/**
 * Bir katın taşıyıcı kirişleri: giriş ve çıkış uçlarında, X boyunca.
 *
 * Kirişin üstü kanalın o uçtaki kotunun altındadır — kanal profili kirişin
 * üstüne oturur, makaralar da profilin içine.
 */
function pushLevelBeams(parts: LiveRackingPart[], node: LiveRackingNode, level: number): void {
  const width = bayWidthM(node)
  const halfDepth = channelDepthM(node) / 2
  const exitY = levelExitYM(node, level)
  const entryY = exitY + channelDropM(node)

  const beamTop = (y: number) => y - CHANNEL_PROFILE_HEIGHT_M
  for (const [z, y] of [
    [-halfDepth, exitY],
    [halfDepth, entryY],
  ] as const) {
    parts.push({
      role: 'beam',
      center: [0, beamTop(y) - DYNAMIC_BEAM_HEIGHT_M / 2, z],
      size: [width, DYNAMIC_BEAM_HEIGHT_M, DYNAMIC_BEAM_THICKNESS_M],
    })
  }
}

/**
 * Bir katın iki kanal profili (rayı) — EĞİK olan tek parça.
 *
 * Profil, kanalın tam boyunca giriş ucundan çıkış ucuna iner. Eğim
 * `atan(gradient)`; %4 için 2.29°. Kutunun Z boyu, eğik mesafeyi karşılamak
 * için `depth / cos(tilt)` — düz boy verilse profil uçlarda kısa kalırdı.
 */
function pushChannelProfiles(parts: LiveRackingPart[], node: LiveRackingNode, level: number): void {
  const depth = channelDepthM(node)
  const drop = channelDropM(node)
  const tilt = Math.atan(node.gradient)
  const exitY = levelExitYM(node, level)
  // Kanalın orta noktası: iki uç kotunun ortası.
  const midY = exitY + drop / 2
  const railHalfSpan = rollerLengthM(node) / 2

  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'channel',
      center: [side * railHalfSpan, midY - CHANNEL_PROFILE_HEIGHT_M / 2, 0],
      size: [CHANNEL_PROFILE_WIDTH_M, CHANNEL_PROFILE_HEIGHT_M, depth / Math.cos(tilt)],
      // +Z ucu YÜKSEK: pozitif tilt +Z'yi yukarı kaldırır.
      tiltX: -tilt,
    })
  }
}

/**
 * Tek bir makara — bölünmüşse iki yarım.
 *
 * `splitRollers` sert mastlı araçlar (istif, turret, transtoker) içindir:
 * çatal kanalın ORTASINDAN geçer, o yüzden makara ikiye bölünür ve arada
 * `SPLIT_ROLLER_GAP_M` boşluk kalır. Bu, seçeneğin gerçek geometrik
 * karşılığı — bayrağın panelde durup hiçbir şey yapmadığı hâli değil.
 */
function pushRollerAt(
  parts: LiveRackingPart[],
  node: LiveRackingNode,
  role: 'roller' | 'brake-roller',
  y: number,
  z: number,
  diameter: number,
): void {
  const length = rollerLengthM(node)
  if (!node.splitRollers) {
    parts.push({ role, center: [0, y, z], size: [length, diameter, diameter] })
    return
  }
  const halfLength = (length - SPLIT_ROLLER_GAP_M) / 2
  if (halfLength <= 0) {
    parts.push({ role, center: [0, y, z], size: [length, diameter, diameter] })
    return
  }
  for (const side of [-1, 1] as const) {
    parts.push({
      role,
      center: [side * (SPLIT_ROLLER_GAP_M / 2 + halfLength / 2), y, z],
      size: [halfLength, diameter, diameter],
    })
  }
}

/**
 * Bir katın makaraları.
 *
 * Kutu olarak çizilir, silindir olarak değil: bir kanalda yüzlerce makara
 * var ve bu paketin bütün geometrisi kutu-listesi (rack'ın C-kesit dikmesi
 * bile). Ekseni X, boyu D = A + 30 mm. Eğim konumdan gelir — her makara bir
 * öncekinden `pitch · gradient` alçakta.
 *
 * `simple` katmanında makara ÜRETİLMEZ; onun yerine tek bir şerit çizilir
 * (uzaktan yüzlerce kutu, yüzlerce üçgen ve hiçbir bilgi).
 */
function pushRollers(
  parts: LiveRackingPart[],
  node: LiveRackingNode,
  level: number,
  detail: LiveRackingDetail,
): void {
  const depth = channelDepthM(node)
  const drop = channelDropM(node)
  const exitY = levelExitYM(node, level)
  const halfDepth = depth / 2

  if (detail === 'simple') {
    const tilt = Math.atan(node.gradient)
    parts.push({
      role: 'roller',
      center: [0, exitY + drop / 2 - ROLLER_DIAMETER_M / 2, 0],
      size: [rollerLengthM(node), ROLLER_DIAMETER_M, depth / Math.cos(tilt)],
      tiltX: -tilt,
    })
    return
  }

  const count = rollerGridCount(node)
  // Frenli pozisyonlar bu ızgaranın İNDEKSLERİ — orada sıradan makara yok,
  // frenli olan onun yerini alıyor. Atlanmazsa iki silindir iç içe geçiyor.
  const braked = brakeRollerIndices(node)
  for (let i = 0; i <= count; i++) {
    if (braked.has(i)) continue
    const t = i / count
    const z = -halfDepth + t * depth
    // Çıkış (−Z) alçak, giriş (+Z) yüksek.
    const y = exitY + t * drop
    pushRollerAt(parts, node, 'roller', y - ROLLER_DIAMETER_M / 2, z, ROLLER_DIAMETER_M)
  }
}

/** Bir kanaldaki makara ızgarasının aralık sayısı — indeksler 0..count. */
export function rollerGridCount(node: LiveRackingNode): number {
  return Math.max(2, Math.floor(channelDepthM(node) / node.rollerPitch))
}

/**
 * Frenli makaraların ızgara İNDEKSLERİ.
 *
 * Katalogun Z ofseti (`ROLLER_TO_BRAKE_M`) frenli makaranın hangi POZİSYONDA
 * olduğunu seçmek için var, ızgaranın dışına çıkmak için değil: gerçek üründe
 * frenli makara bir makara pozisyonudur, komşusunun içine sokulmuş ikinci bir
 * silindir değil.
 *
 * Önceki hâl ham Z'yi kullanıyordu ve ızgaraya oturmuyordu: varsayılan
 * düğümde 40 adet `brake-roller × roller` çifti çakışıyordu, ölçülen kesişim
 * 830 × 40,6 × 16 mm. Üstten bakınca temiz bir frenli makara değil, kalın
 * koyu bir bant çıkıyordu.
 */
export function brakeRollerIndices(node: LiveRackingNode): Set<number> {
  const indices = new Set<number>()
  if (!hasBrakeRollers(node)) return indices
  const depth = channelDepthM(node)
  const halfDepth = depth / 2
  const count = rollerGridCount(node)
  const step = depth / node.palletsDeep
  for (let i = 0; i < node.palletsDeep; i++) {
    const target = -halfDepth + (i + 0.5) * step + ROLLER_TO_BRAKE_M
    if (target > halfDepth) continue
    const index = Math.round(((target + halfDepth) / depth) * count)
    if (index >= 0 && index <= count) indices.add(index)
  }
  return indices
}

/**
 * Fren makaraları ve hız regülatörü tamburları.
 *
 * Katalog kuralı: yalnız İKİDEN derin kanalda (`hasBrakeRollers`). İki palet
 * derinlikte yerçekimi zaten kontrollü; üçüncüden itibaren paletin hızı
 * regüle edilmezse çıkışta çarpar.
 *
 * Palet başına bir fren makarası — her palet pozisyonu kendi hız
 * regülasyonunu görür. Sıradan makaradan `ROLLER_TO_BRAKE_M` (katalog ölçüsü
 * Z) kadar ötede ve `BRAKE_ROLLER_RAISE_M` kadar YUKARIDA durur: yükseklik
 * farkı paletin ağırlığını frene bindiren şeydir.
 *
 * Tambur makaranın ucuna takılır ve kanal profilinin dışında kalır — gerçek
 * üründe de öyle, regülatör kanalın yan yüzünden erişilebilir olmak zorunda.
 */
function pushBrakeRollers(parts: LiveRackingPart[], node: LiveRackingNode, level: number): void {
  if (!hasBrakeRollers(node)) return

  const depth = channelDepthM(node)
  const drop = channelDropM(node)
  const exitY = levelExitYM(node, level)
  const halfDepth = depth / 2
  const count = rollerGridCount(node)
  /**
   * Tambur kanal profilinin DIŞINDA.
   *
   * Önceki hâl `rollerLengthM/2 + genişlik/2` yazıyordu ve profilin kendi
   * genişliğini atlıyordu: 35 mm'lik tamburun 30 mm'si rayın içinde kalıyor,
   * dışarıda kalan 5 mm üstten görünüşün ölçeğinde üçte bir piksel ediyordu —
   * 32 tamburun hiçbiri görünmüyordu. Dosyanın kendi yorumu (yukarıda) tam
   * tersini söylüyor, ve canlı rafı sıradan makaralı kanaldan ayıran en
   * tanınır bileşen bu.
   */
  const drumX = rollerLengthM(node) / 2 + CHANNEL_PROFILE_WIDTH_M / 2 + BRAKE_DRUM_WIDTH_M / 2

  for (const index of brakeRollerIndices(node)) {
    const t = index / count
    const z = -halfDepth + t * depth
    const y = exitY + t * drop - ROLLER_DIAMETER_M / 2 + BRAKE_ROLLER_RAISE_M

    pushRollerAt(parts, node, 'brake-roller', y, z, ROLLER_DIAMETER_M)
    parts.push({
      role: 'brake-drum',
      center: [drumX, y, z],
      size: [BRAKE_DRUM_WIDTH_M, BRAKE_DRUM_DIAMETER_M, BRAKE_DRUM_DIAMETER_M],
    })
  }
}

/**
 * Giriş ağzındaki ortalama şeritleri.
 *
 * Palet kanala girerken tam ortalanmamışsa bu iki eğik şerit onu ortalar.
 * Ağız dışa doğru genişler: şeritler akış eksenine `±angle` ile durur, yani
 * +Z ucunda birbirinden uzak, kanala doğru yaklaşırlar.
 */
function pushCentralisers(parts: LiveRackingPart[], node: LiveRackingNode, level: number): void {
  const halfDepth = channelDepthM(node) / 2
  const entryY = levelExitYM(node, level) + channelDropM(node)
  const halfSpan = rollerLengthM(node) / 2
  const zCenter = halfDepth - CENTRALISING_STRIP_LENGTH_M / 2

  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'centraliser',
      center: [
        side * (halfSpan + CENTRALISING_STRIP_THICKNESS_M / 2),
        entryY + CENTRALISING_STRIP_HEIGHT_M / 2,
        zCenter,
      ],
      size: [
        CENTRALISING_STRIP_THICKNESS_M,
        CENTRALISING_STRIP_HEIGHT_M,
        CENTRALISING_STRIP_LENGTH_M,
      ],
      // Ağız +Z'de geniş: şerit içeri doğru kapanır.
      rotationY: side * CENTRALISING_STRIP_ANGLE_RAD,
    })
  }
}

/**
 * Bir tutucu: gövde + ağırlıkla çalışan pedal.
 *
 * Katalog mekanizması: ilk paletin ağırlığı pedala biner, pedal da ikinci
 * paleti tutan çubukları kaldırır. Pedal bu yüzden makara hattının hemen
 * ÜSTÜNDE ve gövdenin akış yönünde önünde duruyor.
 */
function pushRetainer(parts: LiveRackingPart[], node: LiveRackingNode, y: number, z: number): void {
  const halfSpan = rollerLengthM(node) / 2

  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'retainer',
      center: [
        side * (halfSpan + RETAINER_BODY_THICKNESS_M / 2),
        y + RETAINER_BODY_HEIGHT_M / 2,
        z,
      ],
      size: [RETAINER_BODY_THICKNESS_M, RETAINER_BODY_HEIGHT_M, RETAINER_BODY_THICKNESS_M],
    })
  }
  parts.push({
    role: 'retainer',
    center: [0, y + RETAINER_PEDAL_THICKNESS_M / 2, z + RETAINER_PEDAL_LENGTH_M / 2],
    size: [halfSpan * 2, RETAINER_PEDAL_THICKNESS_M, RETAINER_PEDAL_LENGTH_M],
  })
}

/**
 * Tutucular: çıkışta bir tane, uzun kanalda ara tutucular.
 *
 * `withRetainers` kanal DERİNLİĞİNİ de uzatıyor (`channelDepthM`, katalogun
 * 300 mm palet arası boşluğu) — yani seçenek zaten ölçüyü değiştiriyordu;
 * eksik olan görünür parçaydı.
 */
function pushRetainers(parts: LiveRackingPart[], node: LiveRackingNode, level: number): void {
  const depth = channelDepthM(node)
  const drop = channelDropM(node)
  const exitY = levelExitYM(node, level)
  const halfDepth = depth / 2

  const atDepthFraction = (t: number) => ({
    y: exitY + t * drop,
    z: -halfDepth + t * depth,
  })

  if (node.withRetainers) {
    // Çıkış ucunun hemen gerisinde: ilk paleti bırakırken ikinciyi tutar.
    const spot = atDepthFraction(Math.min(1, (0.3 + halfDepth) / depth))
    pushRetainer(parts, node, spot.y, spot.z)
  }

  if (hasIntermediateRetainers(node)) {
    // Kanalı üçe bölen iki nokta — uzun dizide palet trenini parçalar.
    for (const t of [1 / 3, 2 / 3] as const) {
      const spot = atDepthFraction(t)
      pushRetainer(parts, node, spot.y, spot.z)
    }
  }
}

/**
 * Kanalın çıkış ucu — **FIFO ile LIFO'nun tek gerçek geometrik farkı.**
 *
 * FIFO: −Z ucu gerçek bir çıkıştır, orada palet operatöre sunulur. Çıkış
 * kirişi paleti durdurur ve üstündeki tampon darbeyi alır.
 *
 * LIFO (push-back): −Z ucunda çıkış YOKTUR — palet aynı uçtan yüklenip aynı
 * uçtan alınır, dolayısıyla kanalın dip ucuna paletin dışarı düşmesini
 * engelleyen bir son durdurucu konur. Şema bunu zaten böyle tanımlıyordu;
 * eksik olan `parts.ts`'in `variant`'a bakmasıydı.
 */
function pushChannelEnd(parts: LiveRackingPart[], node: LiveRackingNode, level: number): void {
  const halfDepth = channelDepthM(node) / 2
  const exitY = levelExitYM(node, level)
  const width = rollerLengthM(node)

  if (node.variant === 'LIFO') {
    parts.push({
      role: 'end-stop',
      center: [0, exitY + END_STOP_HEIGHT_M / 2, -halfDepth],
      size: [width, END_STOP_HEIGHT_M, EXIT_BEAM_BUMPER_M],
    })
    return
  }

  parts.push({
    role: 'exit-beam',
    center: [0, exitY + EXIT_BEAM_HEIGHT_M / 2, -halfDepth],
    size: [width, EXIT_BEAM_HEIGHT_M, EXIT_BEAM_BUMPER_M],
  })
  // Tampon: kirişin akış tarafındaki yüzünde, darbeyi alan yumuşak şerit.
  parts.push({
    role: 'end-stop',
    center: [0, exitY + EXIT_BEAM_HEIGHT_M, -halfDepth + EXIT_BEAM_BUMPER_M],
    size: [width, EXIT_BEAM_BUMPER_M, EXIT_BEAM_BUMPER_M],
  })
}

/**
 * Menteşeli kanal — zemin katında bakım erişimi.
 *
 * Kanal çıkış ucundan yukarı kaldırılabilsin diye menteşelenir; altındaki
 * makara hattı ve fren donanımı böyle temizlenir. Görünür karşılığı, giriş
 * ucundaki menteşe boğumu: kanalın etrafında döndüğü eksen orası.
 */
function pushHinges(parts: LiveRackingPart[], node: LiveRackingNode): void {
  if (!node.hingedChannels) return
  const halfDepth = channelDepthM(node) / 2
  const entryY = levelExitYM(node, 0) + channelDropM(node)
  const halfSpan = rollerLengthM(node) / 2

  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'hinge',
      center: [side * halfSpan, entryY - CHANNEL_PROFILE_HEIGHT_M / 2, halfDepth],
      size: [HINGE_KNUCKLE_M, HINGE_KNUCKLE_M, HINGE_KNUCKLE_M],
    })
  }
}

/** Bütün kanalın parça listesi. */
export function liveRackingParts(
  node: LiveRackingNode,
  detail: LiveRackingDetail,
): LiveRackingPart[] {
  const parts: LiveRackingPart[] = []
  pushFrames(parts, node)
  pushSideBracing(parts, node)
  pushHinges(parts, node)
  for (let level = 0; level < node.levels; level++) {
    pushLevelBeams(parts, node, level)
    pushChannelProfiles(parts, node, level)
    pushRollers(parts, node, level, detail)
    pushChannelEnd(parts, node, level)
    // Akış donanımının tamamı yakın katmanda: uzaktan bir kanal tek şerit
    // olarak okunuyor ve fren makarası, tutucu, ortalayıcı orada yalnız
    // üçgen maliyeti olurdu.
    if (detail === 'full') {
      pushBrakeRollers(parts, node, level)
      pushCentralisers(parts, node, level)
      pushRetainers(parts, node, level)
    }
  }
  return parts
}
