'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { getRackPreviewMaterial } from '../rack/materials'
import { getM3Geometry, releaseM3Geometry, retainM3Geometry } from './geometry-builder'
import type { M3ShelvingNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Placement ghost — a separate component for the rules of hooks.
 *
 * `retain` on mount, `release` on unmount, and in that order: the pallet's
 * ghost crashed on exactly this omission, because a geometry that hit the pool
 * limit could be evicted while the ghost was still on screen. The drive-in
 * ghost then shipped the same two lines the wrong way round — `release` on
 * mount — which drives the counter negative instead.
 */
export default function M3Preview({ node }: { node: M3ShelvingNode }) {
  const ref = useRef<Group>(null)
  // Always the near tier and both frames: a ghost has no neighbours yet, and a
  // preview that dropped detail at distance would show a different thing from
  // what the click commits.
  const geometry = getM3Geometry(node, 'full')
  const material = getRackPreviewMaterial()

  useLayoutEffect(() => {
    ref.current?.traverse((object) => object.layers.set(EDITOR_LAYER))
  }, [])

  useEffect(() => {
    const key = retainM3Geometry(node, 'full')
    return () => releaseM3Geometry(key)
  }, [node])

  return (
    <group ref={ref}>
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
    </group>
  )
}
