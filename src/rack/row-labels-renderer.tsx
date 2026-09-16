import { useScene } from '@pascal-app/core'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { isFirstRackOfRow, isLastRackOfRow } from './row-naming'
import type { PalletRackNode, SignMountStyle } from './schema'
import { bayPitch, rowDepth } from './slots'

export const SIGN_BACKPLATE_WIDTH = 0.8
export const SIGN_BACKPLATE_HEIGHT = 0.35
export const SIGN_BACKPLATE_THICKNESS = 0.016
export const SIGN_STANDOFF_DISTANCE = 0.05
export const SIGN_STANDOFF_SIZE: [number, number, number] = [0.05, 0.08, 0.05]
export const SIGN_HEIGHT_OFFSET = 0.45
export const SIGN_FLUSH_CLEARANCE = 0.002
export const SIGN_TEXT_OFFSET = 0.001

/**
 * Span length for sign mounted between the front and rear upright posts.
 */
export function signSpanLength(node: PalletRackNode): number {
  const depth = rowDepth(node)
  const span = depth - node.uprightDepth
  return Math.max(0.4, Math.min(span, 1.2))
}

/**
 * Computes 3D local position and rotation for physical aisle sign
 * positioned directly between the two upright columns of the end frame.
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
  const y = Math.max(1.5, node.uprightHeight - SIGN_HEIGHT_OFFSET)

  // Outer face of the end upright frame
  const xOuter =
    end === 'left'
      ? -pitch / 2 - node.uprightWidth / 2
      : pitch / 2 + node.uprightWidth / 2

  const xOffset =
    mountStyle === 'flag'
      ? SIGN_STANDOFF_DISTANCE + SIGN_BACKPLATE_THICKNESS / 2
      : SIGN_FLUSH_CLEARANCE + SIGN_BACKPLATE_THICKNESS / 2

  const x = end === 'left' ? xOuter - xOffset : xOuter + xOffset
  // Exactly centered between the front upright post (+Z) and rear upright post (-Z)
  const z = 0

  return {
    position: [x, y, z],
    rotation: [0, 0, 0],
  }
}

/**
 * High-performance 2D Canvas texture generator.
 * Eliminates WebGPU shader incompatibilities, troika-three-text crashes,
 * and font-network timeouts.
 */
function useSignTexture(label: string): THREE.CanvasTexture | null {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 512
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      // 1. Warehouse Safety Yellow Background
      ctx.fillStyle = '#facc15'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // 2. Heavy industrial black outer border
      ctx.lineWidth = 28
      ctx.strokeStyle = '#18181b'
      ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28)

      // 3. Inner subtle contrast border
      ctx.lineWidth = 6
      ctx.strokeStyle = '#ca8a04'
      ctx.strokeRect(38, 38, canvas.width - 76, canvas.height - 76)

      // 4. Corner mounting bolt visual details
      const boltRadius = 14
      const boltOffset = 55
      const corners: [number, number][] = [
        [boltOffset, boltOffset],
        [canvas.width - boltOffset, boltOffset],
        [boltOffset, canvas.height - boltOffset],
        [canvas.width - boltOffset, canvas.height - boltOffset],
      ]
      ctx.fillStyle = '#27272a'
      for (const [bx, by] of corners) {
        ctx.beginPath()
        ctx.arc(bx, by, boltRadius, 0, Math.PI * 2)
        ctx.fill()
      }

      // 5. Crisp, bold, high-contrast black text
      ctx.fillStyle = '#09090b'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const text = (label || '').trim()
      let fontSize = 240
      if (text.length > 3) fontSize = 180
      if (text.length > 6) fontSize = 130
      if (text.length > 10) fontSize = 90

      ctx.font = `900 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      ctx.fillText(text, canvas.width / 2, canvas.height / 2)

      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.needsUpdate = true
      return tex
    } catch {
      return null
    }
  }, [label])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  return texture
}

export interface PhysicalSignProps {
  node: PalletRackNode
  end: 'left' | 'right'
  label: string
  mountStyle: SignMountStyle
}

export function PhysicalSign({ node, end, label, mountStyle }: PhysicalSignProps) {
  const { position, rotation } = computeSignTransform(node, end, mountStyle)
  const signLength = signSpanLength(node)
  const texture = useSignTexture(label)

  const postSpanZ = rowDepth(node) / 2 - node.uprightDepth / 2
  const bracketLengthX =
    mountStyle === 'flag' ? SIGN_STANDOFF_DISTANCE + 0.02 : 0.02
  const bracketOffsetX =
    end === 'left'
      ? (mountStyle === 'flag'
          ? (SIGN_STANDOFF_DISTANCE + SIGN_BACKPLATE_THICKNESS) / 2
          : SIGN_BACKPLATE_THICKNESS / 2)
      : -(mountStyle === 'flag'
          ? (SIGN_STANDOFF_DISTANCE + SIGN_BACKPLATE_THICKNESS) / 2
          : SIGN_BACKPLATE_THICKNESS / 2)

  return (
    <group position={position} rotation={rotation}>
      {/* Physical backplate: yellow steel sign plate spanning between uprights */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[SIGN_BACKPLATE_THICKNESS, SIGN_BACKPLATE_HEIGHT, signLength]} />
        <meshStandardMaterial color="#facc15" metalness={0.15} roughness={0.35} />
      </mesh>

      {/* Front mounting bracket connecting to front upright post */}
      <mesh position={[bracketOffsetX, 0, postSpanZ]} castShadow receiveShadow>
        <boxGeometry args={[bracketLengthX, 0.08, 0.05]} />
        <meshStandardMaterial color="#27272a" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Rear mounting bracket connecting to rear upright post */}
      <mesh position={[bracketOffsetX, 0, -postSpanZ]} castShadow receiveShadow>
        <boxGeometry args={[bracketLengthX, 0.08, 0.05]} />
        <meshStandardMaterial color="#27272a" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Textured face: Outer face facing aisle */}
      {texture && (
        <mesh
          position={[
            end === 'left'
              ? -SIGN_BACKPLATE_THICKNESS / 2 - 0.001
              : SIGN_BACKPLATE_THICKNESS / 2 + 0.001,
            0,
            0,
          ]}
          rotation={[0, end === 'left' ? -Math.PI / 2 : Math.PI / 2, 0]}
        >
          <planeGeometry args={[signLength, SIGN_BACKPLATE_HEIGHT]} />
          <meshStandardMaterial map={texture} roughness={0.3} metalness={0.1} />
        </mesh>
      )}

      {/* Textured face: Inner face facing bay (double-sided unmirrored visibility) */}
      {texture && (
        <mesh
          position={[
            end === 'left'
              ? SIGN_BACKPLATE_THICKNESS / 2 + 0.001
              : -SIGN_BACKPLATE_THICKNESS / 2 - 0.001,
            0,
            0,
          ]}
          rotation={[0, end === 'left' ? Math.PI / 2 : -Math.PI / 2, 0]}
        >
          <planeGeometry args={[signLength, SIGN_BACKPLATE_HEIGHT]} />
          <meshStandardMaterial map={texture} roughness={0.3} metalness={0.1} />
        </mesh>
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
