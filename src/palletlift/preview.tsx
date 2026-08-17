'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useAppearance } from '../appearance'
import {
  getPalletLiftDoorGeometry,
  getPalletLiftPlatformGeometry,
  getPalletLiftStaticGeometry,
  palletLiftDoorKey,
  palletLiftPlatformKey,
  palletLiftStaticKey,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { resolveLift } from './levels'
import { getPalletLiftEnclosureMaterial, getPalletLiftPreviewMaterial } from './materials'
import { doorFaceZ, enclosureXZ } from './metrics'
import type { PalletLiftNode } from './schema'

const NO_RAYCAST = () => {}
const ENCLOSURE_BOX = new THREE.BoxGeometry(1, 1, 1)

/**
 * Yerleştirme hayaleti — dinlenmede statik iskelet + platform + kapılar.
 *
 * Hayalet sahnede olmadığı için kotlar çözülemez: `resolveLift({}, node)` yedek
 * iki duraklı kuyuya düşer, ki bir asansörün ne kadar yer kapladığını gösteren
 * için yeterli.
 */
export default function PalletLiftPreview({ node }: { node: PalletLiftNode }) {
  const ref = useRef<THREE.Group>(null)
  const appearance = useAppearance()
  const material = getPalletLiftPreviewMaterial(appearance)
  const enclosureMaterial = getPalletLiftEnclosureMaterial(appearance)
  const resolved = useMemo(() => resolveLift({}, node), [node])
  const faceZ = doorFaceZ(node)
  const enclosure = enclosureXZ(node)

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  useEffect(() => {
    const keys = [
      retainGeometry(palletLiftStaticKey(node, 'full', resolved)),
      retainGeometry(palletLiftPlatformKey(node, 'full')),
      retainGeometry(palletLiftDoorKey(node)),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node, resolved])

  return (
    <group ref={ref}>
      <mesh
        dispose={null}
        geometry={getPalletLiftStaticGeometry(node, 'full', resolved)}
        material={material}
        raycast={NO_RAYCAST}
      />
      <group position={[0, resolved.stops[0]?.baseY ?? 0, 0]}>
        <mesh
          dispose={null}
          geometry={getPalletLiftPlatformGeometry(node, 'full')}
          material={material}
          raycast={NO_RAYCAST}
        />
      </group>
      {node.hasDoors &&
        resolved.stops.map((stop) => (
          <group key={stop.id} position={[0, stop.baseY, faceZ]}>
            <mesh
              dispose={null}
              geometry={getPalletLiftDoorGeometry(node)}
              material={material}
              raycast={NO_RAYCAST}
            />
          </group>
        ))}
      {node.hasEnclosure && (
        <mesh
          dispose={null}
          geometry={ENCLOSURE_BOX}
          material={enclosureMaterial}
          position={[0, resolved.mastHeight / 2, 0]}
          raycast={NO_RAYCAST}
          scale={[enclosure[0], resolved.mastHeight, enclosure[1]]}
        />
      )}
    </group>
  )
}
