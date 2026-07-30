'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { useWarehouseStore } from '../store'
import { clearPools, evaluateTiers, instanceGeneration, rebuildPools } from './collective'

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

  // Sahne değişti: bir sonraki karede havuzlar yeniden kurulur. `nodes`
  // burada OKUNMAZ — kimliği sahne değişiminin ta kendisidir ve tek işi bu
  // efekti tetiklemektir (store her yazışta yeni nesne döndürür).
  useEffect(() => {
    dirtyRef.current = true
  }, [nodes])

  // Kapatıldığında ya da unmount'ta havuzlar sökülür — düğümler kendi
  // mesh'lerini zaten çiziyor olacak, yoksa sahne iki kez çizerdi.
  useEffect(() => {
    if (enabled && !isExporting) return
    clearPools(rootRef.current)
    generationRef.current = -1
    dirtyRef.current = true
  }, [enabled, isExporting])

  useFrame(({ camera }) => {
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

    if (tierChanged || dirtyRef.current || generation !== generationRef.current) {
      generationRef.current = generation
      dirtyRef.current = false
      rebuildPools(root)
    }
  })

  return <group ref={rootRef} />
}
