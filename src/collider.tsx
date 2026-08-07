import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Seçim kolideri — TEK birim küp, TEK materyal, tüm paket.
 *
 * Rafın kendi başına çözdüğü, kalan üç renderer'ın kaçırdığı iki ayrı kayıp
 * buradan kapanıyor. Ölçüldü (3000 paletlik gerçekçi sahne):
 *
 * 1. **Satır içi `<boxGeometry args={…}/>` düğüm başına bir buffer ayırır.**
 *    Üç bin palet, hepsi aynı küpü tarif eden üç bin `BufferGeometry` demek —
 *    ve her biri kendi VRAM'ini, kendi `dispose` borcunu taşır.
 *
 * 2. **`colorWrite: false` çizim çağrısını KALDIRMAZ.** Malzeme hiçbir piksel
 *    boyamaz ama renk ve gölge geçişlerinin ikisinde de dispatch edilir; üç
 *    bin palette bu, hiçbir şey boyamayan üç bin çizim. `visible = false` ise
 *    nesneyi `projectObject`'ten tamamen çıkarır — ve three'nin raycaster'ı
 *    ile R3F'in olay katmanı `visible`'a bakmadığı için tıklama çalışmaya
 *    devam eder. Rafın doküman bloğunda kanıtlanmış desen; burası onun tek
 *    kopyası.
 *
 * Kullanım: `<mesh {...colliderProps(size)} position={…} rotation={…} />`
 */
export const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

export const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
})

/** Kolider mesh'inin değişmeyen prop'ları — boyut `scale` ile verilir. */
export function colliderProps(size: readonly [number, number, number]) {
  return {
    dispose: null,
    geometry: UNIT_COLLIDER,
    material: COLLIDER_MATERIAL,
    scale: size as unknown as [number, number, number],
    visible: false,
  } as const
}

/**
 * Donmuş yerel matrisi bir kez basar ve three'nin her-kare yeniden hesabını
 * kapatır.
 *
 * `Object3D.updateMatrixWorld` her karede `if (this.matrixAutoUpdate)
 * this.updateMatrix()` yapıyor — yani bayrağı AÇIK olan her nesne yerel
 * matrisini yeniden besteliyor (`compose`) ve `matrixWorldNeedsUpdate`
 * işaretliyor, bu da dünya matrisini yeniden bestelettiriyor
 * (`multiplyMatrices`). Çarpıştırıcı mount'tan sonra asla kımıldamıyor, yani
 * bu iş tamamen boşa: 3.582 raflık sahnede kare başına 3.582 `compose` +
 * 3.582 `multiplyMatrices`. Ölçüm (kullanıcı izleri, kamera hareketi,
 * 2026-08-07): `updateMatrixWorld` self %18, `multiplyMatrices` %12,1 —
 * profilin ilk iki kalemi.
 *
 * `updateMatrix()` çağrısı ŞART ve tuzağın kendisi: R3F `matrixAutoUpdate`'i
 * ne okuyor ne yazıyor (dist'inde geçmiyor), yani bayrak kapatılıp matris
 * basılmazsa çarpıştırıcı birim küp olarak kalır — ekranda hiçbir şey
 * değişmez, yalnız tıklama yanlış yeri vurur. Aynı tuzağın kayıtlı gruptaki
 * karşılığı `static-transform.ts`'te belgeli.
 */
export function freezeColliderMatrix(mesh: THREE.Object3D): void {
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
}

/**
 * Seçim çarpıştırıcısı — donmuş matrisli, tek paylaşılan küp ve materyal.
 *
 * Prop'lar sayı üçlüsü olarak alınıyor ve efektin bağımlılıkları da tek tek
 * sayılar: dizi kimliği her renderda değişir ve efekt boşuna koşardı.
 */
export function Collider({
  position = [0, 0, 0],
  rotation,
  size,
}: {
  position?: readonly [number, number, number]
  rotation?: readonly [number, number, number]
  size: readonly [number, number, number]
}) {
  const ref = useRef<THREE.Mesh>(null)
  const [px, py, pz] = position
  const [rx, ry, rz] = rotation ?? [0, 0, 0]
  const [sx, sy, sz] = size

  useLayoutEffect(() => {
    const mesh = ref.current
    if (mesh) freezeColliderMatrix(mesh)
  }, [px, py, pz, rx, ry, rz, sx, sy, sz])

  return (
    <mesh
      dispose={null}
      geometry={UNIT_COLLIDER}
      material={COLLIDER_MATERIAL}
      position={[px, py, pz]}
      ref={ref}
      rotation={[rx, ry, rz]}
      scale={[sx, sy, sz]}
      visible={false}
    />
  )
}
