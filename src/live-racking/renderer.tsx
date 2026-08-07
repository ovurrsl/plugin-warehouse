'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { colliderProps } from '../collider'
import { useAdmitted } from '../instancing/admission'
import { SelfDrawnBody } from '../instancing/self-drawn'
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
import type { LiveRackingNode } from './schema'

const _NO_RAYCAST = () => {}

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

const _worldPosition = new THREE.Vector3()

function _hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

export default function LiveRackingRenderer({ node }: { node: LiveRackingNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <LiveRackingRendererBody node={node} />
}

function LiveRackingRendererBody({ node }: { node: LiveRackingNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const _meshRef = useRef<THREE.Mesh>(null)
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

  const appearance = useAppearance()
  const material = getLiveRackingMaterial(appearance)

  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getLiveRackingGeometry(node, tier === 'full' ? 'full' : 'simple'),
    keyFor: (tier) => liveRackingGeometryKey(node, tier === 'full' ? 'full' : 'simple'),
    materialFor: () => material,
    materialKeyFor: () => `live-racking:${appearanceKey(appearance)}`,
    castsShadow: false,
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

  const width = bayWidthM(node)
  const depth = channelDepthM(node)
  const height = frameHeightM(node)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {/* Seçim kolideri: bir kanal neredeyse tamamen hava, tıklamalar
          makaraların arasından geçip arkadakini seçerdi. */}
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting && (
          <mesh position={[0, height / 2, 0]} {...colliderProps([width, height, depth])} />
        )}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getLiveRackingGeometry(node, tier)}
            isExporting={isExporting}
            materialFor={() => material}
            nearSq={LOD_NEAR_SQ}
            nodeId={node.id}
          />
        )}
      </group>
    </group>
  )
}
