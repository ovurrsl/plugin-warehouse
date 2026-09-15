import { useScene } from '@pascal-app/core'
import { Text } from '@react-three/drei'
import { useEffect, useState } from 'react'
import { isFirstRackOfRow, isLastRackOfRow } from './row-naming'
import type { PalletRackNode, SignMountStyle } from './schema'
import { bayPitch, rowDepth } from './slots'

export const SIGN_BACKPLATE_WIDTH = 0.4
export const SIGN_BACKPLATE_HEIGHT = 0.25
export const SIGN_BACKPLATE_THICKNESS = 0.012
export const SIGN_STANDOFF_DISTANCE = 0.02
export const SIGN_STANDOFF_SIZE: [number, number, number] = [0.02, 0.04, 0.04]
export const SIGN_HEIGHT_OFFSET = 0.35
export const SIGN_FLUSH_CLEARANCE = 0.002
export const SIGN_TEXT_OFFSET = 0.001

/**
 * Computes 3D local position and rotation for physical aisle sign
 * relative to the pallet rack's coordinate origin.
 */
export function computeSignTransform(
  node: PalletRackNode,
  end: 'left' | 'right',
  mountStyle: SignMountStyle = node.signMountStyle ?? 'flag',
): {
  position: [number, number, number]
  rotation: [number, number, number]
} {
  const pitch = bayPitch(node)
  const depth = rowDepth(node)

  const x = end === 'left' ? -pitch / 2 : pitch / 2
  const y = node.uprightHeight - SIGN_HEIGHT_OFFSET

  if (mountStyle === 'flush') {
    // Flush mount: flat against upright front face
    const z = depth / 2 + SIGN_BACKPLATE_THICKNESS / 2 + SIGN_FLUSH_CLEARANCE
    return {
      position: [x, y, z],
      rotation: [0, 0, 0],
    }
  }

  // Flag mount: 90 deg rotation offset, protruding into aisle
  const z = depth / 2 + SIGN_BACKPLATE_WIDTH / 2 + SIGN_STANDOFF_DISTANCE
  return {
    position: [x, y, z],
    rotation: [0, Math.PI / 2, 0],
  }
}

export interface PhysicalSignProps {
  node: PalletRackNode
  end: 'left' | 'right'
  label: string
  mountStyle: SignMountStyle
}

export function PhysicalSign({ node, end, label, mountStyle }: PhysicalSignProps) {
  const { position, rotation } = computeSignTransform(node, end, mountStyle)

  return (
    <group position={position} rotation={rotation}>
      {/* Physical backplate: 40cm x 25cm x 1.2cm yellow sign plate */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.4, 0.25, 0.012]} />
        <meshStandardMaterial color="#facc15" metalness={0.1} roughness={0.4} />
      </mesh>

      {/* Standoff bracket connecting backplate to upright */}
      {mountStyle === 'flag' ? (
        <mesh position={[0.2 + 0.02 / 2, 0, 0]}>
          <boxGeometry args={[0.02, 0.04, 0.04]} />
          <meshStandardMaterial color="#374151" metalness={0.3} roughness={0.6} />
        </mesh>
      ) : (
        <mesh position={[0, 0, -0.012 / 2]}>
          <boxGeometry args={[0.02, 0.04, 0.04]} />
          <meshStandardMaterial color="#374151" metalness={0.3} roughness={0.6} />
        </mesh>
      )}

      {/* Front face text */}
      <Text
        anchorX="center"
        anchorY="middle"
        color="#1c1917"
        fontSize={0.13}
        fontWeight="bold"
        position={[0, 0, 0.012 / 2 + 0.001]}
        rotation={[0, 0, 0]}
      >
        {label}
      </Text>

      {/* Rear face text (for Flag mode so unmirrored when walking either direction) */}
      {mountStyle === 'flag' && (
        <Text
          anchorX="center"
          anchorY="middle"
          color="#1c1917"
          fontSize={0.13}
          fontWeight="bold"
          position={[0, 0, -0.012 / 2 - 0.001]}
          rotation={[0, Math.PI, 0]}
        >
          {label}
        </Text>
      )}
    </group>
  )
}

export function RowLabelRenderer({ node }: { node: PalletRackNode }) {
  const [{ isFirst, isLast }, setIsEndRack] = useState<{
    isFirst: boolean
    isLast: boolean
  }>({
    isFirst: false,
    isLast: false,
  })

  useEffect(() => {
    if (!node.rowLabel) {
      setIsEndRack({ isFirst: false, isLast: false })
      return
    }

    const nodes = (useScene.getState?.()?.nodes ?? {}) as Record<string, unknown>
    setIsEndRack({
      isFirst: isFirstRackOfRow(nodes, node.id),
      isLast: isLastRackOfRow(nodes, node.id),
    })
  }, [node.id, node.rowLabel, node.position, node.rotation])

  if (!node.rowLabel) return null
  if (!isFirst && !isLast) return null

  const mountStyle: SignMountStyle = node.signMountStyle ?? 'flag'

  return (
    <group name={`rack-signs-${node.id}`}>
      {isFirst && (
        <PhysicalSign end="left" label={node.rowLabel} mountStyle={mountStyle} node={node} />
      )}
      {isLast && (
        <PhysicalSign end="right" label={node.rowLabel} mountStyle={mountStyle} node={node} />
      )}
    </group>
  )
}
