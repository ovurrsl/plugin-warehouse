'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { useAppearance } from '../appearance'
import {
  getToteCartFrameGeometry,
  getToteGeometry,
  releaseGeometry,
  retainGeometry,
  toteCartFrameKey,
  toteCartToteKey,
} from './geometry'
import { getToteCartPreviewMaterial } from './materials'
import { loadedTiersOf, tierYM, tiltRad } from './metrics'
import type { ToteCartNode } from './schema'

const NO_RAYCAST = () => {}

/** Yerleştirme hayaleti — ayrı bileşen (rules-of-hooks). */
export default function ToteCartPreview({ node }: { node: ToteCartNode }) {
  const ref = useRef<Group>(null)
  const material = getToteCartPreviewMaterial(useAppearance())
  const tilt = tiltRad(node)
  const count = loadedTiersOf(node)

  // Bağımlılık `count` — boş DEĞİL, ve bu bir ayrıntı değil: hayaletin alt
  // ağacı kat sayısıyla büyüyor (`[`/`]` yerleştirme sırasında değiştiriyor)
  // ve katmanlar three'de MİRAS ALINMIYOR. Bir kez koşan atama, sonradan
  // eklenen kasayı sahne katmanında bırakıyordu: hayaletin bir parçası dışa
  // aktarıma ve anlık görüntüye sızan, ötekilerden farklı davranan bir mesh.
  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [count])

  useEffect(() => {
    const keys = [
      retainGeometry(toteCartFrameKey(node, 'full')),
      retainGeometry(toteCartToteKey(node, 'full')),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node])

  return (
    <group ref={ref}>
      <mesh
        dispose={null}
        geometry={getToteCartFrameGeometry(node, 'full')}
        material={material}
        raycast={NO_RAYCAST}
      />
      {Array.from({ length: count }, (_, index) => (
        <mesh
          dispose={null}
          geometry={getToteGeometry(node, 'full')}
          key={index}
          material={material}
          position={[0, tierYM(node, index), 0]}
          raycast={NO_RAYCAST}
          rotation={[tilt, 0, 0]}
        />
      ))}
    </group>
  )
}
