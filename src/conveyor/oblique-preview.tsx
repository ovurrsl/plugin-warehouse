'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { useAppearance } from '../appearance'
import { releaseGeometry } from './geometry-builder'
import { getConveyorPreviewMaterial } from './materials'
import { getObliqueGeometry, retainObliqueGeometry } from './oblique-geometry'
import type { ConveyorObliqueNode } from './oblique-schema'

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
export default function ConveyorObliquePreview({ node }: { node: ConveyorObliqueNode }) {
  const ref = useRef<Group>(null)
  const geometry = useMemo(() => getObliqueGeometry(node, 'full'), [node])
  const appearance = useAppearance()
  const material = getConveyorPreviewMaterial(appearance)

  // The overlay layer keeps the ghost out of export and snapshot passes.
  // Layers do not inherit, so every object in the subtree needs it set.
  useLayoutEffect(() => {
    ref.current?.traverse((object) => object.layers.set(EDITOR_LAYER))
  }, [])

  /**
   * Hayalet de ekranda sayılır: bu bileşen şeklini PAYLAŞILAN havuzdan
   * çekiyor. Tutmazsa, aynı şekli çizen yerleştirilmiş bir modül silinince
   * sayaç sıfıra düşüyor ve süpürme buffer'ı ekrandayken serbest bırakıyor —
   * `position` bağlanamayan bir çizim o karenin TÜM command buffer'ını
   * düşürür, yani ekran kararır.
   */
  useEffect(() => {
    const key = retainObliqueGeometry(node, 'full', false)
    return () => releaseGeometry(key)
  }, [node])

  return (
    <group ref={ref}>
      {/* Raycast off: a ghost that intercepts the cursor ray stops `grid:move`
          firing, and the tool then commits wherever it last saw the cursor. */}
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
    </group>
  )
}
