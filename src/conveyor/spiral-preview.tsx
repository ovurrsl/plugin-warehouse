'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAppearance } from '../appearance'
import {
  getSpiralSlatGeometry,
  getSpiralStaticGeometry,
  releaseGeometry,
  retainGeometry,
  spiralSlatKey,
  spiralStaticKey,
} from './spiral-geometry'
import { getSpiralCageMaterial, getSpiralPreviewMaterial } from './spiral-materials'
import { cageRadiusM, columnRadiusM, entryHeightM, overallHeightM } from './spiral-metrics'
import type { ConveyorSpiralNode } from './spiral-schema'

const NO_RAYCAST = () => {}

const COLUMN_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 24, 1)
const CAGE_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true)

/**
 * Yerleştirme hayaleti — ayrı bileşen (pallet'in rules-of-hooks dersi).
 * Raycast kapalı: hayalet imleç ışınını keserse `grid:move` durur.
 */
export default function SpiralPreview({ node }: { node: ConveyorSpiralNode }) {
  const ref = useRef<THREE.Group>(null)
  const appearance = useAppearance()
  const material = getSpiralPreviewMaterial(appearance)
  const cageMaterial = getSpiralCageMaterial(appearance)

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  /**
   * Hayalet de ekranda sayılır.
   *
   * Bu bileşen şekillerini PAYLAŞILAN havuzdan çekiyor ama tutmuyordu. Aynı
   * şekli çizen yerleştirilmiş bir sarmal silinince tutma sayacı sıfıra
   * düşüyor, `sweepConveyorGeometry` bekleme penceresi dolunca buffer'ı
   * serbest bırakıyor — ve hayalet o buffer'ı çizmeye devam ediyordu.
   * `position` bağlanamayan bir çizim WebGPU'da yalnız kendi mesh'ini değil,
   * o karenin TÜM command buffer'ını düşürüyor: ekran kararıyor ve nesne
   * sahnede durdukça her karede yeniden kararıyor.
   */
  useEffect(() => {
    const keys = [
      retainGeometry(spiralStaticKey(node, 'full')),
      retainGeometry(spiralSlatKey(node, 'full')),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node])

  const entry = entryHeightM(node)
  const overall = overallHeightM(node)
  const colR = columnRadiusM(node)
  const cageR = cageRadiusM(node)
  const travel = node.travelHeight

  return (
    <group ref={ref}>
      <mesh
        dispose={null}
        geometry={getSpiralStaticGeometry(node, 'full')}
        material={material}
        raycast={NO_RAYCAST}
      />
      <mesh
        dispose={null}
        geometry={COLUMN_GEOMETRY}
        material={material}
        position={[0, overall / 2, 0]}
        raycast={NO_RAYCAST}
        scale={[colR, overall, colR]}
      />
      <group position={[0, entry, 0]}>
        <mesh
          dispose={null}
          geometry={getSpiralSlatGeometry(node, 'full')}
          material={material}
          raycast={NO_RAYCAST}
        />
      </group>
      {node.hasCage && (
        <mesh
          dispose={null}
          geometry={CAGE_GEOMETRY}
          material={cageMaterial}
          position={[0, entry + travel / 2, 0]}
          raycast={NO_RAYCAST}
          scale={[cageR, travel, cageR]}
        />
      )}
    </group>
  )
}
