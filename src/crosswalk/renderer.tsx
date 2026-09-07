'use client'

import { type AnyNodeId, useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import type { Object3D } from 'three'
import * as THREE from 'three'
import { DEPTH_BIAS, ROUTE_ELEVATIONS } from '../route/constants'
import type { CrosswalkNode } from './schema'

export default function CrosswalkRenderer({ node }: { node: CrosswalkNode }) {
  const handlers = useNodeEvents(node as never, node.type as never)
  const registeredRef = useRef<Object3D>(null!)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  const live = useLiveTransforms((s) => s.get(node.id))
  const position = live?.position ?? node.position
  const rotation = live?.rotation ?? node.rotation

  const width = node.width ?? 3.5
  const length = node.length ?? 2.5
  const stripeCount = node.stripeCount ?? 6
  const stripeColor = node.stripeColor ?? '#ffffff'

  const count = Math.max(2, stripeCount)
  const barWidth = width
  const totalSpan = length
  const barDepth = totalSpan / (count * 2 - 1)
  const step = barDepth * 2

  const bars = useMemo(() => {
    const list: Array<{ x: number; z: number; w: number; d: number }> = []
    const startZ = -totalSpan / 2 + barDepth / 2
    for (let k = 0; k < count; k++) {
      list.push({
        x: 0,
        z: startZ + k * step,
        w: barWidth,
        d: barDepth,
      })
    }
    return list
  }, [count, barWidth, totalSpan, barDepth, step])

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(stripeColor),
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: DEPTH_BIAS.ZEBRA.polygonOffsetFactor,
      polygonOffsetUnits: DEPTH_BIAS.ZEBRA.polygonOffsetUnits,
      side: THREE.FrontSide,
    })
    mat.renderOrder = DEPTH_BIAS.ZEBRA.renderOrder
    return mat
  }, [stripeColor])

  return (
    <group
      position={position}
      rotation={rotation}
      ref={registeredRef}
      {...handlers}
    >
      {bars.map((bar, i) => (
        <mesh
          key={i}
          position={[bar.x, ROUTE_ELEVATIONS.ZEBRA_CROSSWALK, bar.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={material}
        >
          <planeGeometry args={[bar.w, bar.d]} />
        </mesh>
      ))}
    </group>
  )
}
