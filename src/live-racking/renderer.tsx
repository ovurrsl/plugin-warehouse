'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { colliderProps } from '../collider'
import { useCollective } from '../instancing/use-collective'
import { useStaticTransform } from '../static-transform'
import {
  getLiveRackingGeometry,
  liveRackingGeometryKey,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { getLiveRackingMaterial } from './materials'
import { bayWidthM, channelDepthM, frameHeightM } from './metrics'
import type { LiveRackingDetail } from './parts'
import type { LiveRackingNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * LOD bandı — rafın kendi değerleriyle aynı gerekçe: tek eşik, tam üstünde
 * duran bir kanalı kamera her nefes aldığında geometri değiştirtir.
 *
 * Canlı raf rafından DAHA erken düşer: bir kanalda yüzlerce makara var ve
 * uzaktan hiçbiri okunmuyor, tek şerit aynı bilgiyi taşıyor.
 */
const LOD_FAR_SQ = 45 * 45
const LOD_NEAR_SQ = 32 * 32
const LOD_INTERVAL = 8

const worldPosition = new THREE.Vector3()

function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

export default function LiveRackingRenderer({ node }: { node: LiveRackingNode }) {
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

  const detailRef = useRef<LiveRackingDetail>('full')
  const geometry = useMemo(
    () => getLiveRackingGeometry(node, isExporting ? 'full' : detailRef.current),
    [node, isExporting],
  )
  const material = getLiveRackingMaterial()

  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getLiveRackingGeometry(node, tier === 'full' ? 'full' : 'simple'),
    keyFor: (tier) => liveRackingGeometryKey(node, tier === 'full' ? 'full' : 'simple'),
    materialFor: () => material,
    materialKeyFor: () => 'live-racking',
    castsShadow: true,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  // İki katman da ekranda sayılır: tahliye çizileni boşaltamaz.
  useEffect(() => {
    const keys = [
      retainGeometry(liveRackingGeometryKey(node, 'full')),
      retainGeometry(liveRackingGeometryKey(node, 'simple')),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node])

  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  useFrame(({ camera }) => {
    const mesh = meshRef.current
    if (!mesh || isExporting) return
    frameRef.current += 1
    if ((frameRef.current + phase) % LOD_INTERVAL !== 0) return

    const { elements } = mesh.matrixWorld
    const distanceSq = camera.position.distanceToSquared(
      worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
    )
    const current = detailRef.current
    const next =
      current === 'full'
        ? distanceSq > LOD_FAR_SQ
          ? 'simple'
          : 'full'
        : distanceSq < LOD_NEAR_SQ
          ? 'full'
          : 'simple'
    if (next === current) return
    detailRef.current = next
    mesh.geometry = getLiveRackingGeometry(node, next)
  })

  const width = bayWidthM(node)
  const depth = channelDepthM(node)
  const height = frameHeightM(node)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {/* Seçim kolideri: bir kanal neredeyse tamamen hava, tıklamalar
          makaraların arasından geçip arkadakini seçerdi. */}
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
            castShadow
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
