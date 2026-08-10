'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useLayoutEffect, useRef } from 'react'
import type * as THREE from 'three'
import { useAppearance } from '../appearance'
import { getTelescopicPreviewMaterial } from './materials'
import { getTelescopicBaseGeometry, getTelescopicSectionGeometry } from './telescopic-geometry'
import { boomSections } from './telescopic-metrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

const NO_RAYCAST = () => {}

/**
 * Yerleştirme hayaleti — ayrı bileşen, renderer'da bayrak değil (pallet'in
 * rules-of-hooks dersi). Raycast kapalı: hayalet imleç ışınını keserse
 * `grid:move` durur ve makine son görülen yere yerleşir.
 */
export default function TelescopicPreview({ node }: { node: ConveyorTelescopicNode }) {
  const ref = useRef<THREE.Group>(null)
  // Ayrı önbellek girdisi, gerçek materyalin mutasyonu DEĞİL: şeffaflığı
  // paylaşılan örneğe yazmak yerleştirilmiş her bomu saydamlaştırırdı.
  const material = getTelescopicPreviewMaterial(useAppearance())

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  return (
    <group ref={ref}>
      <mesh
        dispose={null}
        geometry={getTelescopicBaseGeometry(node, 'full')}
        material={material}
        raycast={NO_RAYCAST}
      />
      {boomSections(node).map((section) => (
        <mesh
          dispose={null}
          geometry={getTelescopicSectionGeometry(node, section.index, 'full')}
          key={section.index}
          material={material}
          position={[section.centerX, 0, 0]}
          raycast={NO_RAYCAST}
        />
      ))}
    </group>
  )
}
