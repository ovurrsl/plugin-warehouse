'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { useAppearance } from '../appearance'
import { getCargoGeometry, releaseCargoGeometry, retainCargoGeometry } from './cargo-geometry'
import { cargoInputOf } from './cargo-parts'
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
  const appearance = useAppearance()
  const material = getPalletPreviewMaterial(appearance)
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

  /**
   * Hayaletin tuttuğu kargo tamponunu CACHE'E BİLDİR.
   *
   * Yerleştirilmiş paletler kendi girişlerini tutuyordu, hayalet tutmuyordu:
   * altmış dört farklı kargo şekli inşa edildikten sonra tahliye adayı tam
   * da hayaletin çizdiği giriş oluyordu — ve WebGPU'da hâlâ referans edilen
   * bir tamponu dispose etmek, bütün karenin komut tamponunu düşüren sınıf.
   */
  useEffect(() => {
    const input = cargoInputOf(node, 'full')
    if (!input) return
    const key = retainCargoGeometry(input)
    return () => releaseCargoGeometry(key)
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
            material={getCargoPreviewMaterial(appearance)}
            position={[0, spec.height, 0]}
            raycast={NO_RAYCAST}
          />
          {cargo.film && (
            <mesh
              dispose={null}
              geometry={cargo.film}
              material={getCargoPreviewMaterial(appearance)}
              position={[0, spec.height, 0]}
              raycast={NO_RAYCAST}
              renderOrder={1}
            />
          )}
        </>
      )}
      {/* No block when there is no cargo: an empty pallet previews as the bare
          deck it will be placed as. */}
    </group>
  )
}
