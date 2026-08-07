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
import { getRackMaterial } from '../rack/materials'
import { useStaticTransform } from '../static-transform'
import { totalDepth, totalWidth } from './bays'
import {
  getM3Geometry,
  m3GeometryKey,
  releaseM3Geometry,
  retainM3Geometry,
} from './geometry-builder'
import { hasRightNeighbour } from './neighbours'
import type { M3ShelvingNode } from './schema'

/**
 * The same distance band as the other three racking kinds, deliberately.
 *
 * An M3 run usually stands in the same picking area as selective racking and
 * M7 bays, and four kinds swapping tier at four distances would draw visible
 * lines across the building where one family went plain and the others did not.
 */
const LOD_FAR_SQ = 70 * 70
const LOD_NEAR_SQ = 55 * 55

const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

/** Invisible, and deliberately so — `visible = false` takes the collider out of
 *  `projectObject` entirely while the raycaster keeps hitting it. */
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

/**
 * Mounted through `def.renderer` rather than `def.geometry`: `<GeometrySystem>`
 * disposes the previous build's children on every rebuild, and the geometry
 * here is shared by every bay of the same shape.
 *
 * The material is the **rack's**. M3 steel reads the same punched-slot atlas,
 * and a second material would mean a second shader compile and a second draw
 * call in every scene holding both.
 */
export default function M3Renderer({ node }: { node: M3ShelvingNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <M3RendererBody node={node} />
}

function M3RendererBody({ node }: { node: M3ShelvingNode }) {
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

  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  const abutted = useScene((s) => hasRightNeighbour(s.nodes as Record<string, unknown>, node.id))
  const omission = useMemo(() => ({ omitRight: abutted }), [abutted])

  const appearance = useAppearance()
  const material = getRackMaterial(appearance)

  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getM3Geometry(node, tier, omission),
    keyFor: (tier) => m3GeometryKey(node, tier, omission),
    materialFor: () => material,
    // The same pool as the other racking kinds: identical material, and
    // splitting them would double the draw calls of a mixed scene.
    materialKeyFor: () => `rack:${appearanceKey(appearance)}`,
    castsShadow: false,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  useEffect(() => {
    const near = retainM3Geometry(node, 'full', omission)
    const far = retainM3Geometry(node, 'simple', omission)
    return () => {
      releaseM3Geometry(near)
      releaseM3Geometry(far)
    }
  }, [node, omission])

  const width = totalWidth(node)
  const depth = totalDepth(node)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {/* Selection collider. A shelving bay is mostly air; without one a click
          aimed between the shelves selects whatever is behind. Outside the
          registered group so the outline still traces the real silhouette. */}
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting && (
          <mesh
            dispose={null}
            geometry={UNIT_COLLIDER}
            material={COLLIDER_MATERIAL}
            position={[0, node.frameHeight / 2, 0]}
            scale={[width, node.frameHeight, depth]}
            visible={false}
          />
        )}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getM3Geometry(node, tier, omission)}
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
