'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { getPalletGeometry } from './geometry-builder'
import { getPalletPreviewMaterial } from './materials'
import { specOf } from './presets'
import type { PalletNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * The translucent ghost that follows the cursor while placing.
 *
 * A separate component rather than a flag on the renderer. The earlier version
 * decided at render time with `node.id.includes('preview')` and then called
 * `useRegistry` inside the resulting `if`, which is a rules-of-hooks violation:
 * the moment a node crossed between preview and committed on the same component
 * instance, React would throw "rendered fewer hooks than expected". Splitting
 * the two states into two components removes the condition entirely, and it is
 * what every built-in kind does.
 */
export default function PalletPreview({ node }: { node: PalletNode }) {
  const ref = useRef<Group>(null)
  const spec = specOf(node.preset)
  const geometry = useMemo(() => getPalletGeometry(node.preset), [node.preset])
  const material = getPalletPreviewMaterial()
  const loadHeight = Math.max(0, node.loadHeight ?? 0)

  // The overlay layer keeps the ghost out of export and snapshot passes.
  // Layers do not inherit, so every object in the subtree needs it set.
  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  return (
    <group ref={ref}>
      {/* Raycast is off throughout: a ghost that intercepts the cursor ray
          stops `grid:move` firing, and the tool then commits at whatever
          position it last saw. */}
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
      {loadHeight > 0 && (
        <mesh
          material={material}
          position={[0, spec.height + loadHeight / 2, 0]}
          raycast={NO_RAYCAST}
        >
          <boxGeometry args={[spec.length - 0.02, loadHeight, spec.width - 0.02]} />
        </mesh>
      )}
    </group>
  )
}
