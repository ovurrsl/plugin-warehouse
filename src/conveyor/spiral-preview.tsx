'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAppearance } from '../appearance'
import { getSpiralSlatGeometry, getSpiralStaticGeometry } from './spiral-geometry'
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
