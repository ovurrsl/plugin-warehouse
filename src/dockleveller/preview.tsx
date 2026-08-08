'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { useAppearance } from '../appearance'
import { PLATFORM_PLATE_M } from './catalog'
import {
  dockLevellerDeckKey,
  dockLevellerFrameKey,
  dockLevellerLipKey,
  getDockLevellerDeckGeometry,
  getDockLevellerFrameGeometry,
  getDockLevellerLipGeometry,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { getDockLevellerPreviewMaterial } from './materials'
import {
  deckAngleRad,
  hingedLipAngleRad,
  lipFullLengthM,
  lipReachM,
  platformLengthM,
} from './metrics'
import type { DockLevellerNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Yerleştirme hayaleti — üç gövde, renderer'ın aynı dönüşümleriyle.
 *
 * Dönüşümler burada JSX prop'u, `useStaticTransform` DEĞİL: hayalet her fare
 * hareketinde yeniden çiziliyor ve donmuş matris kazanacak bir şeyi yok;
 * kazanacağı tek şey, bir kez basılmayı unutunca hayaletin birim küpe
 * çökmesi olurdu.
 */
export default function DockLevellerPreview({ node }: { node: DockLevellerNode }) {
  const ref = useRef<Group>(null)
  const material = getDockLevellerPreviewMaterial(useAppearance())
  const length = platformLengthM(node)
  const telescopic = node.lip === 'telescopic'
  const hidden = lipFullLengthM(node) - lipReachM(node)

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  useEffect(() => {
    const keys = [
      retainGeometry(dockLevellerFrameKey(node, 'full')),
      retainGeometry(dockLevellerDeckKey(node, 'full')),
      retainGeometry(dockLevellerLipKey(node, 'full')),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node])

  return (
    <group ref={ref}>
      <mesh
        dispose={null}
        geometry={getDockLevellerFrameGeometry(node, 'full')}
        material={material}
        raycast={NO_RAYCAST}
      />
      <group position={[-length / 2, 0, 0]} rotation={[0, 0, deckAngleRad(node)]}>
        <mesh
          dispose={null}
          geometry={getDockLevellerDeckGeometry(node, 'full')}
          material={material}
          raycast={NO_RAYCAST}
        />
        <group
          position={telescopic ? [length - hidden, -PLATFORM_PLATE_M, 0] : [length, 0, 0]}
          rotation={[0, 0, telescopic ? 0 : hingedLipAngleRad(node)]}
        >
          <mesh
            dispose={null}
            geometry={getDockLevellerLipGeometry(node, 'full')}
            material={material}
            raycast={NO_RAYCAST}
          />
        </group>
      </group>
    </group>
  )
}
