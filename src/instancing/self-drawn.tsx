'use client'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { Vector3 } from 'three'
import type { InstanceTier } from './collective'

/**
 * Kendi mesh'ini çizen bir düğümün gövdesi — ve mesafeye bağlı katman döngüsü.
 *
 * ## Neden ayrı bir bileşen
 *
 * `useFrame` KOŞULLU çağrılamaz (kancalar kuralı), ama bir bileşen koşullu
 * MOUNT edilebilir. Aradaki fark ölçülebilir bir maliyet:
 *
 * Dokuz renderer da katman döngüsünü gövdenin yanında, düğümün kökünde
 * çağırıyordu. Kolektif çizici AÇIKKEN o düğümler kendi mesh'lerini hiç
 * kurmuyor, yani `meshRef.current` `null` kalıyor ve döngü ilk satırda
 * dönüyordu — ama R3F'in abonelik listesinde duruyor ve HER KARE çağrılıyordu.
 * İki bin raflık bir sahnede bu, kare başına iki bin hiçbir şey yapmayan
 * kapanış çağrısı; üstelik kolektif sistem aynı işi (`evaluateTiers`) zaten
 * merkezî olarak, tek döngüde yapıyor.
 *
 * Bu bileşen yalnız düğüm kendi çizerken mount olduğu için, kolektif açıkken
 * abonelik HİÇ kurulmuyor.
 *
 * ## Neden geometri `tierRef`'ten okunuyor
 *
 * Katman prop olarak sabitlenirse R3F, referansla karşılaştırdığı için, her
 * yeniden render'da imperatif takası eziyor: uzaktaki bir modül seçildiğinde
 * ya da paneli düzenlendiğinde tam mesh'e geri dönüyor, `tierRef` hâlâ
 * `'simple'` dediği için de `next === current` koruması kamera histerezis
 * bandını baştan sona geçene kadar yeniden düşürmeyi engelliyordu. Raf ve
 * araç bu hatayı ayrı ayrı yaşadı; tek gövdede bir kez çözülüyor.
 */
export function SelfDrawnBody({
  farSq,
  geometryFor,
  isExporting,
  materialFor,
  nearSq,
  nodeId,
}: {
  farSq: number
  /** Katman başına geometri. Kolektif yolunun `geometryFor`'uyla AYNI işlev —
   *  iki yolun farklı mesh göstermesi imkânsız olsun diye. */
  geometryFor: (tier: InstanceTier) => THREE.BufferGeometry
  /** Dışa aktarım mesafeye bağlı bir katmanı dosyaya pişirmemeli. */
  isExporting: boolean
  /**
   * Katman başına materyal — `useCollective`'in `materialFor`'uyla aynı imza.
   *
   * Çoğu kind için sabit, ama palet güvertesi uzak katmanda BAŞKA bir materyal
   * kullanıyor: EPAL atlası çıplak bir kutunun UV'lerine yayılıyor ve tahta
   * dokusu leke oluyor. İmza sabit `material` olarak kalsaydı, o kind bu
   * bileşeni kullanamaz ve kendi kopyasını taşımaya devam ederdi — iki yolun
   * ayrışabildiği bir yer daha.
   */
  materialFor: (tier: InstanceTier) => THREE.Material
  nearSq: number
  nodeId: string
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const tierRef = useRef<InstanceTier>('full')
  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(nodeId), [nodeId])

  useFrame(({ camera }) => {
    const mesh = meshRef.current
    if (!mesh || isExporting) return
    frameRef.current += 1
    if ((frameRef.current + phase) % LOD_INTERVAL !== 0) return

    // R3F'in bu karede zaten güncellediği dünya matrisinden okunuyor.
    // `getWorldPosition` her düğüm için bütün ata zincirini yürüyüp yeniden
    // çarpardı, ve depo ölçeğinde asıl maliyet odur.
    const { elements } = mesh.matrixWorld
    const distanceSq = camera.position.distanceToSquared(
      worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
    )
    const current = tierRef.current
    const next: InstanceTier =
      current === 'full'
        ? distanceSq > farSq
          ? 'simple'
          : 'full'
        : distanceSq < nearSq
          ? 'full'
          : 'simple'
    if (next === current) return
    tierRef.current = next
    mesh.geometry = geometryFor(next)
    mesh.material = materialFor(next)
  })

  return (
    <mesh
      /**
       * Koşulsuz — host'un sözleşmesi bu.
       *
       * Gölge kullanıcının anahtarıyla `renderer.shadowMap.enabled` üstünden
       * açılıp kapanıyor; host bunu bilerek seçmiş, çünkü `castShadow`'u
       * runtime'da çevirmek three r184'ün WebGPU node cache'ini bozuyor.
       * Built-in kind'ların hepsi koşulsuz bırakıyor.
       */
      castShadow
      /** Asla dispose edilmez: aynı şekildeki her düğüm bu buffer'ı paylaşıyor. */
      dispose={null}
      geometry={geometryFor(isExporting ? 'full' : tierRef.current)}
      material={materialFor(isExporting ? 'full' : tierRef.current)}
      raycast={NO_RAYCAST}
      ref={meshRef}
      receiveShadow
    />
  )
}

const NO_RAYCAST = () => {}

/** Modül düzeyinde tek tampon — kare döngüsünde `Vector3` ayırmak, kaçınmaya
 *  çalıştığımız maliyetin kendisi olurdu. */
const worldPosition = new Vector3()

/**
 * Kaç karede bir mesafe sınanacağı, ve düğümlerin bu karelere nasıl dağıldığı.
 *
 * Kimlikten türeyen bir faz, iki yüz modülün aynı karede hesap yapmasını
 * engelliyor — küçük bir maliyeti periyodik bir takılmaya çeviren şey odur.
 * Kolektif çizicinin kendi döngüsü de aynı 8'lik adımı kullanıyor.
 */
const LOD_INTERVAL = 8

/** Kimlik için kararlı bir 0..LOD_INTERVAL-1 kovası. FNV-1a — ucuz, ve aynı
 *  düğüm için her mount'ta aynı, yani yeniden mount'u atlatıyor. */
function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}
