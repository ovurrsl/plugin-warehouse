import type * as THREE from 'three'

/**
 * Gölge haritasını TALEP üzerine tazeleyen kısıcı — editöre dokunmadan.
 *
 * three 0.185'in gölge geçidi ışık başına kapılı: `ShadowNode.updateBefore`
 * `shadow.needsUpdate || shadow.autoUpdate` false ise haritayı hiç çizmiyor
 * ve çizdiği karede `needsUpdate`'i kendisi sıfırlıyor (three kaynağından
 * doğrulandı). `castShadow`'a dokunulmuyor — host'un r184 WebGPU
 * `castShadow`-çevirme yasağı bu mekanizmayı kapsamıyor; kısılan şey
 * materyal derlemesi değil, haritanın YENİDEN ÇİZİM sıklığı.
 *
 * Gerekçe ölçülü: gölge geçidi eski 70,4 ms tabanda karenin ~29 ms'iydi
 * (`?disable=shadows`, docs/olcum-sonuclari.md) ve depo sahnesi karelerin
 * ezici çoğunluğunda DURAĞAN — her kare yeniden çizilen şey, değişmeyen bir
 * haritaydı.
 *
 * ## Kör noktalar ve kalp atışı
 *
 * Host'un store'a yazmayan animasyonları (kapı lerp'i, ışık frustum refit'i)
 * eklentinin hareket sinyallerine görünmez. Bu yüzden saf talep-üzerine
 * değil, kalp atışlı: her `HEARTBEAT_FRAMES` karede bir zorunlu tazeleme.
 * 4 kare @ 50 fps = gölge 12,5 Hz güncellenir — kapı gölgesi akıcı kalır,
 * kaçırılan her sinyal ≤80 ms'de kendini onarır, geçit sayısı ~%75 düşer.
 *
 * Panelden kapatılabilir (`shadowThrottleEnabled`) — `instancingEnabled`
 * deseninin aynısı: bozulursa tek tıkla eski davranış, iki hâl yan yana
 * ölçülebilir. Kapatma/unmount `release()` ile ışıkları three'nin kendi
 * temposuna GERİ verir; verilmezse gölgeler sahipsiz donar.
 */
const HEARTBEAT_FRAMES = 4
/** Işık listesi tema başına sabit — tam sahne gezinişi kare başına değil,
 *  bu aralıkta bir. */
const LIGHT_RESCAN_FRAMES = 60

type ThrottledShadow = { autoUpdate: boolean; needsUpdate?: boolean }

/** Dokunulan her gölge — release'in geri vereceği küme. Işık listesinden
 *  ayrı, çünkü tarama listesi yenilenirken sökülen bir ışığın gölgesi de
 *  geri verilmeyi bekliyor olabilir. */
const touched = new Set<ThrottledShadow>()
let lights: ThrottledShadow[] = []
let framesSinceScan = LIGHT_RESCAN_FRAMES
let framesSinceRefresh = 0

function scanLights(scene: THREE.Scene): void {
  const found: ThrottledShadow[] = []
  scene.traverse((object) => {
    const light = object as THREE.Object3D & {
      isDirectionalLight?: boolean
      shadow?: ThrottledShadow
    }
    if (light.isDirectionalLight && light.castShadow && light.shadow) found.push(light.shadow)
  })
  lights = found
}

/**
 * Kolektif sistemin kare döngüsünden, erken çıkışların üstünde çağrılır.
 * `dirty` — bir gölgeyi kımıldatabilecek bir şey oldu: store yazımı, kirli
 * düğüm, canlı sürükleme, rebake.
 */
export function throttleShadows(scene: THREE.Scene, dirty: boolean): void {
  framesSinceScan += 1
  if (framesSinceScan >= LIGHT_RESCAN_FRAMES) {
    framesSinceScan = 0
    scanLights(scene)
  }

  framesSinceRefresh += 1
  const refresh = dirty || framesSinceRefresh >= HEARTBEAT_FRAMES
  if (refresh) framesSinceRefresh = 0

  for (const shadow of lights) {
    if (shadow.autoUpdate) {
      // İlk temas: three'nin temposundan devral ve haritayı bir kez tazele —
      // devralınan kare neye denk gelirse gelsin gölge güncel başlar.
      shadow.autoUpdate = false
      shadow.needsUpdate = true
      touched.add(shadow)
      continue
    }
    if (refresh) shadow.needsUpdate = true
  }
}

/** Kapatma ve unmount yolu — dokunulan her ışığı three'nin kendi temposuna
 *  geri verir. Verilmeyen bir gölge sahipsiz donar ve hiçbir şey hata vermez. */
export function releaseShadows(): void {
  for (const shadow of touched) {
    shadow.autoUpdate = true
    shadow.needsUpdate = true
  }
  touched.clear()
  lights = []
  framesSinceScan = LIGHT_RESCAN_FRAMES
  framesSinceRefresh = 0
}

/** Test kancası. */
export function throttledShadowCount(): number {
  return touched.size
}
