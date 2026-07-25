import React, { useRef } from 'react'
import * as THREE from 'three'
import { useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import type { ConveyorNode } from './schema'

/**
 * 1:1 Exact Real-World Industrial Flat Wire Mesh Conveyor 3D Geometry
 * Standards: Heavy Duty C-Channel Steel Frame (100x40x6mm), Wire Mesh Belt Pitch (1/2"x1"),
 * Round Stainless Steel Side Guide Rails (25mm), End Motor & Gearbox Drive Unit.
 */
export function Conveyor3DGeometry({
  width = 3.0,
  height = 0.6,
  depth = 0.8,
  frameColor = '#64748b',
  beltColor = '#94a3b8',
  hasSideRails = true,
}: {
  width?: number
  height?: number
  depth?: number
  frameColor?: string
  beltColor?: string
  hasSideRails?: boolean
}) {
  const hw = width / 2
  const hd = depth / 2

  // Leg spacing: every 1.5m along conveyor length
  const legCount = Math.max(2, Math.floor(width / 1.5) + 1)
  const legXs = Array.from({ length: legCount }).map(
    (_, i) => -hw + 0.15 + i * ((width - 0.3) / (legCount - 1)),
  )

  return (
    <group>
      {/* 1:1 Wire Mesh Conveyor Belt Surface (Wireframe mesh weave) */}
      <mesh position={[0, height, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.04, depth - 0.08]} />
        <meshStandardMaterial color={beltColor} metalness={0.85} roughness={0.25} wireframe />
      </mesh>

      {/* Side C-Channel Steel Frame (100mm height x 40mm depth) */}
      <mesh position={[0, height, hd - 0.02]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.1, 0.04]} />
        <meshStandardMaterial color={frameColor} metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, height, -hd + 0.02]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.1, 0.04]} />
        <meshStandardMaterial color={frameColor} metalness={0.7} roughness={0.3} />
      </mesh>

      {/* End Drive Motor & Gearbox Reducer Unit */}
      <group position={[hw - 0.15, height - 0.12, hd + 0.08]}>
        {/* Electric Motor Cylinder */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.09, 0.09, 0.22, 16]} />
          <meshStandardMaterial color="#1e40af" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Worm Gearbox Block */}
        <mesh position={[-0.12, 0, 0]} castShadow>
          <boxGeometry args={[0.12, 0.16, 0.14]} />
          <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>

      {/* Round Stainless Steel Side Guide Rails (25mm diameter) */}
      {hasSideRails && (
        <group>
          {/* Front Rail */}
          <mesh position={[0, height + 0.12, hd - 0.02]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.0125, 0.0125, width, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* Back Rail */}
          <mesh position={[0, height + 0.12, -hd + 0.02]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.0125, 0.0125, width, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.1} />
          </mesh>

          {/* Guide Rail Upright Brackets */}
          {legXs.map((lx, i) => (
            <React.Fragment key={`bracket-${i}`}>
              <mesh position={[lx, height + 0.06, hd - 0.02]}>
                <boxGeometry args={[0.02, 0.12, 0.02]} />
                <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
              </mesh>
              <mesh position={[lx, height + 0.06, -hd + 0.02]}>
                <boxGeometry args={[0.02, 0.12, 0.02]} />
                <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
              </mesh>
            </React.Fragment>
          ))}
        </group>
      )}

      {/* Heavy Duty Square Steel Leg Assemblies (50x50mm tubing with leveling feet) */}
      {legXs.map((lx, i) => (
        <group key={`leg-pair-${i}`} position={[lx, 0, 0]}>
          {/* Left & Right Legs */}
          {[-hd + 0.04, hd - 0.04].map((lz, j) => (
            <group key={`leg-${j}`} position={[0, height / 2, lz]}>
              <mesh castShadow>
                <boxGeometry args={[0.05, height, 0.05]} />
                <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
              </mesh>
              {/* Threaded Foot Pad at Base */}
              <mesh position={[0, -height / 2 + 0.02, 0]}>
                <cylinderGeometry args={[0.04, 0.04, 0.04, 16]} />
                <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
              </mesh>
            </group>
          ))}
          {/* Cross Tie Bar between Legs */}
          <mesh position={[0, height * 0.4, 0]} castShadow>
            <boxGeometry args={[0.04, 0.04, depth - 0.08]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export default function ConveyorRenderer({ node }: { node: ConveyorNode }) {
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
    'warehouse:conveyor' as any,
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
      <Conveyor3DGeometry
        width={node.width}
        height={node.height}
        depth={node.depth}
        frameColor={node.frameColor}
        beltColor={node.beltColor}
        hasSideRails={node.hasSideRails}
      />
    </group>
  )
}
