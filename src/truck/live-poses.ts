import { type LiveTransform, useLiveTransforms } from '@pascal-app/core'
import { type Fleet, poseOf } from './fleet'

/**
 * Filo pozlarının canlı transform kanalına yazılışı — KARE BAŞINA TEK YAZIM.
 *
 * ## Neden ayrı bir dosya
 *
 * `fleet-system.tsx` bir R3F bileşeni; buradaki iki fonksiyon ise saf store
 * işlemi ve asıl kanıtlanması gereken şey "kare başına kaç yazım" — o sayı
 * ancak abonelik sayılabildiği yerde ölçülebiliyor. Kanal sözleşmesi de tek
 * yerde kalıyor.
 *
 * ## Neden tek yazım
 *
 * Host'un `set` eylemi HER çağrıda `new Map(state.transforms)` klonluyor ve
 * zustand bildirimi yayınlıyor (`@pascal-app/core`
 * `store/use-live-transforms.js:7-11`). Bildirim sahnedeki HER `useLiveTransforms`
 * abonesinin seçicisini koşturuyor — yani her düğümün renderer'ını. Filo döngüsü
 * araç başına (ve taşınan palet başına) bir `set` çağırıyordu: 16 araçlık bir
 * filoda kare başına 16–32 Map klonu ve 16–32 tam abone uyandırması, hepsi aynı
 * karenin aynı sonucu için.
 *
 * Burada klon bir kez alınıyor, bütün pozlar ona yazılıyor ve `setState` bir kez
 * çağrılıyor.
 *
 * **Klon ŞART**: kanal bu eklentinin değil, host'un. Kullanıcının elle
 * sürüklediği düğüm de aynı sözlükte duruyor ve `clearAll()` ya da sıfırdan
 * kurulmuş bir Map onu sessizce silerdi — sürüklenen nesne, filo koşarken
 * elin altında park pozuna atlardı.
 *
 * `setState` KISMÎ: zustand varsayılanı sığ birleştirme, yani `set`/`get`/
 * `clear`/`clearAll` eylemleri yerinde kalıyor. `replace` bayrağı verilmiyor —
 * verilseydi store eylemsiz kalır ve kanalı kullanan herkes bozulurdu.
 */

/**
 * Paletin çatal üstündeki yeri — aracın merkezinden ileriye.
 *
 * Modelden okumak daha doğru olurdu ama palet, çatal yüzünün hemen
 * önündedir ve o mesafe her ailede aracın yarı boyunun civarındadır;
 * `FORK_OFFSET_M` bir görsel yerleşim sabitidir ve hiçbir ölçüye girmez.
 */
const FORK_OFFSET_M = 1.1

/**
 * Bu karenin pozlarını yazar ve yazdığı kimlikleri `driven`'a ekler.
 *
 * Yazılacak hiçbir şey yoksa (filo boş, ya da bütün araçlar canlı sürüklemede)
 * store'a HİÇ dokunulmuyor: değişmemiş bir klonu yazmak da tam bir abone
 * uyandırması demekti.
 */
export function publishFleetPoses(
  fleet: Fleet,
  /** `useLiveNodeOverrides`'ın `overrides` haritası — elin altındaki araca
   *  simülasyon yazmaz. */
  overrides: { has(id: string): boolean },
  driven: Set<string>,
): void {
  const store = useLiveTransforms.getState()
  let next: Map<string, LiveTransform> | null = null

  for (const truck of fleet.trucks) {
    // Canlı sürükleme her zaman kazanır: kullanıcının elindeki araca
    // simülasyon yazmaz.
    if (overrides.has(truck.id)) continue
    const pose = poseOf(truck)
    next ??= new Map(store.transforms)
    next.set(truck.id, pose)
    driven.add(truck.id)

    /**
     * Taşınan palet — PALETİN KENDİ düğümünün canlı transform'u.
     *
     * Hayalet kopya yok, ikinci geometri yok: taşınan şey paletin ta
     * kendisidir, kargosu, filmi ve LOD'uyla doğru görünür. Ve
     * `pallet/renderer.tsx` bugün olduğu gibi çalışır — o dosyaya hiç
     * dokunulmaz (plan §5.6).
     *
     * Palet, aracın çatal düzleminde durur: aracın konumuna kendi
     * yönünde çatal ofseti eklenir, Y ise çatalın anlık kotu.
     */
    const carrying = truck.carryingPalletId
    if (!carrying) continue
    const forward = pose.rotation
    next.set(carrying, {
      position: [
        pose.position[0] + Math.cos(forward) * FORK_OFFSET_M,
        pose.position[1] + truck.forkY,
        pose.position[2] - Math.sin(forward) * FORK_OFFSET_M,
      ],
      rotation: forward,
    })
    driven.add(carrying)
  }

  if (next) useLiveTransforms.setState({ transforms: next })
}

/**
 * Sürülen kimlikleri kanaldan çıkarır — yine tek yazımla.
 *
 * `keep` verilirse yalnız onun dışında kalanlar bırakılır: filo yeniden
 * kurulduğunda rotası silinen araç park pozuna döner, hâlâ sürülenler
 * kımıldamaz (T29/T30).
 */
export function releaseFleetPoses(driven: Set<string>, keep?: ReadonlySet<string>): void {
  let next: Map<string, LiveTransform> | null = null
  for (const id of driven) {
    if (keep?.has(id)) continue
    next ??= new Map(useLiveTransforms.getState().transforms)
    next.delete(id)
    driven.delete(id)
  }
  if (next) useLiveTransforms.setState({ transforms: next })
}
