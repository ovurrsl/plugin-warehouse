'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { useAppearance } from '../appearance'
import { getTruckGeometry } from './geometry'
import { mastPose } from './kinematics'
import { getTruckPreviewMaterial } from './materials'
import { mastRowOf, modelOf } from './metrics'
import { bodiesOf } from './parts'
import type { TruckNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Yerleştirme hayaleti — ayrı bileşen, renderer'da bayrak değil (pallet'in
 * rules-of-hooks dersinin aynısı). Raycast kapalı: hayalet imleç ışınını
 * keserse `grid:move` durur ve araç son görülen yere yerleşir.
 */
export default function TruckPreview({ node }: { node: TruckNode }) {
  const ref = useRef<Group>(null)
  const model = modelOf(node.model)
  const mastRow = mastRowOf(node.mastRowId)
  const pose = mastPose(mastRow, node.forkHeight)
  const appearance = useAppearance()
  const material = getTruckPreviewMaterial(appearance)

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => obj.layers.set(EDITOR_LAYER))
  }, [])

  return (
    <group ref={ref}>
      {bodiesOf(model).map((body) => {
        const offsetY =
          body === 'stage1' ? pose.stage1Y : body === 'carriage' ? pose.stage1Y + pose.carriageY : 0
        return (
          <mesh
            dispose={null}
            geometry={getTruckGeometry(node.model, node.mastRowId, body, 'full')}
            key={body}
            material={material}
            position={[0, offsetY, 0]}
            raycast={NO_RAYCAST}
          />
        )
      })}
    </group>
  )
}
