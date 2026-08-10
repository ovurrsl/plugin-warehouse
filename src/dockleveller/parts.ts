/**
 * Yükleme rampasının parçaları — ÜÇ ayrı liste, üç ayrı gövde.
 *
 * Ayrılmalarının sebebi hareket: çerçeve çukurda sabit, tabla menteşede
 * dönüyor, dudak da tablanın burnunda kendi hareketini yapıyor. Üçü tek
 * geometriye girseydi eğim kaydırıcısının her adımı yeni bir buffer basardı —
 * teleskopik bomun bölümlerinde yazılı olan kuralın aynısı: poz cache'e
 * girmez, vertex'ler dinlenme çerçevesinde yazılır ve hareketi renderer'ın
 * grup dönüşümü taşır.
 *
 * Çerçeve parçaları DÜĞÜM çerçevesinde (origin çukur izinin ortası, zemin
 * kotu). Tabla ve dudak KENDİ çerçevelerinde: origin kendi menteşelerinde,
 * gövde +X'e uzanıyor, üst yüzey `y = 0`.
 */

import {
  BUMPER_FACE_M,
  BUMPER_PROJECTION_M,
  BUMPER_SIDE_CLEAR_M,
  BUMPER_Y_M,
  CONTROL_BOX_M,
  CONTROL_HEIGHT_M,
  CONTROL_POST_M,
  CYLINDER_M,
  HINGE_TUBE_M,
  LIP_CHAMFER_M,
  LIP_PLATE_M,
  PIT_FLOOR_M,
  PIT_WALL_M,
  PLATFORM_PLATE_M,
  RIB_COUNT,
  RIB_DEPTH_M,
  RIB_THICKNESS_M,
  TOE_GUARD_HEIGHT_M,
  TOE_GUARD_THICKNESS_M,
} from './catalog'
import { controlPostXZ, frameHeightM, lipFullLengthM, platformLengthM, widthM } from './metrics'
import type { DockLevellerNode } from './schema'

export type DockLevellerDetail = 'full' | 'simple'

export type DockLevellerPartRole = 'frame' | 'deck' | 'guard' | 'bumper' | 'control' | 'estop'

export type DockLevellerPart = {
  role: DockLevellerPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

/**
 * Çukur, çerçeve, tampon ve kumanda direği — hareket etmeyen her şey.
 *
 * Çukurun kendisi zeminin ALTINDA ve normal bir sahnede döşemenin içinde
 * kalıyor, yani görünmüyor. Yine de çiziliyor: patlatılmış görünümde,
 * kesitte ve döşemesiz bir katta rampanın gerçekte ne kadar yer kapladığını
 * gösteren tek şey o. Uzak katmanda düşüyor — orada zaten görünmez.
 */
export function dockLevellerFrameParts(
  node: DockLevellerNode,
  detail: DockLevellerDetail,
): DockLevellerPart[] {
  const length = platformLengthM(node)
  const width = widthM(node)
  const depth = frameHeightM(node)
  const halfLength = length / 2
  const halfWidth = width / 2
  const parts: DockLevellerPart[] = []

  if (detail === 'full') {
    // Çukur astarı: iki yan, bir arka duvar, bir taban.
    for (const side of [-1, 1] as const) {
      parts.push({
        role: 'frame',
        center: [0, -depth / 2, side * (halfWidth + PIT_WALL_M / 2)],
        size: [length + PIT_WALL_M, depth, PIT_WALL_M],
      })
    }
    parts.push({
      role: 'frame',
      center: [-halfLength - PIT_WALL_M / 2, -depth / 2, 0],
      size: [PIT_WALL_M, depth, width + 2 * PIT_WALL_M],
    })
    parts.push({
      role: 'frame',
      center: [0, -depth + PIT_FLOOR_M / 2, 0],
      size: [length, PIT_FLOOR_M, width],
    })
    // Hidrolik silindir — tablayı kaldıran şey. Çukurun ortasında, arkaya
    // yakın: menteşeye yakın bir kaldırma noktası daha büyük kuvvet ister,
    // gerçek makinelerde silindir tablanın ortasına doğru oturuyor.
    parts.push({
      role: 'frame',
      center: [-halfLength + length * 0.42, -depth + CYLINDER_M[1] / 2 + PIT_FLOOR_M, 0],
      size: CYLINDER_M,
    })
  }

  // Arka menteşe borusu — hem dolu hem sade katmanda, çünkü tablanın döndüğü
  // hattı gösteren tek parça bu ve yerleşimi okuyan kişi rampanın hangi
  // ucundan kalktığını görmeli.
  /**
   * Menteşe borusu tabla sacının ALTINDAN asılı.
   *
   * Önceki hâlde borunun üst yüzü de tabla sacının üst yüzü de tam `y = 0`'a
   * düşüyordu: iki ayrı mesh, tek materyal, aynı derinlik → tablanın arka
   * kenarında 70 mm × tam genişlik bir şeritte z-savaşı, üstelik düğümlerin
   * çoğunun içinde bulunduğu VARSAYILAN pozda. Artık `y = 0` düzlemini tabla
   * sacından başka hiçbir gövde paylaşmıyor.
   */
  parts.push({
    role: 'frame',
    center: [-halfLength + HINGE_TUBE_M / 2, -PLATFORM_PLATE_M - HINGE_TUBE_M / 2, 0],
    size: [HINGE_TUBE_M, HINGE_TUBE_M, width],
  })

  if (node.hasBumpers) {
    // Tamponlar kapı yüzünde, zeminin ALTINA sarkıyor ve dudağın süpürdüğü
    // genişliğin DIŞINDA duruyor — ikisi de makinenin çalışabilmesinin şartı,
    // bkz. `BUMPER_Y_M` ve `BUMPER_SIDE_CLEAR_M`.
    for (const side of [-1, 1] as const) {
      parts.push({
        role: 'bumper',
        center: [
          halfLength + BUMPER_PROJECTION_M / 2,
          BUMPER_Y_M,
          side * (halfWidth + BUMPER_SIDE_CLEAR_M + BUMPER_FACE_M[1] / 2),
        ],
        size: [BUMPER_PROJECTION_M, BUMPER_FACE_M[0], BUMPER_FACE_M[1]],
      })
    }
  }

  if (node.hasControlPost) {
    // Kumanda direği yanda, kapı ağzının dışında: operatör rampanın üstünde
    // değil KENARINDA durarak çalıştırır (EN 1398, iki elle-tut kumanda).
    // Yer TEK kaynaktan: plan sembolü de aynı fonksiyonu okuyor. İki hesap
    // sessizce ayrışmıştı — planda direk `halfLength - BUMPER_Y_M`'ye
    // konuyordu, yani tamponun KOTU bir X geri çekmesi olarak kullanılmıştı.
    const [postX, postZ] = controlPostXZ(node)
    parts.push({
      role: 'frame',
      center: [postX, CONTROL_HEIGHT_M / 2, postZ],
      size: [CONTROL_POST_M, CONTROL_HEIGHT_M, CONTROL_POST_M],
    })
    // Kutu ve acil stop İKİ katmanda da: düzeneğin en geniş parçası bu, ve
    // uzak katmanda düşünce geriye tepesi kesilmiş çıplak bir çubuk kalıyor —
    // zeminin üstünde LOD anahtarında kaybolan tek parça oydu. Rampa kapı
    // başına bir tane, iki kutu bedelsiz.
    parts.push({
      role: 'control',
      center: [postX, CONTROL_HEIGHT_M, postZ],
      size: CONTROL_BOX_M,
    })
    if (detail === 'full') {
      parts.push({
        role: 'estop',
        center: [postX + CONTROL_BOX_M[0] / 2, CONTROL_HEIGHT_M + CONTROL_BOX_M[1] / 4, postZ],
        size: [0.03, 0.07, 0.07],
      })
    }
  }

  return parts
}

/**
 * Tabla — KENDİ çerçevesinde: menteşe origin'de, gövde +X'e uzanıyor, üst
 * yüzey `y = 0`. Renderer bu grubu menteşe etrafında döndürüyor.
 */
export function dockLevellerDeckParts(
  node: DockLevellerNode,
  detail: DockLevellerDetail,
): DockLevellerPart[] {
  const length = platformLengthM(node)
  const width = widthM(node)
  const halfWidth = width / 2
  const parts: DockLevellerPart[] = [
    {
      role: 'deck',
      center: [length / 2, -PLATFORM_PLATE_M / 2, 0],
      size: [length, PLATFORM_PLATE_M, width],
    },
  ]

  // Ayak koruma etekleri: tabla kalkınca yanda açılan makas boşluğunu
  // kapatan sarı etek. Tablanın ALTINDA duruyorlar, yani dinlenmede çukurun
  // içinde ve görünmezler — göründükleri an tam da tehlikenin doğduğu an.
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'guard',
      center: [
        length / 2,
        -PLATFORM_PLATE_M - TOE_GUARD_HEIGHT_M / 2,
        side * (halfWidth - TOE_GUARD_THICKNESS_M / 2),
      ],
      size: [length, TOE_GUARD_HEIGHT_M, TOE_GUARD_THICKNESS_M],
    })
  }

  if (detail === 'full') {
    // Boyuna nervürler — sacın altındaki taşıyıcı ızgara. Yalnız yakın
    // katmanda: uzaktan tablanın altı zaten görünmüyor.
    const span = width - 2 * TOE_GUARD_THICKNESS_M
    for (let index = 0; index < RIB_COUNT; index++) {
      const z = -span / 2 + (span * (index + 0.5)) / RIB_COUNT
      parts.push({
        role: 'frame',
        center: [length / 2, -PLATFORM_PLATE_M - RIB_DEPTH_M / 2, z],
        size: [length - 0.1, RIB_DEPTH_M, RIB_THICKNESS_M],
      })
    }
  }

  return parts
}

/**
 * Dudak — kendi çerçevesinde, TAM boyunda.
 *
 * Tam boyunda inşa edilmesi teleskopik dudağın çalışma biçimi: dudak kısalıp
 * uzamıyor, tablanın içindeki cepten kayarak çıkıyor. Renderer grubu geri
 * çekince çekili kısım tablanın altında kalıyor — uzanım kaydırıcısı tek bir
 * yeni buffer bile bastırmıyor.
 */
export function dockLevellerLipParts(
  node: DockLevellerNode,
  detail: DockLevellerDetail,
): DockLevellerPart[] {
  const width = widthM(node)
  const full = lipFullLengthM(node)
  if (full <= 0) return []

  if (detail !== 'full' || full <= LIP_CHAMFER_M * 2) {
    return [
      { role: 'deck', center: [full / 2, -LIP_PLATE_M / 2, 0], size: [full, LIP_PLATE_M, width] },
    ]
  }

  // Uçtaki pah ayrı ve inceltilmiş bir blok: dorsenin zeminine binen kenar
  // keskin bir basamak değil, 75 mm'lik bir rampa (KAYNAK: Stertil).
  const body = full - LIP_CHAMFER_M
  return [
    { role: 'deck', center: [body / 2, -LIP_PLATE_M / 2, 0], size: [body, LIP_PLATE_M, width] },
    {
      role: 'deck',
      center: [body + LIP_CHAMFER_M / 2, -LIP_PLATE_M / 4, 0],
      size: [LIP_CHAMFER_M, LIP_PLATE_M / 2, width],
    },
  ]
}
