'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import {
  getMezzanineGeometry,
  mezzanineGeometryKey,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { getMezzaninePreviewMaterial } from './materials'
import type { MezzanineNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Yerleştirme hayaleti — ayrı bileşen (rules-of-hooks, pallet'in deseni).
 *
 * `retainGeometry`/`releaseGeometry` mount/unmount'ta: bu paketin ghost'suz
 * versiyonu (`pallet/preview.tsx`'in Faz eski hâli) tam bu eksiklikten
 * çökmüştü — havuz sınırına takılan bir geometri hayalet hâlâ ekrandayken
 * tahliye edilebiliyordu. Burada baştan doğru.
 */
export default function MezzaninePreview({ node }: { node: MezzanineNode }) {
  const ref = useRef<Group>(null)
  const geometry = getMezzanineGeometry(node)
  const material = getMezzaninePreviewMaterial()

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  useEffect(() => {
    const key = retainGeometry(mezzanineGeometryKey(node))
    return () => releaseGeometry(key)
  }, [node])

  return (
    <group ref={ref}>
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
    </group>
  )
}
