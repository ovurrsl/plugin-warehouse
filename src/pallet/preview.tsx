'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { getCargoGeometry } from './cargo-geometry'
import { cargoInputOf } from './cargo-parts'
import { loadHeightOf } from './cargo-types'
import { getFilmGeometry } from './film'
import { getPalletGeometry } from './geometry-builder'
import { getCargoPreviewMaterial, getPalletPreviewMaterial } from './materials'
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
  /**
   * The same height source the renderer and the clash test use, so a ghost can
   * never promise one height and commit another.
   */
  const loadHeight = loadHeightOf(node)

  /**
   * The real load, at the real fill — **safe only because the tool now hands
   * this node's id to the pallet it creates.**
   *
   * A load's fill is a pure function of its node's id. While the commit minted
   * an id of its own, drawing modelled cargo here would have shown the user one
   * load and placed another; the plain block was the honest thing to draw. With
   * the id carried through, the ghost is the pallet.
   */
  const cargo = useMemo(() => {
    const input = cargoInputOf(node, 'full')
    if (!input) return null
    return { geometry: getCargoGeometry(input), film: node.wrapped ? getFilmGeometry(input) : null }
  }, [node])

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
      {cargo && (
        <>
          <mesh
            dispose={null}
            geometry={cargo.geometry}
            material={getCargoPreviewMaterial()}
            position={[0, spec.height, 0]}
            raycast={NO_RAYCAST}
          />
          {cargo.film && (
            <mesh
              dispose={null}
              geometry={cargo.film}
              material={getCargoPreviewMaterial()}
              position={[0, spec.height, 0]}
              raycast={NO_RAYCAST}
              renderOrder={1}
            />
          )}
        </>
      )}
      {!cargo && loadHeight > 0 && (
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
