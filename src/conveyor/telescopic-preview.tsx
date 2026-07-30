'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { getTelescopicBaseGeometry, getTelescopicSectionGeometry } from './telescopic-geometry'
import { boomSections } from './telescopic-metrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

const NO_RAYCAST = () => {}

let previewMaterial: THREE.MeshStandardMaterial | null = null

/** Hayaletin materyali: paylaşılan örneğin mutasyonu değil, ayrı klon —
 *  şeffaflık yerleştirilmiş her konveyöre sızardı. */
function getPreviewMaterial(): THREE.MeshStandardMaterial {
  if (!previewMaterial) {
    previewMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  }
  return previewMaterial
}

/**
 * Yerleştirme hayaleti — ayrı bileşen, renderer'da bayrak değil (pallet'in
 * rules-of-hooks dersi). Raycast kapalı: hayalet imleç ışınını keserse
 * `grid:move` durur ve makine son görülen yere yerleşir.
 */
export default function TelescopicPreview({ node }: { node: ConveyorTelescopicNode }) {
  const ref = useRef<THREE.Group>(null)
  const material = getPreviewMaterial()

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
