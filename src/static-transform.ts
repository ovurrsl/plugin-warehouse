'use client'

import { useLayoutEffect } from 'react'
import type { Object3D } from 'three'

/**
 * Recomposes a registered object's local matrix, and freezes it there.
 *
 * Exported separately from the hook below so a test can drive it with a bare
 * `{ matrixAutoUpdate, position, rotation, updateMatrix }` stand-in instead of
 * mounting a real scene.
 */
export function applyStaticTransform(
  object: Pick<Object3D, 'position' | 'rotation' | 'matrixAutoUpdate' | 'updateMatrix'>,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  isLive: boolean,
): void {
  if (isLive) {
    // A drag or gizmo is writing this exact object every tick — through
    // `useLiveTransforms`/`useLiveNodeOverrides` state, or (per the registry's
    // imperative-drag convention) straight into its `position`/`rotation` — so
    // three's own per-frame recompute has to stay on for it to move at all.
    object.matrixAutoUpdate = true
    return
  }
  object.position.set(position[0], position[1], position[2])
  object.rotation.set(rotation[0], rotation[1], rotation[2])
  object.matrixAutoUpdate = false
  object.updateMatrix()
}

/**
 * Takes a registered group out of three's per-frame matrix recompute while it
 * is not being dragged, and recomposes it once, by hand, whenever the values
 * it would have recomputed actually change.
 *
 * A CPU profile of the 5,218-node Güzeller scene put 24.5% of *idle* frame
 * time — camera not moving, nothing selected — inside `compose()` and
 * `multiplyMatrices()`. That is three's own render loop recomputing the local
 * matrix of every registered group on every frame, whether or not it moved,
 * because `matrixAutoUpdate` defaults to `true` and nothing in this package
 * ever turned it off. Almost none of those thousands of racks and pallets are
 * moving at any given moment, so almost all of that cost was for nothing.
 *
 * `isLive` is what keeps this safe rather than merely fast: it must be `true`
 * for exactly as long as something is writing this node's position or
 * rotation on every tick (a live drag, a rotate/resize gizmo), and this hook
 * hands `matrixAutoUpdate` straight back to three for that window. Getting
 * that flag wrong the other way — static while something is actually
 * animating it — is what would freeze a node mid-drag; this hook does not
 * guess it, the caller must pass it through from the same live-state read
 * that drives the JSX `position`/`rotation` props.
 */
export function useStaticTransform(
  ref: { current: Object3D | null },
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  isLive: boolean,
): void {
  useLayoutEffect(() => {
    const object = ref.current
    if (!object) return
    applyStaticTransform(object, position, rotation, isLive)
  }, [ref, isLive, position[0], position[1], position[2], rotation[0], rotation[1], rotation[2]])
}
