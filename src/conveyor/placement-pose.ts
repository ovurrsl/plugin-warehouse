import { snapPlacementToLineEnd } from './port-magnet'
import { asConveyorModule } from './ports'

/**
 * Yerleştirme sırasında hayaletin GERÇEK pozu — kullanıcının açısı ya da
 * mıknatısın çözdüğü açı.
 *
 * Yedi konveyör aracının hepsi aynı iki satırı yazacaktı; tek yerde durmasının
 * sebebi o değil. Sebep şu: **kullanıcının açısı ile çizilen açı ayrı iki şey**
 * ve bunları tek bir ref'te tutan bir araç, mıknatıs bir kere ateşledikten
 * sonra kullanıcının R/T ile kurduğu açıyı kalıcı olarak kaybeder. Kullanıcı
 * ucun yanından ayrılır, hayalet mıknatısın bıraktığı açıda kalır, ve hiçbir
 * şey bunu söylemez.
 *
 * Bu yüzden `userRotationY` girdi, `rotationY` çıktı: araç kendi ref'inde
 * kullanıcının açısını tutar, bu fonksiyon her fare hareketinde çizilecek olanı
 * söyler. Menzilden çıkınca kullanıcının açısı kendiliğinden geri gelir.
 */
export type PlacementPose = {
  position: [number, number, number]
  rotationY: number
  /** Bir uca oturdu mu — araç bunu ses ve hizalama kılavuzları için okuyor. */
  snapped: boolean
}

export function placementPose(
  /**
   * Hayalet düğümü. `unknown`, çünkü araçların önizleme ref'leri host'un geniş
   * `AnyNode` birliğiyle tiplendirilmiş; daraltma paketin her yerinde olduğu
   * gibi çalışma zamanı muhafızıyla yapılıyor.
   */
  preview: unknown,
  position: [number, number, number],
  userRotationY: number,
  nodes: Readonly<Record<string, unknown>>,
): PlacementPose {
  const module = asConveyorModule(preview)
  if (!module) return { position, rotationY: userRotationY, snapped: false }
  const snap = snapPlacementToLineEnd(module, position, userRotationY, nodes)
  if (!snap) return { position, rotationY: userRotationY, snapped: false }
  return { position: snap.position, rotationY: snap.rotationY, snapped: true }
}
