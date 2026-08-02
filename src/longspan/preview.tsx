'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { getRackPreviewMaterial } from '../rack/materials'
import {
  getLongspanGeometry,
  releaseLongspanGeometry,
  retainLongspanGeometry,
} from './geometry-builder'
import type { LongspanNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Placement ghost — a separate component for the rules of hooks.
 *
 * `retain` on mount, `release` on unmount: the pallet's ghost crashed on
 * exactly this omission, because a geometry that hit the pool limit could be
 * evicted while the ghost was still on screen.
 */
export default function LongspanPreview({ node }: { node: LongspanNode }) {
  const ref = useRef<Group>(null)
  // Always the near tier and both frames: a ghost has no neighbours yet, and a
  // preview that dropped detail at distance would show a different thing from
  // what the click commits.
  const geometry = getLongspanGeometry(node, 'full')
  const material = getRackPreviewMaterial()

  useLayoutEffect(() => {
    ref.current?.traverse((object) => object.layers.set(EDITOR_LAYER))
  }, [])

  useEffect(() => {
    const key = retainLongspanGeometry(node, 'full')
    return () => releaseLongspanGeometry(key)
  }, [node])

  return (
    <group ref={ref}>
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
    </group>
  )
}
