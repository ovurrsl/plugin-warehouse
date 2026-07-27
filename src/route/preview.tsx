'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import * as THREE from 'three'
import type { RouteBrush } from '../store'
import { buildRouteGeometry } from './geometry'
import { RouteNode } from './schema'
import type { Point } from './stripes'

const NO_RAYCAST = () => {}

/**
 * The route as it is being drawn.
 *
 * **Built by the same function that builds the committed node**, so the paint
 * that follows the cursor is the paint that lands — mitres, arrows, divider and
 * all. The older editor drew its preview from a private third copy of its
 * offset helper, so the ghost and the node disagreed at every corner, and it
 * drafted at slab + 20 mm while committing at slab + 1 mm, so the marking
 * visibly dropped the instant you finished drawing.
 */
export default function RoutePreview({
  points,
  brush,
  surfaceY = 0,
}: {
  points: Point[]
  brush: RouteBrush
  /** The slab's own walking surface. A draft below it is a draft nobody sees. */
  surfaceY?: number
}) {
  const ref = useRef<Group>(null)

  const geometry = useMemo(() => {
    if (points.length < 2) return null
    const origin = points[0]
    if (!origin) return null
    return buildRouteGeometry(
      RouteNode.parse({
        ...brush,
        points: points.map((p) => [p[0] - origin[0], p[1] - origin[1]]),
      }),
    )
  }, [points, brush])

  // A ghost is drawn once per cursor move, so it is the one place in this
  // package where a buffer is genuinely disposable — and must be disposed, or
  // a minute of drawing leaks a few hundred of them.
  useEffect(() => () => geometry?.dispose(), [geometry])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: brush.role === 'vehicle' ? 0xf2c31d : 0x2f9e58,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [brush.role],
  )
  useEffect(() => () => material.dispose(), [material])

  // The overlay layer keeps the ghost out of export and snapshot passes. Layers
  // do not inherit, so every object in the subtree needs it set.
  useLayoutEffect(() => {
    ref.current?.traverse((object) => object.layers.set(EDITOR_LAYER))
  }, [])

  if (!geometry || !points[0]) return null

  return (
    <group position={[points[0][0], surfaceY + 0.004, points[0][1]]} ref={ref}>
      <mesh
        dispose={null}
        geometry={geometry}
        material={material}
        raycast={NO_RAYCAST}
        renderOrder={2}
      />
    </group>
  )
}
