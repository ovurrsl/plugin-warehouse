'use client'

import { useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { useWarehouseStore } from '../store'
import { buildFleet, EMPTY_FLEET, MAX_STEP_S, stepFleet } from './fleet'
import { publishFleetPoses, releaseFleetPoses } from './live-poses'

/**
 * Filo — sahne başına BİR (def.system kind başına bir kez mount edilir),
 * `flow-system.tsx`'in deseni.
 *
 * Poz kanalı `useLiveTransforms` (plan §5.1) ve bu dört doğrulanmış sebeple
 * pazarlık dışı: host'un yükseklik sistemi canlı düğümler için her karede
 * koşar (slab lifti bedava), 2B plan katmanı canlı transform'u okur (3B'de
 * giden aracın 2B'de donmaması), seçim kolideri pozu aynı kanaldan izler
 * (hareket eden araç tıklanabilir kalır), ve `useStaticTransform` canlı
 * bayrağını aynı kanaldan türetir (donmuş araç yapısal olarak imkânsız).
 *
 * Durunca kanal temizlenir: her araç park pozuna BİR karede döner — animasyon
 * yok, çünkü bu bir restore'dur, düğüm verisi hiç değişmedi. Export sırasında
 * aynısı: çıktı her zaman dosyadaki sahnedir, karedeki değil.
 */
export default function TruckFleetSystem() {
  const running = useWarehouseStore((s) => s.fleetRunning)
  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )
  // Store her yazışta `nodes`'u değiştirir: filo tam da düğümler değişince
  // yeniden kurulur — sürükleme store'a dokunmaz, kare döngüsü etkilenmez.
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)
  // Kapalıyken ağ KURULMAZ: düğmeye hiç basmayan kullanıcı, her undo'da bir
  // filo taraması ödemesin (flow-system'in aynı gerekçesi).
  const fleet = useMemo(() => (running ? buildFleet(nodes) : EMPTY_FLEET), [nodes, running])

  /** Bu sistemin yazdığı kimlikler — temizliği yazanın borcu. */
  const drivenRef = useRef<Set<string>>(new Set())

  // Filo yeniden kurulunca artık sürülmeyenler serbest bırakılır — rotası
  // silinen araç park pozuna döner, kalıcı hayalet poz kalmaz (T29/T30).
  useEffect(() => {
    releaseFleetPoses(drivenRef.current, new Set(fleet.trucks.map((truck) => truck.id)))
  }, [fleet])

  // Durdurma, export ve unmount aynı yoldan temizler.
  useEffect(() => {
    const driven = drivenRef.current
    if (!running || isExporting) releaseFleetPoses(driven)
    return () => releaseFleetPoses(driven)
  }, [running, isExporting])

  useFrame((_, delta) => {
    if (!running || isExporting || fleet.trucks.length === 0) return
    stepFleet(fleet, Math.min(delta, MAX_STEP_S))
    // Bütün pozlar TEK store yazımında — gerekçesi `live-poses.ts`.
    publishFleetPoses(fleet, useLiveNodeOverrides.getState().overrides, drivenRef.current)
  })

  return null
}
