'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { rebakeDriftedStaticTransforms } from '../static-transform'
import { useWarehouseStore } from '../store'
import {
  clearPools,
  evaluateTiers,
  instanceGeneration,
  pollLevelPositions,
  rebuildPools,
  refreshLevelWorldMatrices,
} from './collective'

/**
 * Kolektif sistemin kare önceliği.
 *
 * `LevelSystem` öncelik 5'te `position.y` yazıyor. Daha küçük bir öncelikte
 * koşmak, kat konumunu yazılmadan ÖNCE okumak demekti — her yeniden inşa bir
 * kare geride kalırdı. 6, "kat sistemi işini bitirdikten hemen sonra".
 */
const FRAME_PRIORITY = 6

/**
 * Sahne başına BİR kolektif çizici.
 *
 * `def.system` kind başına bir kez mount edilir ve bu sistem raf kind'ına
 * asılıdır. Bunun keyfî olduğu açıkça yazılıdır — konveyör ailesinin akış
 * sistemi düz modüle asılı, aynı gerekçeyle: bir tesis rafsız olabilir ama
 * eklenti kuruluysa sistem yine mount edilir (`RegisteredSystems`
 * kayıtlı her kind'ın sistemini kurar, sahnede düğüm olmasa bile).
 *
 * ## Kare bütçesi
 *
 * Kare başına yapılan tek iş: örneklerin 1/8'inin mesafe değerlendirmesi.
 * Matris yazımı YALNIZ sahne ya da katman değişince olur — 10.000 örneğe
 * her kare matris yazmak, kurtardığı çizim çağrısından pahalıya gelirdi ve
 * bu dosyanın var oluş gerekçesini yerdi.
 *
 * ## Kapatılabilir olması bir tercih değil
 *
 * Bu, render yolunun en kritik parçası ve tarayıcıda doğrulanmadan
 * gönderiliyor. `instancingEnabled` kapalıyken her düğüm eskisi gibi kendi
 * mesh'ini çizer — yani bozulursa kullanıcı tek düğmeyle eski davranışa
 * döner ve iki hâli yan yana ölçebilir.
 */
export default function CollectiveInstancingSystem() {
  const enabled = useWarehouseStore((s) => s.instancingEnabled)
  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )
  // Store her yazışta `nodes`'u değiştirir: sahne değişince yeniden kurulur
  // ve sürükleme sırasında hiç tetiklenmez (sürükleme store'a dokunmaz).
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  const rootRef = useRef<THREE.Group>(null)
  const frameRef = useRef(0)
  const generationRef = useRef(-1)
  const dirtyRef = useRef(true)
  /** Kat kimliği → son görülen yerel Y. Patlatma/solo/manuel hepsini kapsar. */
  const levelYRef = useRef(new Map<string, number>())

  // Sahne değişti: bir sonraki karede havuzlar yeniden kurulur. `nodes`
  // burada OKUNMAZ — kimliği sahne değişiminin ta kendisidir ve tek işi bu
  // efekti tetiklemektir (store her yazışta yeni nesne döndürür).
  useEffect(() => {
    dirtyRef.current = true
  }, [nodes])

  // Kapatıldığında havuzlar sökülür — düğümler kendi mesh'lerini zaten
  // çiziyor olacak, yoksa sahne iki kez çizerdi.
  useEffect(() => {
    if (enabled && !isExporting) return
    clearPools(rootRef.current)
    generationRef.current = -1
    dirtyRef.current = true
  }, [enabled, isExporting])

  /**
   * Unmount temizliği — Canvas yeniden mount edildiğinde ŞART.
   *
   * Havuzlar modül kapsamında, `root` ise bu bileşene ait. Editör ile preview
   * arasında geçiş Canvas'ı komple yeniden kuruyor; temizlik olmadan eski
   * mesh'ler ölü sahnenin çocuğu olarak havuzda kalıyor ve yeni Canvas onları
   * "zaten var" sayıp hiçbir yere eklemiyordu. `rebuildPools` artık bunu tek
   * başına da onarıyor, ama sızıntıyı en baştan bırakmamak daha doğru.
   */
  useEffect(() => {
    const root = rootRef.current
    return () => {
      clearPools(root)
      generationRef.current = -1
      dirtyRef.current = true
      levelYRef.current.clear()
    }
  }, [])

  useFrame(({ camera }) => {
    /**
     * Instancing kapalıyken bile koşar — çünkü düzelttiği şey kolektif
     * çizimle ilgili değil: host'un kayıtlı nesneye doğrudan yazdığı Y
     * (slab lifti) ve imperatif sürükleme, `matrixAutoUpdate = false`
     * tarafından yutuluyordu. Bu, paketteki tek her-kare döngüsü olduğu için
     * kontrol buraya asılı; erken çıkışların ÜSTÜNDE durması bilinçli.
     */
    rebakeDriftedStaticTransforms()

    const root = rootRef.current
    if (!root) return
    /**
     * Export sırasında kolektif çizim KAPALI: dışa aktarma her zaman
     * dosyadaki sahnedir ve `isExporting` düğümlere kendi mesh'lerini
     * çizdirir (paletin film kuralının aynısı).
     */
    if (!enabled || isExporting) return

    frameRef.current += 1
    const tierChanged = evaluateTiers(camera.position, frameRef.current)
    const generation = instanceGeneration()
    const levelsMoved = pollLevelPositions(levelYRef.current)

    if (tierChanged || levelsMoved || dirtyRef.current || generation !== generationRef.current) {
      generationRef.current = generation
      dirtyRef.current = false
      refreshLevelWorldMatrices()
      rebuildPools(root)
    }
  }, FRAME_PRIORITY)

  return <group ref={rootRef} />
}
