'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { useAppearance } from '../appearance'
import { getRackPreviewMaterial } from '../rack/materials'
import {
  getDriveInGeometry,
  releaseDriveInGeometry,
  retainDriveInGeometry,
} from './geometry-builder'
import type { DriveInRackNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Placement ghost — a separate component for the rules of hooks.
 *
 * `retain`/`release` on mount and unmount: the pallet's ghost crashed on
 * exactly this omission, because a geometry that hit the pool limit could be
 * evicted while the ghost was still on screen.
 *
 * The preview material is the **rack's**, not a new one: a ghost that did not
 * look like a ghosted rack would be the first thing a user noticed about the
 * new kind, and the wrong thing.
 */
export default function DriveInPreview({ node }: { node: DriveInRackNode }) {
  const ref = useRef<Group>(null)
  // Always the near tier and always both frame lines: a ghost has no
  // neighbours yet, and a placement preview that dropped detail at distance
  // would be showing the user a different thing from what the click commits.
  const geometry = getDriveInGeometry(node, 'full')
  const appearance = useAppearance()
  const material = getRackPreviewMaterial(appearance)

  useLayoutEffect(() => {
    ref.current?.traverse((object) => object.layers.set(EDITOR_LAYER))
  }, [])

  useEffect(() => {
    // Claim it while the ghost is on screen, so eviction cannot free a buffer
    // that is being drawn.
    const key = retainDriveInGeometry(node, 'full')
    return () => releaseDriveInGeometry(key)
  }, [node])

  return (
    <group ref={ref}>
      <mesh dispose={null} geometry={geometry} material={material} raycast={NO_RAYCAST} />
    </group>
  )
}
