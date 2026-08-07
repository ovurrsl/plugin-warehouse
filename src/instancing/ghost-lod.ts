import type * as THREE from 'three'

/**
 * Düğüm başına mount olan ama katman kararı yalnız kameraya bağlı olan
 * mesh'lerin (rafın hayalet stoğu) MERKEZÎ LOD sürüşü.
 *
 * `GhostStock` bu değerlendirmeyi kendi `useFrame`'inde yapıyordu — hayaletli
 * düğüm başına bir kare aboneliği. `self-drawn.tsx` aynı maliyeti ölçüp
 * kaldırmıştı (kare başına binlerce boş kapanış); hayalet döngüsü o desenin
 * kalan son örneğiydi. Kayıt buradan, sürüş kolektif sistemin zaten koşan
 * döngüsünden: kare aboneliği sayısı hayalet sayısından bağımsız, SABİT.
 *
 * Faz dağıtımı korunuyor: her girdi kimliğinden türeyen fazıyla, aralığın
 * yalnız kendi karesinde değerlendiriliyor — hepsi aynı karede mesafe
 * hesaplamıyor. FNV-1a, `self-drawn` ile aynı gerekçeyle: yeniden mount
 * aynı fazı verir, kademeli mount dalgası fazları kümelemez.
 */
const EVAL_INTERVAL = 8

type Evaluee = {
  phase: number
  evaluate: (camera: THREE.Camera) => void
}

const evaluees = new Map<string, Evaluee>()

function phaseOf(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % EVAL_INTERVAL
}

/**
 * Sökücüyü döndürür. Sökücü yalnız KENDİ kaydını siler: StrictMode'un çift
 * mount'unda ikinci kayıt öncekinin yerine geçmiş olabilir ve ilkinin geç
 * kalan temizliği yenisini düşürmemeli.
 */
export function registerGhostLod(id: string, evaluate: (camera: THREE.Camera) => void): () => void {
  const entry: Evaluee = { phase: phaseOf(id), evaluate }
  evaluees.set(id, entry)
  return () => {
    if (evaluees.get(id) === entry) evaluees.delete(id)
  }
}

let frame = 0

/** Kolektif sistemin kare döngüsünden, erken çıkışların üstünde çağrılır —
 *  hayalet katmanı kolektif çizim kapalıyken de doğru kalmalı. */
export function tickGhostLod(camera: THREE.Camera): void {
  frame += 1
  if (evaluees.size === 0) return
  for (const entry of evaluees.values()) {
    if ((frame + entry.phase) % EVAL_INTERVAL !== 0) continue
    entry.evaluate(camera)
  }
}

/** Test kancası — kayıt sayısının sızmadığının tek kanıtı. */
export function ghostLodCount(): number {
  return evaluees.size
}
