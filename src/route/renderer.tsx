'use client'

import { type AnyNodeId, useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import type { Object3D } from 'three'
import { useAppearance } from '../appearance'
import { useAdmitted } from '../instancing/admission'
import { PAINT_LIFT_M } from './constants'
import { getRouteGeometry, releaseRouteGeometry, retainRouteGeometry } from './geometry'
import { getRouteMaterials } from './materials'
import type { RouteNode } from './schema'
import { outerHalfWidthM } from './stripes'

/**
 * Painted floor markings.
 *
 * ## Registering the group is not bookkeeping — it is what puts the paint on the floor
 *
 * The first version of this file mounted a plain group and never called
 * `useRegistry`, and two separate symptoms followed from that one omission.
 *
 * `FloorElevationSystem` writes `slabElevation + node.position[1]` onto the
 * **registered** object; with nothing registered there was nothing to write to,
 * so the paint stayed on the level plane — 50 mm *under* a default slab. It
 * still appeared, because `polygonOffset` biases it toward the camera in depth,
 * but a raycast uses real vertex positions and not that bias, so the ray hit the
 * slab first and the route could not be clicked. Visible and unselectable, from
 * one missing line.
 *
 * `useLiveTransforms` is the other half: a drag publishes there and commits on
 * release, so without it a route being moved would sit still until the pointer
 * came up and then jump.
 */
/**
 * Kademeli mount kapısı — rack'in şablonu (`rack/renderer.tsx`), aynı
 * gerekçeyle: gövdenin pahalı işi kancalarında ve kancalar koşullu
 * çağrılamaz; "sıra bende değil" hâli ancak gövdeyi hiç mount etmeyerek
 * karşılanır. Bu kind düşük adetli, tavan (512) sayesinde normal sahnede
 * tek karede mount olur — kapı, dev sahnede yükleme dalgasına katılmak
 * ve "kolektif çizen her kind kapılı" kapsamını tamamlamak için.
 */
export default function RouteRenderer({ node }: { node: RouteNode }) {
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <RouteBody node={node} />
}

function RouteBody({ node }: { node: RouteNode }) {
  const handlers = useNodeEvents(node as never, node.type as never)
  const isExporting = useViewer((s) => s.isExporting ?? false)

  const registeredRef = useRef<Object3D>(null!)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  // The live position during a drag; the committed one otherwise.
  const live = useLiveTransforms((s) => s.get(node.id))
  const position = live?.position ?? node.position
  const rotation = live?.rotation ?? node.rotation

  const geometry = useMemo(() => getRouteGeometry(node), [node])
  const appearance = useAppearance()
  const materials = getRouteMaterials(node.role, appearance)

  // Claim the buffer while it is on screen. Eviction must never free a shape
  // something is drawing, and this is the only place that knows.
  useEffect(() => {
    const key = retainRouteGeometry(node)
    return () => releaseRouteGeometry(key)
  }, [node])

  return (
    <group
      position={position}
      ref={registeredRef}
      rotation={rotation}
      visible={node.visible !== false}
      {...handlers}
    >
      <mesh
        /**
         * Paint casts nothing and receives everything.
         *
         * `receiveShadow` is not optional: the slab under it receives, so a
         * marking that did not would glow in every shadowed aisle — brighter
         * than the floor it is painted on, which reads as an error long before
         * anyone works out why.
         */
        castShadow={false}
        dispose={null}
        geometry={geometry}
        material={materials}
        // Clear of the slab by a millimetre so a click reaches the paint rather
        // than the floor it is coplanar with. See PAINT_LIFT_M — this answers
        // picking, `polygonOffset` answers the depth buffer, and neither
        // substitutes for the other.
        position={[0, PAINT_LIFT_M, 0]}
        receiveShadow
        // After every default-0 opaque, so a flat surface is drawn against a
        // depth buffer that has already been laid down.
        renderOrder={isExporting ? 0 : 1}
      />
    </group>
  )
}

/** Half the widest the paint gets, for callers that need a quick bound. */
export function routeHalfWidthM(node: RouteNode): number {
  return outerHalfWidthM(node.width, node.lineWidth)
}
