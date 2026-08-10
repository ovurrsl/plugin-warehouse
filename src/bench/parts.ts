/**
 * Tezgâh parçaları — ailenin `role + center + size` kutu listesi deseni.
 *
 * Kutulardan kurulu olması bir eksiklik değil, bu ailenin gerçek biçimi:
 * bir tezgâh kare kutu profil ayak, düz tabla, düz raf ve düz çekmece
 * yüzünden ibaret. Silindir olan tek şey makara ve teker; ikisi de
 * `pattern`/oran ile değil, kendi kutularıyla temsil ediliyor çünkü bu
 * mesafede silindir ile prizma arasındaki fark bir pikselin altında kalıyor
 * ve üçgen bütçesi tabla makaralarında ciddi (2 m'lik masada 22 makara).
 *
 * Uzak katman (`simple`) ailenin geri kalanıyla aynı sözleşmede: siluet
 * korunuyor, iç donanım düşüyor. Bir tezgâhın 40 m'den okunan şekli tabla,
 * dört ayak ve varsa üst raf — çekmece yüzleri, makaralar ve teker göbekleri
 * o mesafede tek piksel bile etmiyor.
 */

import {
  APRON_HEIGHT_M,
  APRON_THICKNESS_M,
  CASTOR_BUILD_HEIGHT_M,
  CASTOR_TREAD_M,
  CASTOR_WHEEL_M,
  DRAWER_COUNT,
  DRAWER_GAP_M,
  DRAWER_HEIGHT_M,
  DRAWER_SIDE_CLEAR_M,
  FRONT_Z,
  LEG_M,
  MONITOR_HEIGHT_M,
  MONITOR_POST_M,
  MONITOR_SCREEN_M,
  OVERHEAD_POST_M,
  ROLLER_CHANNEL_M,
  ROLLER_DIAMETER_M,
  ROLLER_PITCH_M,
  SCALE_PROUD_M,
  SCALE_RECESS_M,
  SHELF_THICKNESS_M,
  TOOLBOARD_THICKNESS_M,
  TOP_THICKNESS_M,
  UNDER_SHELF_Y_M,
} from './catalog'
import {
  deckTopYM,
  depthM,
  hasCastors,
  hasMonitorStand,
  legHeightM,
  monitorStandXM,
  monitorStandZM,
  overheadOf,
  overheadShelfDepthM,
  overheadShelfYM,
  scalePlatformM,
  topKindOf,
  underOf,
  widthM,
  worktopYM,
} from './metrics'
import type { BenchNode } from './schema'

export type BenchDetail = 'full' | 'simple'

export type BenchPartRole =
  | 'leg'
  | 'apron'
  | 'top'
  /** Makara yatağının taşıyıcı sacı — tabla değil, çerçevenin parçası. */
  | 'bed'
  | 'shelf'
  | 'drawer'
  | 'roller'
  | 'scale'
  | 'post'
  | 'toolboard'
  | 'castor'
  | 'screen'

export type BenchPart = {
  role: BenchPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

/**
 * Bütün parçalar tablanın merkezine göre, yerel çerçevede: +X genişlik, +Z
 * derinlik, Y zeminden yukarı. Düğümün kendi dönüşü grubun matrisinde —
 * burada hiçbir şey dönmüyor.
 *
 * ÖN yüz `+FRONT_Z` (bkz. `catalog.ts`): operatöre bakan parçalar oraya,
 * duvara bakanlar `-FRONT_Z`'ye. Çıplak işaret yazılmıyor.
 */
export function benchParts(node: BenchNode, detail: BenchDetail): BenchPart[] {
  const width = widthM(node)
  const depth = depthM(node)
  const worktop = worktopYM(node)
  // Güverte, çalışma yüzeyiyle aynı değil: makaralı tezgâhta bir makara çapı
  // aşağıda ve makaralar aradaki boşluğu dolduruyor.
  const deckTop = deckTopYM(node)
  const legHeight = legHeightM(node)
  const castors = hasCastors(node)
  const castorY = castors ? CASTOR_BUILD_HEIGHT_M : 0
  const rollerBed = topKindOf(node) === 'rollers'
  const parts: BenchPart[] = []

  // ── Tabla (ya da makara yatağı) ────────────────────────────────────────
  parts.push({
    role: rollerBed ? 'bed' : 'top',
    center: [0, deckTop - TOP_THICKNESS_M / 2, 0],
    size: [width, TOP_THICKNESS_M, depth],
  })

  // ── Ayaklar ────────────────────────────────────────────────────────────
  // Köşelerden yarım profil içeride: ayak yüzü tablanın kenarıyla hizalı
  // olurdu ve masa kenarına oturan her şey ayağa çarpardı.
  const legX = width / 2 - LEG_M / 2
  const legZ = depth / 2 - LEG_M / 2
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        role: 'leg',
        center: [sx * legX, castorY + legHeight / 2, sz * legZ],
        size: [LEG_M, legHeight, LEG_M],
      })
      /**
       * Teker AYAĞIN ALTINDA — ve iki katmanda da.
       *
       * İki ayrı hata vardı, ikisi de sessiz:
       *
       *  - Teker tabla kenarından ölçülüyordu (`CASTOR_INSET_M`), ayak ise
       *    kendi yarı profilinden. Mobil tezgâhta arada 13 mm AÇIK ara
       *    kalıyordu: ayak 100 mm yukarıda boşlukta bitiyor, teker yanında
       *    hiçbir şeye bağlı olmadan asılı duruyordu. Teker ayağa göre
       *    konumlanır, tablaya göre değil.
       *  - Teker yalnız yakın katmanda çiziliyordu ama ayak tabanı her
       *    katmanda yukarı itiliyordu: uzak katmanda bütün masa 100 mm havada
       *    uçuyordu. Bu bir "ayrıntı" değil, siluetin kendisi.
       *
       * Zincir artık kapanıyor: ayağın altında mesnet plakası, onun altında
       * teker, tekerin altı tam zeminde.
       */
      if (castors) {
        const mountHeight = CASTOR_BUILD_HEIGHT_M - CASTOR_WHEEL_M
        parts.push({
          role: 'leg',
          center: [sx * legX, CASTOR_WHEEL_M + mountHeight / 2, sz * legZ],
          size: [LEG_M, mountHeight, LEG_M],
        })
        // Teker ayak profilinden GENİŞ (Ø75 > 60 mm), o yüzden merkezi taban
        // izine kırpılıyor: ayak ekseninde bıraksaydım 7,5 mm dışarı taşardı
        // ve zarf bekçisi bunu ilk koşuda yakaladı. Kaçıklık gerçek bir döner
        // tekerde zaten var — teker mafsal ekseninin üstünde durmaz.
        const wheelZ = Math.min(legZ, depth / 2 - CASTOR_WHEEL_M / 2)
        parts.push({
          role: 'castor',
          center: [sx * legX, CASTOR_WHEEL_M / 2, sz * wheelZ],
          size: [CASTOR_TREAD_M, CASTOR_WHEEL_M, CASTOR_WHEEL_M],
        })
      }
    }
  }

  // ── Tabla altı çevre kirişi ────────────────────────────────────────────
  // Siluete girer: tablanın altındaki gölge bandı masayı "tabla + dört çubuk"
  // olmaktan çıkaran şey. Bu yüzden uzak katmanda da duruyor.
  const apronY = deckTop - TOP_THICKNESS_M - APRON_HEIGHT_M / 2
  for (const sz of [-1, 1]) {
    parts.push({
      role: 'apron',
      center: [0, apronY, sz * (depth / 2 - APRON_THICKNESS_M / 2)],
      size: [width - 2 * LEG_M, APRON_HEIGHT_M, APRON_THICKNESS_M],
    })
  }
  for (const sx of [-1, 1]) {
    parts.push({
      role: 'apron',
      center: [sx * (width / 2 - APRON_THICKNESS_M / 2), apronY, 0],
      size: [APRON_THICKNESS_M, APRON_HEIGHT_M, depth - 2 * LEG_M],
    })
  }

  // ── Alt donanım ────────────────────────────────────────────────────────
  const under = underOf(node)
  if (under === 'shelf') {
    parts.push({
      role: 'shelf',
      center: [0, castorY + UNDER_SHELF_Y_M, 0],
      size: [width - 2 * LEG_M, SHELF_THICKNESS_M, depth - 2 * LEG_M],
    })
  } else if (under === 'drawers' && detail === 'full') {
    /**
     * Çekmece bloğu masanın SOL yarısında: sağ taraf diz boşluğu olarak
     * kalıyor, çünkü tam genişlik çekmece bir tezgâhı dolap yapar.
     *
     * Kırpma bloğun KENDİ merkezine göre. Önceki hâl genişliği sol yarının
     * TOPLAM boşluğuna göre kırpıyor ama bloğu o yarının ortasına değil
     * `-width/4`'e koyuyordu: iki ölçü tam bir `LEG_M` ayrışıyor ve 1,24 m'den
     * dar her çekmeceli tezgâhta blok ön ayağın içine giriyordu. Varsayılan
     * mobil tezgâhta (1220 mm) çakışma 5 mm, şemanın alt sınırında 30 mm —
     * yüzün sekizde biri ayağın içinde.
     */
    const blockX = -width / 4
    const legInnerFace = width / 2 - LEG_M
    const room = 2 * Math.min(legInnerFace - Math.abs(blockX), Math.abs(blockX))
    const blockWidth = Math.max(0.1, Math.min(room - DRAWER_SIDE_CLEAR_M, 0.5))
    for (let index = 0; index < DRAWER_COUNT; index++) {
      const y = apronY - APRON_HEIGHT_M / 2 - (index + 0.5) * (DRAWER_HEIGHT_M + DRAWER_GAP_M)
      if (y - DRAWER_HEIGHT_M / 2 < castorY) break
      parts.push({
        role: 'drawer',
        // Çekmece yüzü ÖN yüzde: operatör onu kendine doğru çeker. Arkaya
        // konsaydı masa duvara dayandığı anda açılamaz olurdu.
        center: [blockX, y, FRONT_Z * (depth / 2 - APRON_THICKNESS_M)],
        size: [blockWidth, DRAWER_HEIGHT_M, APRON_THICKNESS_M * 1.5],
      })
    }
  }

  // ── Tabla yüzeyi donanımı ──────────────────────────────────────────────
  const top = topKindOf(node)
  if (top === 'rollers') {
    /**
     * Makaralar yatağın İÇİNDE: sırtları tam tabla kotunda, gövdeleri güverte
     * sacıyla çalışma kotu arasındaki boşluğu dolduruyor.
     *
     * Önceki hâlde düz bir tablanın üstüne diziliyorlardı. Referans görsel
     * (`dispatch-packing-table.png`) ile spec'in cümlesi ("built-in rollers or
     * smooth countertops") ikisi de tersini söylüyor: makara yatağı tablanın
     * YERİNE geçen bir seçenek. Üstüne konması çalışma kotunu 50 mm
     * yükseltiyor, yayımlanmış 920 mm zarfı aşıyor ve yan yana duran iki
     * masanın yüzeyini basamaklandırıyordu.
     *
     * Uzak katmanda da duruyorlar — ARTIK siluete giriyorlar: makaralar
     * düşerse yatağın üstü boş bir oluk olarak kalır, oysa daha önce
     * düştüklerinde geriye tam bir tabla kalıyordu.
     */
    /**
     * Makara alanı güvertenin KENDİ ölçüsünden türüyor, ayaklar arası clear
     * ölçüsünden değil.
     *
     * Önceki hâl `width - 2·LEG` ve `depth - 2·LEG` kullanıyordu; o iki sayı
     * alt raf için doğru (orada gerçekten kaçınılacak ayak var) ama güverte
     * kotunda ayak yok. Sonuç: tabla boyunca önde ve arkada 60 mm'lik,
     * uçlarda 125 mm'lik çıplak sac — çalışma yüzeyinden 50 mm aşağıda açık
     * bir oluk, hiçbir gerçek makaralı masada olmayan bir şey.
     *
     * İki yan KANAL eklendi: gerçek makara yatağında makaraların mili onlara
     * oturur, ve oluğun kenarı böylece bilinçli bir kenar oluyor. Makaralar
     * kanalların arasını, adım kalanı iki uca eşit dağıtılarak dolduruyor.
     */
    const channel = ROLLER_CHANNEL_M
    const rollerZ = depth - 2 * channel
    for (const sz of [-1, 1]) {
      parts.push({
        role: 'bed',
        center: [0, worktop - ROLLER_DIAMETER_M / 2, sz * (depth / 2 - channel / 2)],
        size: [width, ROLLER_DIAMETER_M, channel],
      })
    }
    // Uzak katmanda tek tek makara değil, oluğu dolduran tek bir sac: siluet
    // aynı, parça sayısı yirmide bir.
    if (detail === 'simple') {
      parts.push({
        role: 'roller',
        center: [0, worktop - ROLLER_DIAMETER_M / 2, 0],
        size: [width, ROLLER_DIAMETER_M, rollerZ],
      })
    } else {
      const count = Math.max(2, Math.round(width / ROLLER_PITCH_M))
      // Adım genişliğe BÖLÜNÜYOR: sabit adım uçlarda 125 mm boşluk bırakıyordu.
      const pitch = width / count
      for (let index = 0; index < count; index++) {
        parts.push({
          role: 'roller',
          center: [-width / 2 + (index + 0.5) * pitch, worktop - ROLLER_DIAMETER_M / 2, 0],
          size: [ROLLER_DIAMETER_M * 0.8, ROLLER_DIAMETER_M, rollerZ],
        })
      }
    }
  } else if (top === 'scale') {
    /**
     * Terazi platformu tablanın 1,5 mm ÜSTÜNDE duruyor.
     *
     * Önceki hâlde üst yüzü tablanınkiyle TAM eş düzlemdeydi: 500×500 mm'lik
     * bir alanda iki yukarı bakan yüz aynı kotta, aynı merged geometride, aynı
     * materyalle — yani z-savaşı. Deponun kendi kuralı bunu zaten adlandırıyor
     * (`pallet/cargo-constants.ts`: "two coplanar surfaces z-fight") ve orada
     * da 1,5 mm ofset kullanılıyor.
     *
     * Gerçek gömme terazide de plaka tabla yüzeyinden bir tık yukarıdadır;
     * "gömme" olan platformun kendisi değil, altındaki hücre yuvası.
     * Kenarı tablaya KIRPILMIŞ — sabit 500 mm dar bir masadan taşıyordu.
     */
    const platform = scalePlatformM(node)
    parts.push({
      role: 'scale',
      center: [0, worktop + SCALE_PROUD_M - SCALE_RECESS_M / 2, 0],
      size: [platform, SCALE_RECESS_M, platform],
    })
  }

  // ── Üst yapı ───────────────────────────────────────────────────────────
  const overhead = overheadOf(node)
  if (overhead !== 'none') {
    // Üst yapı ARKA kenarda: duvara dayanır ve operatörün görüşünü kesmez.
    const shelfY = overheadShelfYM(node)
    const postZ = -FRONT_Z * (depth / 2 - OVERHEAD_POST_M / 2)
    for (const sx of [-1, 1]) {
      parts.push({
        role: 'post',
        center: [sx * (width / 2 - OVERHEAD_POST_M / 2), worktop + (shelfY - worktop) / 2, postZ],
        size: [OVERHEAD_POST_M, shelfY - worktop, OVERHEAD_POST_M],
      })
    }
    if (overhead === 'shelf') {
      const shelfDepth = overheadShelfDepthM(node)
      parts.push({
        role: 'shelf',
        center: [0, shelfY + SHELF_THICKNESS_M / 2, -FRONT_Z * (depth / 2 - shelfDepth / 2)],
        size: [width, SHELF_THICKNESS_M, shelfDepth],
      })
    } else {
      // Alet panosu: dikmelerin arasını dolduran dikey levha. Dikmelerin
      // ÜSTÜNE çıkmıyor — zarf da bu yüzden panoda raf kalınlığı saymıyor.
      parts.push({
        role: 'toolboard',
        center: [
          0,
          worktop + (shelfY - worktop) / 2,
          -FRONT_Z * (depth / 2 - TOOLBOARD_THICKNESS_M / 2),
        ],
        size: [width - 2 * OVERHEAD_POST_M, shelfY - worktop, TOOLBOARD_THICKNESS_M],
      })
    }
  }

  /**
   * ── Terazi ekranı ──────────────────────────────────────────────────────
   *
   * Stand arka kenarda, ekran operatöre bakıyor. İki kot da kırpılmış: çıplak
   * literaller dar bir tezgâhta standı tablanın dışına atıyordu.
   *
   * İKİ katmanda da çiziliyor. Yalnız yakın katmandayken terazi tezgâhı 30
   * m'de boyunun %43'ünü kaybediyordu: bu varyantın üst yapısı `none`, yani
   * tablanın üstünde başka hiçbir şey yok ve siluet düz bir masaya dönüşüyordu
   * — sonra kamera 22 m'ye gelince 670 mm'lik direk geri bitiyordu. Uzak
   * katman "daha az parça" demek, "başka bir nesne" değil.
   */
  if (hasMonitorStand(node)) {
    const standX = monitorStandXM(node)
    const standZ = monitorStandZM(node)
    if (detail === 'simple') {
      // Direk ve ekran tek kutuda: siluet aynı, iki parça yerine bir.
      const total = MONITOR_HEIGHT_M + MONITOR_SCREEN_M[1]
      parts.push({
        role: 'screen',
        center: [standX, worktop + total / 2, standZ],
        size: [MONITOR_SCREEN_M[0], total, MONITOR_SCREEN_M[2]],
      })
    } else {
      parts.push({
        role: 'post',
        center: [standX, worktop + MONITOR_HEIGHT_M / 2, standZ],
        size: [MONITOR_POST_M, MONITOR_HEIGHT_M, MONITOR_POST_M],
      })
      parts.push({
        role: 'screen',
        center: [standX, worktop + MONITOR_HEIGHT_M + MONITOR_SCREEN_M[1] / 2, standZ],
        size: MONITOR_SCREEN_M,
      })
    }
  }

  return parts
}
