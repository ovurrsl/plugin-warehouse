import React, { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'

import { getOrCreateEPALTextureAtlas } from './epal-textures'
import { getOrCreateEPALGeometry } from './geometry-builder'
import type { EuroPalletNode } from './schema'

/**
 * High-Performance 1:1 Official EPAL 1 (EUR 1) Euro Pallet 3D Mesh
 *
 * Uses pre-merged 20-component BufferGeometry and procedural PBR Texture Atlas
 * (Wood Grain, EPAL/EUR stamps, IPPC mark, metallic control nail seal).
 * Operates with a SINGLE MeshStandardMaterial for 1-Draw-Call instancing efficiency!
 */
export function EuroPallet3DGeometry() {
  const geometry = useMemo(() => getOrCreateEPALGeometry(), [])
  const atlas = useMemo(() => {
    const a = getOrCreateEPALTextureAtlas()
    a.map.anisotropy = 16
    a.roughnessMap.anisotropy = 16
    a.metalnessMap.anisotropy = 16
    return a
  }, [])

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: atlas.map,
        roughnessMap: atlas.roughnessMap,
        metalnessMap: atlas.metalnessMap,
        roughness: 0.75,
        metalness: 0.2,
      }),
    [atlas],
  )

  return (
    <mesh
      castShadow
      geometry={geometry}
      material={material}
      receiveShadow
    />
  )
}

export default function EuroPalletRenderer({ node }: { node: EuroPalletNode }) {
  const ref = useRef<THREE.Group>(null!)
  const liveTransform = useLiveTransforms((s: any) => s.transforms?.[node.id as string])

  const rawAny = node as any
  const position = liveTransform?.position ?? rawAny.position ?? [0, 0, 0]
  const rotationY =
    liveTransform?.rotation ??
    (Array.isArray(rawAny.rotation) ? rawAny.rotation[1] ?? 0 : rawAny.rotation ?? 0)

  const isPreview = (node.id as string).includes('preview') || (node as any).isTransient

  const handlers = useNodeEvents(
    isPreview ? (null as any) : (node as any),
    'warehouse:euro-pallet' as any,
  )

  if (!isPreview) {
    useRegistry(node.id as any, node.type as any, ref)
  }

  return (
    <group
      ref={ref}
      position={position}
      rotation={[0, rotationY, 0]}
      visible={node.visible !== false}
      {...handlers}
    >
      <EuroPallet3DGeometry />
    </group>
  )
}
