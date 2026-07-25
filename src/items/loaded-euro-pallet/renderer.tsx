import React, { useRef } from 'react'
import * as THREE from 'three'
import { useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'

import { EuroPallet3DGeometry } from '../euro-pallet/renderer'
import type { LoadedEuroPalletNode } from './schema'

/**
 * 1:1 Exact Real-World Loaded Euro Pallet 3D Geometry
 * Standards: FEFCO 0201 Shipping Cartons, VDA 4500 R-KLT Totes, ISO 200L Steel Drums
 * Semi-transparent Stretch Wrap Film (exact height fit) + Black V-Board Corner Guards
 */
export function LoadedEuroPallet3DGeometry({
  width = 1.2,
  height = 1.15,
  depth = 0.8,
  cargoType = 'boxes',
  wrapPlastic = true,
  cornerGuards = true,
  boxColor = '#cda27b',
}: {
  width?: number
  height?: number
  depth?: number
  cargoType?: 'boxes' | 'drums' | 'totes'
  wrapPlastic?: boolean
  cornerGuards?: boolean
  boxColor?: string
}) {
  const palletH = 0.144
  const loadH = Math.max(0.3, height - palletH)
  const boxLayerH = 0.33
  const layers = Math.max(1, Math.floor(loadH / boxLayerH))
  const actualLoadH = layers * (loadH / layers)

  return (
    <group>
      {/* 1:1 Pre-merged Single Buffer EPAL 1 Wooden Base */}
      <EuroPallet3DGeometry />

      {/* Cargo Stack */}
      <group position={[0, palletH, 0]}>
        {cargoType === 'boxes' && (
          <group>
            {Array.from({ length: layers }).map((_, l) => {
              const layerY = l * (loadH / layers) + loadH / layers / 2
              const singleBoxH = loadH / layers - 0.005
              const boxW = width / 2 - 0.015
              const boxD = depth / 2 - 0.015

              return (
                <group key={`box-layer-${l}`} position={[0, layerY, 0]}>
                  {/* 2x2 FEFCO 0201 Box Pattern per Layer */}
                  {[-width / 4, width / 4].map((bx, i) =>
                    [-depth / 4, depth / 4].map((bz, j) => (
                      <group key={`box-${i}-${j}`} position={[bx, 0, bz]}>
                        {/* Cardboard Box Body */}
                        <mesh castShadow receiveShadow>
                          <boxGeometry args={[boxW, singleBoxH, boxD]} />
                          <meshStandardMaterial color={boxColor} roughness={0.7} />
                        </mesh>

                        {/* Top Sealing Kraft Tape */}
                        <mesh position={[0, singleBoxH / 2 + 0.001, 0]}>
                          <planeGeometry args={[0.05, boxD]} />
                          <meshStandardMaterial color="#8c5a2b" roughness={0.5} />
                        </mesh>

                        {/* White Shipping Label with Barcode */}
                        <mesh
                          position={[
                            bx < 0 ? -boxW / 2 - 0.001 : boxW / 2 + 0.001,
                            0,
                            0,
                          ]}
                          rotation={[0, bx < 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
                        >
                          <planeGeometry args={[0.08, 0.05]} />
                          <meshBasicMaterial color="#ffffff" />
                        </mesh>
                      </group>
                    )),
                  )}
                </group>
              )
            })}
          </group>
        )}

        {cargoType === 'drums' && (
          <group position={[0, actualLoadH / 2, 0]}>
            {/* 4x 200L Industrial Steel Tight-Head Drums */}
            {[-width / 4, width / 4].map((dx, i) =>
              [-depth / 4, depth / 4].map((dz, j) => (
                <group key={`drum-${i}-${j}`} position={[dx, 0, dz]}>
                  <mesh castShadow receiveShadow>
                    <cylinderGeometry args={[0.27, 0.27, actualLoadH, 24]} />
                    <meshStandardMaterial color="#1e3a8a" metalness={0.8} roughness={0.2} />
                  </mesh>

                  {/* Reinforcing Steel Rolling Hoops */}
                  {[-actualLoadH / 4, actualLoadH / 4].map((hy, k) => (
                    <mesh key={`hoop-${k}`} position={[0, hy, 0]}>
                      <torusGeometry args={[0.275, 0.01, 8, 24]} />
                      <meshStandardMaterial color="#172554" metalness={0.9} roughness={0.1} />
                    </mesh>
                  ))}
                </group>
              )),
            )}
          </group>
        )}

        {cargoType === 'totes' && (
          <group>
            {/* VDA 4500 R-KLT Euro Plastic Totes */}
            {Array.from({ length: layers }).map((_, l) => {
              const layerY = l * (loadH / layers) + loadH / layers / 2
              const singleToteH = loadH / layers - 0.005
              const toteW = width / 2 - 0.015
              const toteD = depth / 2 - 0.015

              return (
                <group key={`tote-layer-${l}`} position={[0, layerY, 0]}>
                  {[-width / 4, width / 4].map((tx, i) =>
                    [-depth / 4, depth / 4].map((tz, j) => (
                      <mesh key={`tote-${i}-${j}`} position={[tx, 0, tz]} castShadow receiveShadow>
                        <boxGeometry args={[toteW, singleToteH, toteD]} />
                        <meshStandardMaterial color="#2563eb" roughness={0.3} />
                      </mesh>
                    )),
                  )}
                </group>
              )
            })}
          </group>
        )}

        {/* Semi-Transparent Glossy Stretch Wrap Plastic Foil */}
        {wrapPlastic && (
          <mesh position={[0, actualLoadH / 2, 0]}>
            <boxGeometry args={[width + 0.02, actualLoadH, depth + 0.02]} />
            <meshStandardMaterial
              color="#f8fafc"
              transparent
              opacity={0.38}
              roughness={0.08}
              metalness={0.12}
            />
          </mesh>
        )}

        {/* Heavy-Duty Black Recycled Plastic V-Board Corner Guards */}
        {cornerGuards && (
          <group>
            {[-width / 2, width / 2].map((cx, i) =>
              [-depth / 2, depth / 2].map((cz, j) => (
                <mesh key={`guard-${i}-${j}`} position={[cx, actualLoadH / 2, cz]}>
                  <boxGeometry args={[0.04, actualLoadH, 0.04]} />
                  <meshStandardMaterial color="#0f172a" roughness={0.4} />
                </mesh>
              )),
            )}
          </group>
        )}
      </group>
    </group>
  )
}

export default function LoadedEuroPalletRenderer({ node }: { node: LoadedEuroPalletNode }) {
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
    'warehouse:loaded-euro-pallet' as any,
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
      <LoadedEuroPallet3DGeometry
        width={node.width}
        height={node.height}
        depth={node.depth}
        cargoType={node.cargoType}
        wrapPlastic={node.wrapPlastic}
        cornerGuards={node.cornerGuards}
        boxColor={node.boxColor}
      />
    </group>
  )
}
