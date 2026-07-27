'use client'

import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { getRouteGeometry, releaseRouteGeometry, retainRouteGeometry } from './geometry'
import { getRouteMaterials } from './materials'
import type { RouteNode } from './schema'
import { outerHalfWidthM } from './stripes'

/**
 * Painted floor markings.
 *
 * A plain mesh, and deliberately unremarkable: the interesting decisions are in
 * the geometry (two stripes, no fill) and the material (`polygonOffset` rather
 * than a lift). What is left here is mounting them correctly.
 *
 * **The mesh's height is the host's to decide.** Every vertex is emitted at
 * local y = 0 and the group carries the node's own position, so the floor-placed
 * lift puts the paint on whichever slab it was elected onto. A renderer that
 * added its own rise would fight that and float the marking above a mezzanine.
 */
export default function RouteRenderer({ node }: { node: RouteNode }) {
  const handlers = useNodeEvents(node as never, node.type as never)
  const isExporting = useViewer((s) => s.isExporting ?? false)

  const geometry = useMemo(() => getRouteGeometry(node), [node])
  const materials = getRouteMaterials(node.role)

  // Claim the buffer while it is on screen. Eviction must never free a shape
  // something is drawing, and this is the only place that knows.
  useEffect(() => {
    const key = retainRouteGeometry(node)
    return () => releaseRouteGeometry(key)
  }, [node])

  return (
    <group
      position={node.position}
      rotation={node.rotation}
      visible={node.visible !== false}
      {...handlers}
    >
      <mesh
        /**
         * Paint casts nothing and receives everything.
         *
         * `receiveShadow` is not optional here: the slab under it receives, so
         * a marking that did not would glow in every shadowed aisle — brighter
         * than the floor it is painted on, which reads as an error long before
         * anyone works out why.
         */
        castShadow={false}
        dispose={null}
        geometry={geometry}
        material={materials}
        receiveShadow
        // After every default-0 opaque, so a discard-free flat surface is drawn
        // against a depth buffer that has already been laid down.
        renderOrder={isExporting ? 0 : 1}
      />
    </group>
  )
}

/** Half the widest the paint gets, for callers that need a quick bound. */
export function routeHalfWidthM(node: RouteNode): number {
  return outerHalfWidthM(node.width, node.lineWidth)
}
