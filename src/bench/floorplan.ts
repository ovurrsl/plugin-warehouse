import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { lengthLabel, unitOf } from '../units'
import { FRONT_Z, PALETTE } from './catalog'
import { depthM, overheadOf, scalePlatformM, topKindOf, underOf, widthM } from './metrics'
import type { BenchNode } from './schema'

/**
 * Plan sembolü.
 *
 * Bir tezgâh planda bir dikdörtgen, ve mesele o dikdörtgeni RAFTAN ve
 * konveyörden ayırt edilebilir kılmak: üçü de üstten bakıldığında dikdörtgen
 * ve bir yerleşimi okuyan kişinin hangisinin çalışma yüzeyi olduğunu
 * görebilmesi gerekiyor.
 *
 * Ayrımı üç şey taşıyor:
 *
 *   1. **Dolu tabla** — rafın içi boş çerçevesinin aksine tezgâh dolu bir
 *      yüzey; planda gerçekten üstünde çalışılan bir alan.
 *   2. **Üst yapı kenarı** — varsa, rafın/panonun oturduğu kenara kesik
 *      çizgi. O kenar duvara dayanır ve yerleşimi okuyan kişinin masanın
 *      hangi tarafının kapalı olduğunu bilmesi gerekir.
 *   3. **Tabla donanımı** — makara taraması ya da terazi platformunun karesi.
 *
 * Ölçüler 3B ile AYNI fonksiyonlardan (`widthM`, `depthM`) — ikinci bir
 * hesap sessizce ayrışacak bir kopya olurdu.
 */
export function buildBenchFloorplan(
  node: BenchNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = widthM(node)
  const depth = depthM(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false
  const unit = unitOf(view)

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : PALETTE.frame
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#e8e2d6'
  const ink = selected ? stroke : '#8d99a6'

  const halfWidth = width / 2
  const halfDepth = depth / 2

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -halfWidth,
      y: -halfDepth,
      width,
      height: depth,
      fill,
      stroke,
      strokeWidth: 0.03,
    },
  ]

  // Üst yapının oturduğu kenar — kesik değil KALIN çizgi: plan sembollerinde
  // kesik çizgi "üstte/görünmez" demek, oysa bu kenar masanın en somut
  // parçası. Kalınlık "burası kapalı, bu tarafa yaklaşılmaz" diyor.
  //
  // Plan ekseni: 3B'nin +Z'si burada +y. Arka kenar bu yüzden `-FRONT_Z`.
  if (overheadOf(node) !== 'none') {
    children.push({
      kind: 'line',
      x1: -halfWidth,
      y1: -FRONT_Z * halfDepth,
      x2: halfWidth,
      y2: -FRONT_Z * halfDepth,
      stroke,
      strokeWidth: 0.06,
    })
  }

  /**
   * ÇALIŞMA kenarı — operatörün durduğu taraf, ince ve içeri kaçık çizgi.
   *
   * Üst yapı kenarı yalnız raflı/panolu varyantlarda çiziliyor, yani altı
   * masanın üçünde planda hangi tarafın ön olduğunu söyleyen HİÇBİR şey
   * yoktu: yerleşimi okuyan kişi masayı duvara ters çevirip koyabilir, ve
   * hata ancak 3B'de çekmeceyi duvara açarken görülürdü.
   */
  children.push({
    kind: 'line',
    x1: -halfWidth + 0.05,
    y1: FRONT_Z * (halfDepth - 0.05),
    x2: halfWidth - 0.05,
    y2: FRONT_Z * (halfDepth - 0.05),
    stroke: ink,
    strokeWidth: 0.02,
  })

  // Tabla donanımı.
  const top = topKindOf(node)
  if (top === 'rollers') {
    // Makara taraması: konveyörünkiyle aynı dil, çünkü aynı şey — mal bu
    // yüzeyde kayıyor. Sayı planda okunabilirlik için seyreltilmiş; 3B'deki
    // gerçek makara adedi değil ve olması da gerekmiyor.
    const lines = Math.max(3, Math.round(width / 0.25))
    for (let index = 1; index < lines; index++) {
      const x = -halfWidth + (index * width) / lines
      children.push({
        kind: 'line',
        x1: x,
        y1: -halfDepth + 0.04,
        x2: x,
        y2: halfDepth - 0.04,
        stroke: ink,
        strokeWidth: 0.012,
      })
    }
  } else if (top === 'scale') {
    // Terazi platformu: tablanın ortasındaki kare, planda da kimliği. Kenar
    // 3B ile AYNI fonksiyondan — plan kendi kırpmasını yapıyordu ve 3B
    // yapmıyordu, yani iki görünüm aynı masayı farklı çiziyordu.
    const side = scalePlatformM(node)
    children.push({
      kind: 'rect',
      x: -side / 2,
      y: -side / 2,
      width: side,
      height: side,
      fill: 'none',
      stroke: ink,
      strokeWidth: 0.02,
    })
  }

  // Alt raf, planda ince bir iç çerçeve: masanın altının dolu mu boş mu
  // olduğu yerleşimde bir karar (transpalet altından geçer mi?).
  if (underOf(node) === 'shelf') {
    children.push({
      kind: 'rect',
      x: -halfWidth + 0.06,
      y: -halfDepth + 0.06,
      width: width - 0.12,
      height: depth - 0.12,
      fill: 'none',
      stroke: ink,
      strokeWidth: 0.012,
    })
  }

  // Seçiliyken ölçü etiketi: yerleşimi okuyan kişi masanın kaç metre
  // olduğunu paneli açmadan görmeli, ve ölçüler ayarlanabilir olduğu için
  // varyant adı tek başına bunu SÖYLEMİYOR.
  if (selected) {
    children.push({
      kind: 'text',
      x: 0,
      y: 0,
      text: `${lengthLabel(width, unit, 2)} × ${lengthLabel(depth, unit, 2)}`,
      fill: stroke,
      fontSize: Math.min(0.18, depth * 0.28),
      textAnchor: 'middle',
    })
  }

  return { kind: 'group', children }
}
