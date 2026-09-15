
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RowLabelHud } from './row-labels-hud'
import type { PalletRackNode } from './schema'
import { getContiguousRackRow } from './row-naming'
import { useScene } from '@pascal-app/core'

export function RowLabelRenderer({ node }: { node: PalletRackNode }) {
  const hudRef = useRef<RowLabelHud | null>(null)
  const vec = useRef(new THREE.Vector3())
  const [isEndRack, setIsEndRack] = useState(false)

  // Sadece ilk ve son rafta göstermek için kontrol:
  useEffect(() => {
    if (!node.rowLabel) return
    const nodes = useScene.getState().nodes
    const row = getContiguousRackRow(nodes, node.id)
    if (row[0] === node.id || row[row.length - 1] === node.id) {
      setIsEndRack(true)
    } else {
      setIsEndRack(false)
    }
  }, [node.rowLabel, node.position, node.rotation])

  useEffect(() => {
    if (isEndRack && node.rowLabel) {
      hudRef.current = new RowLabelHud()
    }
    return () => {
      hudRef.current?.destroy()
      hudRef.current = null
    }
  }, [isEndRack, node.rowLabel])

  useFrame(({ camera, size }) => {
    if (!hudRef.current || !node.rowLabel || !isEndRack) return

    // Position label slightly above the rack's total height
    const height = node.uprightHeight + 0.5
    vec.current.set(node.position[0], node.position[1] + height, node.position[2])
    
    // Project to 2D
    vec.current.project(camera)

    // Convert from normalized device coordinates to screen pixels
    const x = (vec.current.x * 0.5 + 0.5) * size.width
    const y = (-(vec.current.y * 0.5) + 0.5) * size.height

    // If it's behind the camera, hide it
    const visible = vec.current.z < 1

    hudRef.current.update(node.rowLabel, x, y, visible)
  })

  return null
}

