'use client'

import { useLayoutEffect } from 'react'
import type { Object3D } from 'three'

/** Donmuş matris ile canlı `position` arasındaki kabul edilebilir fark, metre. */
const DRIFT_EPSILON = 1e-6

/**
 * Recomposes a registered object's local matrix, and freezes it there.
 *
 * Exported separately from the hook below so a test can drive it with a bare
 * `{ matrixAutoUpdate, position, rotation, updateMatrix }` stand-in instead of
 * mounting a real scene.
 */
/** Kayma denetiminin gerçekten okuduğu yüzey — testin sahte nesnesi de bunu
 *  karşılıyor, gerçek bir sahne kurmaya gerek kalmıyor. */
type Freezable = Pick<
  Object3D,
  'position' | 'rotation' | 'matrixAutoUpdate' | 'updateMatrix' | 'matrix'
>

/**
 * BU modülün dondurduğu nesneler.
 *
 * Kayma denetimi (`rebakeDriftedStaticTransforms`) her kare koşuyor ve önceden
 * `sceneRegistry.nodes` defterinin TAMAMINI geziyordu — 5.000 düğümlük bir
 * sahnede kare başına 5.000 yineleme, oysa ilgilendiği yalnız kendi
 * dondurdukları. Küme aynı cevabı verir çünkü kayıtlı VE donmuş nesnelerin
 * kümesi tam olarak burada dondurulanlardır: kolider ve olay sarmalayıcısı da
 * donuyor ama ikisi de deftere hiç girmiyor.
 *
 * `Set`, `WeakSet` değil: gezilebilir olması şart. Sızıntının karşılığı
 * `releaseStaticTransform` ve onu kancanın temizliği çağırıyor.
 */
const frozen = new Set<Freezable>()

export function applyStaticTransform(
  object: Freezable,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  isLive: boolean,
): void {
  if (isLive) {
    // A drag or gizmo is writing this exact object every tick — through
    // `useLiveTransforms`/`useLiveNodeOverrides` state, or (per the registry's
    // imperative-drag convention) straight into its `position`/`rotation` — so
    // three's own per-frame recompute has to stay on for it to move at all.
    object.matrixAutoUpdate = true
    frozen.delete(object)
    return
  }
  object.position.set(position[0], position[1], position[2])
  object.rotation.set(rotation[0], rotation[1], rotation[2])
  object.matrixAutoUpdate = false
  object.updateMatrix()
  frozen.add(object)
}

/** Nesneyi kayma denetiminden düşürür. Unmount'ta çağrılmazsa küme sahne
 *  ömrü boyunca büyür ve ölü nesneler her kare taranır. */
export function releaseStaticTransform(object: Freezable): void {
  frozen.delete(object)
}

/** Test kancası — sızıntının tek gözlemlenebilir kanıtı. */
export function frozenStaticTransformCount(): number {
  return frozen.size
}

/**
 * Takes a registered group out of three's per-frame matrix recompute while it
 * is not being dragged, and recomposes it once, by hand, whenever the values
 * it would have recomputed actually change.
 *
 * A CPU profile of the 5,218-node Güzeller scene put 24.5% of *idle* frame
 * time — camera not moving, nothing selected — inside `compose()` and
 * `multiplyMatrices()`. That is three's own render loop recomputing the local
 * matrix of every registered group on every frame, whether or not it moved,
 * because `matrixAutoUpdate` defaults to `true` and nothing in this package
 * ever turned it off. Almost none of those thousands of racks and pallets are
 * moving at any given moment, so almost all of that cost was for nothing.
 *
 * `isLive` is what keeps this safe rather than merely fast: it must be `true`
 * for exactly as long as something is writing this node's position or
 * rotation on every tick (a live drag, a rotate/resize gizmo), and this hook
 * hands `matrixAutoUpdate` straight back to three for that window. Getting
 * that flag wrong the other way — static while something is actually
 * animating it — is what would freeze a node mid-drag; this hook does not
 * guess it, the caller must pass it through from the same live-state read
 * that drives the JSX `position`/`rotation` props.
 */
/**
 * Dondurulmuş yerel matrisi, biri `position`'a doğrudan yazdıysa yeniden basar.
 *
 * ## Neden gerekli — ölçülmüş, bildirilmemiş bir hata
 *
 * `matrixAutoUpdate = false` yapmak yalnız three'nin kendi yeniden hesabını
 * kapatmıyor; `position`'a **başkasının** yazdığını da yutuyor. Ve host tam
 * olarak bunu yapıyor:
 *
 *   `floor-elevation-system.tsx` → `mesh.position.y = visualPosition[1]`
 *
 * Zemine oturan kind'ların Y'si host'un sorumluluğu — düğüm verisindeki
 * `position[1]` taban yükseklikte kalıyor, slab lifti yalnız mesh'e yazılıyor.
 * `matrixAutoUpdate` kapalıyken bu yazım yerel matrise HİÇ işlemiyordu, yani
 * asma kat güvertesine konan bir raf zeminde kalıyordu. (Güvertenin kendisi
 * host `slab` düğümü olduğu için doğru yükseliyor — bu yüzden belirti "güverte
 * çıkıyor, üstündeki raf çıkmıyor" biçiminde görünüyor.)
 *
 * Aynı yutma, host'un `MoveTool`'unun kayıtlı nesneye imperatif yazdığı
 * sürükleme yolunu da donduruyordu: `isLive` bayrağı o yolu göremiyor.
 *
 * ## Neden ucuz
 *
 * Kaçınılan maliyet `compose()` + `multiplyMatrices()` idi. Buradaki kontrol
 * üç float karşılaştırması ve `matrixAutoUpdate` açık olan her düğümü ilk
 * satırda eliyor — host düğümleri hiç sırayı bile tutmuyor. Yeniden basma
 * yalnız gerçekten kaymış düğüm için. Yani sürüş, ölçülen %24,5'lik kazancı
 * korurken doğruluğu geri veriyor.
 *
 * @returns kaç düğüm yeniden basıldı (teşhis ve test için)
 */
export function rebakeDriftedStaticTransforms(): number {
  let rebaked = 0
  for (const object of frozen) {
    // Kümede yalnız bizim dondurduklarımız var; bayrak açıksa başkası
    // çözmüş demektir ve three onu zaten her kare basıyor.
    if (object.matrixAutoUpdate) continue
    const { elements } = object.matrix
    if (
      Math.abs((elements[12] ?? 0) - object.position.x) <= DRIFT_EPSILON &&
      Math.abs((elements[13] ?? 0) - object.position.y) <= DRIFT_EPSILON &&
      Math.abs((elements[14] ?? 0) - object.position.z) <= DRIFT_EPSILON
    ) {
      continue
    }
    // `updateMatrix` ayrıca `matrixWorldNeedsUpdate` işaretliyor, dolayısıyla
    // three çizim sırasında dünya matrisini kendiliğinden tazeliyor.
    object.updateMatrix()
    rebaked++
  }
  return rebaked
}

export function useStaticTransform(
  ref: { current: Object3D | null },
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  isLive: boolean,
): void {
  useLayoutEffect(() => {
    const object = ref.current
    if (!object) return
    applyStaticTransform(object, position, rotation, isLive)
    // Unmount'ta kümeden düş: kalırsa hem bellek tutar hem ölü nesne her
    // kare taranır — taramayı daraltmanın kazancını tam tersine çevirir.
    return () => releaseStaticTransform(object)
  }, [ref, isLive, position[0], position[1], position[2], rotation[0], rotation[1], rotation[2]])
}
