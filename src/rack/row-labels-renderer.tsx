import { useScene } from '@pascal-app/core'
import React, { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import {
  LEVEL_COLOR_PALETTE,
  LEVEL_LETTERS,
  getLevelColor,
  getLevelLetter,
} from './beam-label-atlas'
export {
  LEVEL_COLOR_PALETTE,
  LEVEL_LETTERS,
  getLevelColor,
  getLevelLetter,
}
export {
  BeamLipBarcodeLabels,
  BeamLipLabelMesh,
} from './beam-labels-renderer'
import { isFirstRackOfRow, isLastRackOfRow } from './row-naming'
import type { PalletRackNode, SignMountStyle } from './schema'
import {
  bayPitch,
  levelBeamHeight,
  levelSurfaceY,
  rowDepth,
  storageLevelsPresent,
} from './slots'

export const SIGN_BACKPLATE_WIDTH = 0.8
export const SIGN_BACKPLATE_HEIGHT = 0.35
export const SIGN_BACKPLATE_THICKNESS = 0.016
export const SIGN_STANDOFF_DISTANCE = 0.05
export const SIGN_STANDOFF_SIZE: [number, number, number] = [0.05, 0.08, 0.05]
export const SIGN_HEIGHT_OFFSET = 0.45
export const SIGN_FLUSH_CLEARANCE = 0.002
export const SIGN_TEXT_OFFSET = 0.001

export const GROUND_STENCIL_WIDTH = 0.50
export const GROUND_STENCIL_HEIGHT = 0.35
export const GROUND_STENCIL_Y_OFFSET = 0.002

export const BADGE_WIDTH = 0.06
export const BADGE_HEIGHT = 0.04
export const BADGE_THICKNESS = 0.006

/**
 * Resolves the text string to display on the physical aisle sign.
 * Supports aisle pairs (e.g. "A B", "C D"), front/rear aisle labels, or explicit rowLabel.
 */
export function resolveAisleSignLabel(node: PalletRackNode): string {
  const front = (node.frontAisleLabel ?? '').trim()
  const rear = (node.rearAisleLabel ?? '').trim()
  if (front && rear) {
    return `${front} ${rear}`
  }
  const directLabel = (node.rowLabel ?? '').trim()
  if (directLabel.length > 0) {
    return directLabel
  }
  if (front) return front
  if (rear) return rear
  return ''
}

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

/**
 * 3D Aisle Upright Signs Renderer.
 * Strictly non-reactive: zero subscriptions to useScene.
 */
export function RowLabelRenderer({ node }: { node: PalletRackNode }) {
  const [{ isFirst, isLast }, setIsEndRack] = useState<{
    isFirst: boolean
    isLast: boolean
  }>({
    isFirst: false,
    isLast: false,
  })

  useEffect(() => {
    const signLabel = resolveAisleSignLabel(node)
    if (!signLabel) {
      setIsEndRack({ isFirst: false, isLast: false })
      return
    }

    const nodes = (useScene.getState?.()?.nodes ?? {}) as Record<string, unknown>
    setIsEndRack({
      isFirst: isFirstRackOfRow(nodes, node.id),
      isLast: isLastRackOfRow(nodes, node.id),
    })
  }, [
    node.id,
    node.rowLabel,
    node.frontAisleLabel,
    node.rearAisleLabel,
    node.position,
    node.rotation,
  ])

  const signLabel = resolveAisleSignLabel(node)
  if (!signLabel) return null
  if (!isFirst && !isLast) return null

  const mountStyle: SignMountStyle = node.signMountStyle ?? 'flag'

  return (
    <group name={`rack-signs-${node.id}`}>
      {isFirst && (
        <PhysicalSign end="left" label={signLabel} mountStyle={mountStyle} node={node} />
      )}
      {isLast && (
        <PhysicalSign end="right" label={signLabel} mountStyle={mountStyle} node={node} />
      )}
    </group>
  )
}

// ── 3D Ground Bay Stencils (Feature 7) ──────────────────────────────────────────

const stencilTextureCache = new Map<string, THREE.CanvasTexture>()

function useStencilTexture(bayText: string): THREE.Texture | null {
  const texture = useMemo(() => {
    if (stencilTextureCache.has(bayText)) {
      return stencilTextureCache.get(bayText)!
    }
    if (typeof document === 'undefined') return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 384
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      // Dark background with industrial border
      ctx.fillStyle = '#18181b'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.lineWidth = 16
      ctx.strokeStyle = '#facc15'
      ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)

      // Stencil numerals
      ctx.fillStyle = '#facc15'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '900 240px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      ctx.fillText(bayText, canvas.width / 2, canvas.height / 2)

      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.needsUpdate = true
      stencilTextureCache.set(bayText, tex)
      return tex
    } catch {
      return null
    }
  }, [bayText])

  return texture
}

export function GroundBayStencil({ node }: { node: PalletRackNode }) {
  const bayText = String(node.bayIndex ?? 1).padStart(2, '0')
  const texture = useStencilTexture(bayText)
  const depth = rowDepth(node)
  const zOffset = depth / 2 + 0.35
  const isDual = node.accessMode === 'dual-facing'

  return (
    <group name={`ground-stencil-${node.id}`}>
      {/* Front aisle floor stencil */}
      <mesh
        position={[0, GROUND_STENCIL_Y_OFFSET, zOffset]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[GROUND_STENCIL_WIDTH, GROUND_STENCIL_HEIGHT]} />
        <meshStandardMaterial
          map={texture}
          color={texture ? '#ffffff' : '#facc15'}
          transparent={true}
          opacity={0.92}
          roughness={0.8}
          metalness={0.1}
          depthWrite={false}
          polygonOffset={true}
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      {/* Rear aisle floor stencil for dual-facing bays */}
      {isDual && (
        <mesh
          position={[0, GROUND_STENCIL_Y_OFFSET, -zOffset]}
          rotation={[-Math.PI / 2, 0, Math.PI]}
        >
          <planeGeometry args={[GROUND_STENCIL_WIDTH, GROUND_STENCIL_HEIGHT]} />
          <meshStandardMaterial
            map={texture}
            color={texture ? '#ffffff' : '#facc15'}
            transparent={true}
            opacity={0.92}
            roughness={0.8}
            metalness={0.1}
            depthWrite={false}
            polygonOffset={true}
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}
    </group>
  )
}

// ── 3D Upright Level Color Badges (Feature 8) ──────────────────────────────────

export function UprightLevelColorBadges({ node }: { node: PalletRackNode }) {
  const [isLast, setIsLast] = useState(false)

  useEffect(() => {
    const nodes = (useScene.getState?.()?.nodes ?? {}) as Record<string, unknown>
    setIsLast(isLastRackOfRow(nodes, node.id))
  }, [node.id, node.position, node.rotation])

  const pitch = bayPitch(node)
  const depth = rowDepth(node)
  const xLeft = -pitch / 2
  const xRight = pitch / 2
  const zFront = depth / 2 + 0.003

  const levels = useMemo(() => storageLevelsPresent(node), [node])

  return (
    <group name={`level-badges-${node.id}`}>
      {levels.map((lvl) => {
        const letter = getLevelLetter(lvl)
        const color = LEVEL_COLOR_PALETTE[letter] ?? '#ea580c'
        const beamH = levelBeamHeight(node, lvl)
        const y = lvl === 0 ? 0.15 : levelSurfaceY(node, lvl) - beamH / 2

        return (
          <React.Fragment key={`level-badge-${lvl}`}>
            {/* Left upright post badge */}
            <mesh position={[xLeft, y, zFront]}>
              <boxGeometry args={[BADGE_WIDTH, BADGE_HEIGHT, BADGE_THICKNESS]} />
              <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
            </mesh>

            {/* Right upright post badge on the end of row */}
            {isLast && (
              <mesh position={[xRight, y, zFront]}>
                <boxGeometry args={[BADGE_WIDTH, BADGE_HEIGHT, BADGE_THICKNESS]} />
                <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
              </mesh>
            )}
          </React.Fragment>
        )
      })}
    </group>
  )
}
