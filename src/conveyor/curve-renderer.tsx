'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { useAdmitted } from '../instancing/admission'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { curveGeometryKey, getCurveGeometry, retainCurveGeometry } from './curve-geometry'
import { colliderSegments } from './curve-metrics'
import type { ConveyorCurveNode } from './curve-schema'
import { releaseGeometry } from './geometry-builder'
import { hasDownstreamNeighbour } from './line-index'
import { getConveyorMaterial } from './materials'
import { LOD_FAR_SQ, LOD_NEAR_SQ } from './renderer'

/** Shared by every picking collider, scaled and turned per segment. */
const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

/**
 * Invisible, and deliberately so. `visible = false` takes a collider out of
 * `WebGLRenderer.projectObject` entirely — no colour pass, no shadow pass —
 * while three's raycaster and R3F's event layer both ignore `visible` and keep
 * hitting it. A `colorWrite: false` material would still cost a draw call per
 * segment in both passes.
 */
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

export default function ConveyorCurveRenderer({ node }: { node: ConveyorCurveNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <ConveyorCurveRendererBody node={node} />
}

function ConveyorCurveRendererBody({ node }: { node: ConveyorCurveNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
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

  /** Whether the module standing downstream builds the shared support. One at
   *  every joint, not two — see `../conveyor/parts`. */
  const abutted = useScene((s) => hasDownstreamNeighbour(s.nodes as Record<string, unknown>, node))

  const appearance = useAppearance()
  const material = getConveyorMaterial(appearance)

  // Kolektif çiziciye katılım ve gerekçesi `./renderer.tsx`'te; eşikler de
  // oradan, çünkü bir hattın ortasında iki komşunun farklı katmana düşmesi
  // görünür bir dikiş demek olurdu.
  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getCurveGeometry(node, tier, abutted),
    keyFor: (tier) => curveGeometryKey(node, tier, abutted),
    materialFor: () => material,
    materialKeyFor: () => `conveyor:${appearanceKey(appearance)}`,
    castsShadow: true,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  /** Tell the cache this shape is on screen. Eviction must never free a buffer
   *  something is drawing, and this is the only place that knows. */
  useEffect(() => {
    const near = retainCurveGeometry(node, 'full', abutted)
    const far = retainCurveGeometry(node, 'simple', abutted)
    return () => {
      releaseGeometry(near)
      releaseGeometry(far)
    }
  }, [node, abutted])

  /**
   * The picker follows the arc rather than wrapping it.
   *
   * A bend is mostly air — a click between the rollers would otherwise select
   * the floor — but its bounding box is mostly air *too*, and a single collider
   * would swallow clicks aimed at whatever sits in the corner the bend curls
   * around. These are inside the transformed group, so they inherit the node's
   * position and rotation and only carry their own local offsets.
   */
  const colliders = useMemo(() => colliderSegments(node), [node])
  const colliderHeight = Math.max(0.2, node.transportHeight + node.sideGuideHeight)

  return (
    <group visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting &&
          colliders.map((segment, index) => (
            <mesh
              dispose={null}
              geometry={UNIT_COLLIDER}
              key={`${segment.rotationY}:${index}`}
              material={COLLIDER_MATERIAL}
              position={[segment.center[0], colliderHeight / 2, segment.center[1]]}
              rotation={[0, segment.rotationY, 0]}
              scale={[segment.size[0], colliderHeight, segment.size[1]]}
              visible={false}
            />
          ))}

        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getCurveGeometry(node, tier, abutted)}
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
