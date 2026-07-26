'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { getConveyorPreviewMaterial } from './materials'
import { getTransferGeometry } from './transfer-geometry'
import type { ConveyorTransferNode } from './transfer-schema'

const NO_RAYCAST = () => {}

/**
 * The translucent ghost that follows the cursor while placing.
 *
 * A separate component rather than a flag on the renderer, the same split the
 * rack, the pallet and the straight use: deciding at render time and then
 * calling `useRegistry` inside the resulting branch is a rules-of-hooks
 * violation, and it throws the moment a node crosses between preview and
 * committed on one component instance.
 *
 * Always built at full detail. The ghost is by definition right under the
 * cursor, so the far tier would never apply and asking for it would only add a
 * second cache entry for a shape that already has one.
 */
export default function ConveyorTransferPreview({ node }: { node: ConveyorTransferNode }) {
  const ref = useRef<Group>(null)
  const geometry = useMemo(() => getTransferGeometry(node, 'full'), [node])
  const material = getConveyorPreviewMaterial()

  // The overlay layer keeps the ghost out of export and snapshot passes.
  // Layers do not inherit, so every object in the subtree needs it set.
  useLayoutEffect(() => {
    ref.current?.traverse((object) => object.layers.set(EDITOR_LAYER))
  }, [])

  return (
    <group ref={ref}>
      {/* Raycast off: a ghost that intercepts the cursor ray stops `grid:move`
          firing, and the tool then commits wherever it last saw the cursor. */}
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
    </group>
  )
}
