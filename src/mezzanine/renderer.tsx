'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { colliderProps } from '../collider'
import { useCollective } from '../instancing/use-collective'
import { useStaticTransform } from '../static-transform'
import {
  getMezzanineGeometry,
  mezzanineGeometryKey,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { getMezzanineMaterial } from './materials'
import { footprintDepthM, footprintWidthM, totalHeightM } from './metrics'
import type { MezzanineNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Mezzanine — TEK birleşik mesh (rack deseni, telescopic'in bölüm-başına-grup
 * deseni DEĞİL): tier'ler animasyonlu değil, bir düzenleme yalnız panelden
 * gelir, dolayısıyla mutlak Y konumlarını doğrudan vertex'lere yazmanın
 * ekstra karmaşıklığı yok.
 *
 * Faz 1'de LOD tier'i yok — rack'ın LOD'u binlerce tekrardan değer kazanıyor,
 * bir sahnede bir-iki mezzanine için bu maliyet henüz gerekçesiz.
 */
export default function MezzanineRenderer({ node }: { node: MezzanineNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const meshRef = useRef<THREE.Mesh>(null)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )

  const live = useLiveTransforms((s) => s.get(node.id))
  const override = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const overridePosition = override?.position as [number, number, number] | undefined
  const overrideRotation = override?.rotation as [number, number, number] | undefined

  const position = live?.position ?? overridePosition ?? node.position ?? [0, 0, 0]
  const baseRotation = overrideRotation ?? node.rotation ?? [0, 0, 0]
  const rotation: [number, number, number] = live
    ? [baseRotation[0], live.rotation, baseRotation[2]]
    : baseRotation

  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  const geometry = getMezzanineGeometry(node)
  const material = getMezzanineMaterial()

  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: () => getMezzanineGeometry(node),
    keyFor: () => mezzanineGeometryKey(node),
    material,
    materialKey: 'mezzanine',
    castShadowWhenFull: true,
    farSq: 90 * 90,
    nearSq: 70 * 70,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  // Havuzun tahliye kuralı görünürken cache'i bilgilendirir — telescopic'in
  // deseni. Yalnız tek katman (Faz 1'de LOD yok).
  useEffect(() => {
    const key = retainGeometry(mezzanineGeometryKey(node))
    return () => releaseGeometry(key)
  }, [node])

  const width = footprintWidthM(node)
  const depth = footprintDepthM(node)
  const height = totalHeightM(node)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {!isExporting && (
        <mesh
          position={[position[0], position[1] + height / 2, position[2]]}
          rotation={rotation}
          {...colliderProps([width, height, depth])}
        />
      )}

      <group position={position} ref={registeredRef} rotation={rotation}>
        {drawsSelf && (
          <mesh
            castShadow={isExporting}
            dispose={null}
            geometry={geometry}
            material={material}
            raycast={NO_RAYCAST}
            receiveShadow
            ref={meshRef}
          />
        )}
      </group>
    </group>
  )
}
