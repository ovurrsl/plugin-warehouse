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
import type * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useAdmitted } from '../instancing/admission'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { releaseGeometry } from './geometry-builder'
import { hasDownstreamNeighbour } from './line-index'
import { getConveyorMaterial } from './materials'
import { getObliqueGeometry, obliqueGeometryKey, retainObliqueGeometry } from './oblique-geometry'
import {
  branchCentreLocal,
  branchHeadingRad,
  branchLengthM,
  branchWidthM,
  mainWidthM,
  moduleLengthM,
} from './oblique-metrics'
import type { ConveyorObliqueNode } from './oblique-schema'
import { LOD_FAR_SQ, LOD_NEAR_SQ } from './renderer'

export default function ConveyorObliqueRenderer({ node }: { node: ConveyorObliqueNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <ConveyorObliqueRendererBody node={node} />
}

function ConveyorObliqueRendererBody({ node }: { node: ConveyorObliqueNode }) {
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

  const abutted = useScene((s) => hasDownstreamNeighbour(s.nodes as Record<string, unknown>, node))

  const appearance = useAppearance()
  const material = getConveyorMaterial(appearance)

  // Kolektif çiziciye katılım ve gerekçesi `./renderer.tsx`'te; eşikler oradan.
  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getObliqueGeometry(node, tier, abutted),
    keyFor: (tier) => obliqueGeometryKey(node, tier, abutted),
    materialFor: () => material,
    materialKeyFor: () => `conveyor:${appearanceKey(appearance)}`,
    castsShadow: true,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  useEffect(() => {
    const near = retainObliqueGeometry(node, 'full', abutted)
    const far = retainObliqueGeometry(node, 'simple', abutted)
    return () => {
      releaseGeometry(near)
      releaseGeometry(far)
    }
  }, [node, abutted])

  /**
   * Two pickers, and the second one is turned.
   *
   * An oblique's steel is a Y, and the rectangle containing it is mostly the
   * wedge between the two beds — which in a real layout is where the line the
   * branch feeds runs. One box would swallow every click aimed at it.
   */
  const colliders = useMemo(() => {
    const [branchX, branchZ] = branchCentreLocal(node)
    return {
      height: Math.max(0.2, node.transportHeight),
      boxes: [
        {
          center: [0, 0] as [number, number],
          size: [moduleLengthM(node), mainWidthM(node)] as [number, number],
          rotationY: 0,
        },
        {
          center: [branchX, branchZ] as [number, number],
          size: [branchLengthM(node), branchWidthM(node)] as [number, number],
          rotationY: branchHeadingRad(node),
        },
      ],
    }
  }, [node])

  return (
    <group visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting &&
          colliders.boxes.map((box) => (
            <Collider
              key={`${box.center[0]}:${box.center[1]}`}
              position={[box.center[0], colliders.height / 2, box.center[1]]}
              rotation={[0, box.rotationY, 0]}
              size={[box.size[0], colliders.height, box.size[1]]}
            />
          ))}

        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getObliqueGeometry(node, tier, abutted)}
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
