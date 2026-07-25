import React, { useRef } from 'react'
import * as THREE from 'three'
import { useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import type { ToteCartNode } from './schema'

/**
 * 1:1 Exact Real-World Order Picking Trolley / Tote Cart 3D Geometry
 * Standards: VDA 4500 R-KLT Euro Plastic Totes (600x400x280mm), ESD Round Steel Tubing (28mm diameter),
 * 125mm Industrial Swivel Castors with Rubber Tread & Zinc-Plated Forks, Ergonomic Push Handle.
 */
export function ToteCart3DGeometry({
  width = 0.6,
  height = 1.5,
  depth = 0.4,
  frameColor = '#334155',
  toteColor = '#2563eb',
  shelfLevels = 3,
}: {
  width?: number
  height?: number
  depth?: number
  frameColor?: string
  toteColor?: string
  shelfLevels?: number
}) {
  const hw = width / 2
  const hd = depth / 2

  const tubeRadius = 0.014 // 28mm diameter round steel tube
  const castorWheelRadius = 0.0625 // 125mm diameter castor wheels

  const tierPositions = Array.from({ length: shelfLevels }).map(
    (_, i) => 0.18 + i * ((height - 0.35) / shelfLevels),
  )

  return (
    <group>
      {/* 4x 125mm Industrial Swivel Castor Wheels at Base */}
      {[-hw + 0.06, hw - 0.06].map((wx, i) =>
        [-hd + 0.06, hd - 0.06].map((wz, j) => (
          <group key={`castor-${i}-${j}`} position={[wx, castorWheelRadius, wz]}>
            {/* Rubber Wheel Tread */}
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[castorWheelRadius, castorWheelRadius, 0.032, 20]} />
              <meshStandardMaterial color="#0f172a" roughness={0.7} />
            </mesh>
            {/* Zinc-Plated Swivel Fork */}
            <mesh position={[0, 0.04, 0]} castShadow>
              <boxGeometry args={[0.04, 0.06, 0.05]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
            </mesh>
          </group>
        )),
      )}

      {/* 4x Vertical Round Tubular Uprights (28mm diameter) */}
      {[-hw + 0.02, hw - 0.02].map((cx, i) =>
        [-hd + 0.02, hd - 0.02].map((cz, j) => (
          <mesh key={`upright-${i}-${j}`} position={[cx, height / 2 + 0.06, cz]} castShadow>
            <cylinderGeometry args={[tubeRadius, tubeRadius, height - 0.05, 16]} />
            <meshStandardMaterial color={frameColor} metalness={0.75} roughness={0.25} />
          </mesh>
        )),
      )}

      {/* Ergonomic Angled Top Push Handle */}
      <group position={[hw + 0.02, height, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[tubeRadius, tubeRadius, depth, 16]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} />
        </mesh>
      </group>

      {/* Shelf Levels holding VDA 4500 R-KLT Euro Plastic Tote Bins */}
      {tierPositions.map((yPos, tIdx) => (
        <group key={`tote-tier-${tIdx}`} position={[0, yPos, 0]}>
          {/* Angle-Iron Steel Support Tray Frame */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[width - 0.02, 0.02, depth - 0.02]} />
            <meshStandardMaterial color={frameColor} metalness={0.7} roughness={0.3} />
          </mesh>

          {/* VDA 4500 R-KLT Euro Plastic Tote Bin (with top lip and side handles) */}
          <group position={[0, 0.12, 0]}>
            {/* Main Bin Body */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[width - 0.06, 0.22, depth - 0.06]} />
              <meshStandardMaterial color={toteColor} roughness={0.3} />
            </mesh>
            {/* Top Stacking Lip */}
            <mesh position={[0, 0.11, 0]}>
              <boxGeometry args={[width - 0.04, 0.02, depth - 0.04]} />
              <meshStandardMaterial color={toteColor} roughness={0.3} />
            </mesh>
            {/* Front & Back Recessed Hand Grip Cuts */}
            <mesh position={[0, 0.05, depth / 2 - 0.03]}>
              <boxGeometry args={[0.12, 0.03, 0.005]} />
              <meshStandardMaterial color="#1e293b" roughness={0.5} />
            </mesh>
            <mesh position={[0, 0.05, -depth / 2 + 0.03]}>
              <boxGeometry args={[0.12, 0.03, 0.005]} />
              <meshStandardMaterial color="#1e293b" roughness={0.5} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}

export default function ToteCartRenderer({ node }: { node: ToteCartNode }) {
  const ref = useRef<THREE.Group>(null!)
  const liveTransform = useLiveTransforms((s: any) => s.transforms?.[node.id as string])

  const rawAny = node as any
  const position = liveTransform?.position ?? rawAny.position ?? [0, 0, 0]
  const rotationY =
    liveTransform?.rotation ??
    (Array.isArray(rawAny.rotation) ? rawAny.rotation[1] ?? 0 : rawAny.rotation ?? 0)

  const isPreview = (node.id as string).includes('preview') || (node as any).isTransient

  const handlers = useNodeEvents(
    isPreview ? (null as any) : (node as any),
    'warehouse:tote-cart' as any,
  )

  if (!isPreview) {
    useRegistry(node.id as any, node.type as any, ref)
  }

  return (
    <group
      ref={ref}
      position={position}
      rotation={[0, rotationY, 0]}
      visible={node.visible !== false}
      {...handlers}
    >
      <ToteCart3DGeometry
        width={node.width}
        height={node.height}
        depth={node.depth}
        frameColor={node.frameColor}
        toteColor={node.toteColor}
        shelfLevels={node.shelfLevels}
      />
    </group>
  )
}
