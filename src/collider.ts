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
