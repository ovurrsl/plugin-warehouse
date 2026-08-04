'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { useAppearance } from '../appearance'
import {
  getLiveRackingGeometry,
  liveRackingGeometryKey,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { getLiveRackingPreviewMaterial } from './materials'
import type { LiveRackingNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Yerleştirme hayaleti — ayrı bileşen (rules-of-hooks).
 *
 * `retainGeometry`/`releaseGeometry` mount/unmount'ta: paletin hayaleti tam
 * bu eksiklikten çökmüştü (havuz sınırına takılan geometri hayalet hâlâ
 * ekrandayken tahliye edilebiliyordu).
 */
export default function LiveRackingPreview({ node }: { node: LiveRackingNode }) {
  const ref = useRef<Group>(null)
  const geometry = getLiveRackingGeometry(node, 'full')
  const appearance = useAppearance()
  const material = getLiveRackingPreviewMaterial(appearance)

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  useEffect(() => {
    const key = retainGeometry(liveRackingGeometryKey(node, 'full'))
    return () => releaseGeometry(key)
  }, [node])

  return (
    <group ref={ref}>
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
    </group>
  )
}
