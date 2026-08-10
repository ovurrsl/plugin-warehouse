'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { useAppearance } from '../appearance'
import { benchGeometryKey, getBenchGeometry, releaseGeometry, retainGeometry } from './geometry'
import { getBenchPreviewMaterial } from './materials'
import type { BenchNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Yerleştirme hayaleti — ayrı bileşen (rules-of-hooks).
 *
 * `retainGeometry`/`releaseGeometry` mount/unmount'ta: paletin hayaleti tam
 * bu eksiklikten çökmüştü — havuz sınırına takılan geometri hayalet hâlâ
 * ekrandayken tahliye edilebiliyordu.
 */
export default function BenchPreview({ node }: { node: BenchNode }) {
  const ref = useRef<Group>(null)
  const geometry = getBenchGeometry(node, 'full')
  const appearance = useAppearance()
  const material = getBenchPreviewMaterial(appearance)

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  useEffect(() => {
    const key = retainGeometry(benchGeometryKey(node, 'full'))
    return () => releaseGeometry(key)
  }, [node])

  return (
    <group ref={ref}>
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
    </group>
  )
}
