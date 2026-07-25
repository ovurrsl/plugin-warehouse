import React, { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useLiveNodeOverrides, useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import type { PalletRackNode } from './schema'

type Props = {
  node: any
}

// Single Rack Row 3D Geometry Component
function SingleRackRow({
  node,
  rowOffsetZ = 0,
}: {
  node: PalletRackNode
  rowOffsetZ?: number
}) {
  const {
    columns = 1,
    bayWidth = 2.7,
    depth = 1.1,
    uprightHeight = 4.5,
    levels = 4,
    tierHeight = 1.1,
    beamThickness = 0.05,
    beamHeight = 0.12,
    uprightWidth = 0.08,
    uprightThickness = 0.08,
    bracingType = 'z-bracing',
    footplateType = 'heavy-duty',
    beamProfile = 'step-beam',
    deckType = 'wire-mesh',
    showBarcodes = true,
    capacitySignage = true,
    cornerProtectors = true,
    backMesh = false,
    cargoType = 'pallet',
    palletStyle = 'eur-pallet',
    cargoDistribution = 'random-realistic',
    fillRate = 75,
    uprightColor = '#1e40af',
    beamColor = '#f97316',
    hasPallets = true,
  } = node

  const totalWidth = columns * bayWidth
  const hw = totalWidth / 2
  const hd = depth / 2

  // Upright steel post geometry
  const postGeometry = useMemo(() => {
    return new THREE.BoxGeometry(uprightWidth, uprightHeight, uprightThickness)
  }, [uprightWidth, uprightHeight, uprightThickness])

  // Footplate anchor shoe geometry
  const footplateGeometry = useMemo(() => {
    const size = footplateType === 'heavy-duty' ? uprightWidth + 0.12 : uprightWidth + 0.06
    return new THREE.BoxGeometry(size, 0.02, size)
  }, [footplateType, uprightWidth])

  // Beam geometry
  const beamGeometry = useMemo(() => {
    const height = beamProfile === 'step-beam' ? beamHeight : beamHeight + 0.02
    return new THREE.BoxGeometry(bayWidth, height, beamThickness)
  }, [bayWidth, beamHeight, beamProfile, beamThickness])

  // Beam End Connector Clip geometry
  const clipGeometry = useMemo(() => {
    return new THREE.BoxGeometry(0.02, beamHeight + 0.04, 0.08)
  }, [beamHeight])

  // Safety Lock Pin geometry
  const pinGeometry = useMemo(() => {
    return new THREE.CylinderGeometry(0.012, 0.012, 0.04, 8)
  }, [])

  // Barcode label geometry
  const labelGeometry = useMemo(() => {
    return new THREE.BoxGeometry(0.24, 0.06, 0.002)
  }, [])

  // Capacity Signage Plate geometry
  const signageGeometry = useMemo(() => {
    return new THREE.BoxGeometry(0.005, 0.6, uprightThickness * 3)
  }, [uprightThickness])

  // Shelf deck geometry per bay
  const deckGeometry = useMemo(() => {
    return new THREE.BoxGeometry(bayWidth - uprightWidth, 0.02, depth - 0.04)
  }, [bayWidth, depth, uprightWidth])

  // Corner Protector geometry
  const protectorGeometry = useMemo(() => {
    return new THREE.BoxGeometry(uprightWidth + 0.06, 0.45, uprightThickness + 0.06)
  }, [uprightWidth, uprightThickness])

  // Rear Wire Mesh geometry
  const meshGeometry = useMemo(() => {
    return new THREE.BoxGeometry(totalWidth, uprightHeight - 0.3, 0.01)
  }, [totalWidth, uprightHeight])

  // Cargo Geometries
  const palletTopGeometry = useMemo(() => new THREE.BoxGeometry(1.0, 0.03, 1.2), [])
  const palletFootGeometry = useMemo(() => new THREE.BoxGeometry(0.12, 0.09, 0.12), [])
  const cargoBoxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.6, 0.8), [])
  const steelDrumGeometry = useMemo(() => new THREE.CylinderGeometry(0.28, 0.28, 0.85, 16), [])
  const plasticToteGeometry = useMemo(() => new THREE.BoxGeometry(0.4, 0.3, 0.6), [])

  // X positions for upright frame lines (columns + 1 positions)
  const frameXPositions = useMemo(() => {
    const pos: number[] = []
    for (let c = 0; c <= columns; c++) {
      pos.push(-hw + c * bayWidth)
    }
    return pos
  }, [columns, bayWidth, hw])

  // Tier level Y coordinates using tierHeight
  const tierYPositions = useMemo(() => {
    const positions: number[] = []
    for (let i = 1; i <= levels; i++) {
      const y = 0.3 + i * tierHeight - beamHeight / 2
      if (y < uprightHeight) {
        positions.push(y)
      }
    }
    return positions
  }, [uprightHeight, levels, tierHeight, beamHeight])

  // Diagonal Bracing Truss Segment Data
  const bracingSegments = useMemo(() => {
    if (bracingType === 'open') return []
    const count = Math.max(3, Math.floor(uprightHeight / 0.9))
    const stepY = uprightHeight / count
    const segs: { yStart: number; yEnd: number; zStart: number; zEnd: number }[] = []

    for (let i = 0; i < count; i++) {
      const yStart = i * stepY
      const yEnd = (i + 1) * stepY
      const zStart = i % 2 === 0 ? -hd + uprightThickness : hd - uprightThickness
      const zEnd = i % 2 === 0 ? hd - uprightThickness : -hd + uprightThickness
      segs.push({ yStart, yEnd, zStart, zEnd })

      if (bracingType === 'x-bracing') {
        segs.push({ yStart, yEnd, zStart: zEnd, zEnd: zStart })
      }
    }
    return segs
  }, [bracingType, uprightHeight, hd, uprightThickness])

  // Deck color based on deckType
  const deckColor = useMemo(() => {
    switch (deckType) {
      case 'wood':
        return '#d97706'
      case 'steel':
        return '#475569'
      case 'wire-mesh':
      default:
        return '#64748b'
    }
  }, [deckType])

  const nodeId = node.id || 'pallet_rack_node'

  return (
    <group position={[0, 0, rowOffsetZ]}>
      {/* Upright Steel Frames (Shared Column Line Uprights & Bracing Trusses) */}
      {frameXPositions.map((xPos, idx) => (
        <group key={`pr-frame-${nodeId}-${idx}`} position={[xPos, 0, 0]}>
          {/* Front Upright Post */}
          <mesh
            geometry={postGeometry}
            position={[0, uprightHeight / 2, hd - uprightThickness / 2]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={uprightColor} metalness={0.75} roughness={0.2} />
          </mesh>
          {/* Rear Upright Post */}
          <mesh
            geometry={postGeometry}
            position={[0, uprightHeight / 2, -hd + uprightThickness / 2]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={uprightColor} metalness={0.75} roughness={0.2} />
          </mesh>

          {/* Front Anchor Footplate */}
          <mesh geometry={footplateGeometry} position={[0, 0.01, hd - uprightThickness / 2]}>
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Rear Anchor Footplate */}
          <mesh geometry={footplateGeometry} position={[0, 0.01, -hd + uprightThickness / 2]}>
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>

          {/* Capacity Signage Plate on end upright frame */}
          {capacitySignage && idx === 0 && (
            <mesh geometry={signageGeometry} position={[-uprightWidth / 2 - 0.005, uprightHeight * 0.7, 0]}>
              <meshStandardMaterial color="#eab308" metalness={0.3} roughness={0.4} />
            </mesh>
          )}

          {/* Diagonal Steel Z/X Bracing Trusses */}
          {bracingSegments.map((seg, sIdx) => {
            const dy = seg.yEnd - seg.yStart
            const dz = seg.zEnd - seg.zStart
            const len = Math.sqrt(dy * dy + dz * dz)
            const angle = Math.atan2(dz, dy)
            const midY = (seg.yStart + seg.yEnd) / 2
            const midZ = (seg.zStart + seg.zEnd) / 2

            return (
              <mesh
                key={`bracing-${sIdx}`}
                position={[0, midY, midZ]}
                rotation={[angle, 0, 0]}
                castShadow
              >
                <boxGeometry args={[0.03, len, 0.03]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.2} />
              </mesh>
            )
          })}

          {/* Corner Safety Protectors on outer corner posts */}
          {cornerProtectors && (idx === 0 || idx === columns) && (
            <mesh geometry={protectorGeometry} position={[0, 0.225, hd - uprightThickness / 2]}>
              <meshStandardMaterial color="#eab308" metalness={0.4} roughness={0.4} />
            </mesh>
          )}
        </group>
      ))}

      {/* Rear Safety Wire Mesh */}
      {backMesh && (
        <mesh geometry={meshGeometry} position={[0, uprightHeight / 2 + 0.15, -hd]}>
          <meshStandardMaterial color="#94a3b8" wireframe opacity={0.6} transparent />
        </mesh>
      )}

      {/* Horizontal Load Beams, End Clips, Safety Lock Pins, Decks, and Cargo */}
      {Array.from({ length: columns }).map((_, cIdx) => {
        const bayCenterX = -hw + cIdx * bayWidth + bayWidth / 2

        return (
          <group key={`pr-bay-${nodeId}-${cIdx}`} position={[bayCenterX, 0, 0]}>
            {tierYPositions.map((yPos, tIdx) => {
              const isHeavyTier = cargoDistribution === 'heavy-bottom' ? tIdx < 2 : true
              const threshold = isHeavyTier ? fillRate : fillRate * 0.5
              const shouldPlaceCargo = cargoType !== 'empty' && hasPallets && (cIdx * 7 + tIdx * 13) % 100 < threshold

              return (
                <group key={`pr-tier-${nodeId}-${cIdx}-${tIdx}`} position={[0, yPos, 0]}>
                  {/* Front Load Beam */}
                  <mesh
                    geometry={beamGeometry}
                    position={[0, 0, hd - beamThickness / 2]}
                    castShadow
                    receiveShadow
                  >
                    <meshStandardMaterial color={beamColor} metalness={0.65} roughness={0.25} />
                  </mesh>

                  {/* Rear Load Beam */}
                  <mesh
                    geometry={beamGeometry}
                    position={[0, 0, -hd + beamThickness / 2]}
                    castShadow
                    receiveShadow
                  >
                    <meshStandardMaterial color={beamColor} metalness={0.65} roughness={0.25} />
                  </mesh>

                  {/* End Connector Clips & Yellow Safety Lock Pins */}
                  <group position={[-bayWidth / 2 + 0.01, 0, hd - beamThickness / 2]}>
                    <mesh geometry={clipGeometry}>
                      <meshStandardMaterial color="#475569" metalness={0.8} />
                    </mesh>
                    <mesh geometry={pinGeometry} position={[0, 0.05, 0.03]}>
                      <meshStandardMaterial color="#eab308" metalness={0.5} />
                    </mesh>
                  </group>
                  <group position={[bayWidth / 2 - 0.01, 0, hd - beamThickness / 2]}>
                    <mesh geometry={clipGeometry}>
                      <meshStandardMaterial color="#475569" metalness={0.8} />
                    </mesh>
                    <mesh geometry={pinGeometry} position={[0, 0.05, 0.03]}>
                      <meshStandardMaterial color="#eab308" metalness={0.5} />
                    </mesh>
                  </group>

                  {/* Barcode Location Label on Front Beam */}
                  {showBarcodes && (
                    <mesh geometry={labelGeometry} position={[0, 0, hd + 0.001]}>
                      <meshStandardMaterial color="#ffffff" roughness={0.9} />
                    </mesh>
                  )}

                  {/* Shelf Deck Surface */}
                  {deckType !== 'open' && (
                    <mesh
                      geometry={deckGeometry}
                      position={[0, beamHeight / 2, 0]}
                      receiveShadow
                    >
                      <meshStandardMaterial color={deckColor} metalness={0.3} roughness={0.6} />
                    </mesh>
                  )}

                  {/* Storage Products & Cargo Models */}
                  {shouldPlaceCargo && (
                    <group position={[0, beamHeight / 2 + 0.06, 0]}>
                      {/* Left Item */}
                      {cargoType === 'drums' ? (
                        <group position={[-bayWidth / 3.5, 0.42, 0]}>
                          <mesh geometry={steelDrumGeometry} castShadow>
                            <meshStandardMaterial color="#0284c7" metalness={0.8} roughness={0.3} />
                          </mesh>
                        </group>
                      ) : cargoType === 'totes' ? (
                        <group position={[-bayWidth / 3.5, 0.15, 0]}>
                          <mesh geometry={plasticToteGeometry} castShadow>
                            <meshStandardMaterial color="#16a34a" roughness={0.4} />
                          </mesh>
                        </group>
                      ) : (
                        <group position={[-bayWidth / 3.5, 0, 0]}>
                          <mesh geometry={palletTopGeometry} position={[0, 0.09, 0]} castShadow>
                            <meshStandardMaterial color="#d97706" roughness={0.85} />
                          </mesh>
                          <mesh geometry={palletFootGeometry} position={[-0.4, 0.045, -0.5]}>
                            <meshStandardMaterial color="#b45309" roughness={0.85} />
                          </mesh>
                          <mesh geometry={palletFootGeometry} position={[0.4, 0.045, -0.5]}>
                            <meshStandardMaterial color="#b45309" roughness={0.85} />
                          </mesh>
                          <mesh geometry={palletFootGeometry} position={[-0.4, 0.045, 0.5]}>
                            <meshStandardMaterial color="#b45309" roughness={0.85} />
                          </mesh>
                          <mesh geometry={palletFootGeometry} position={[0.4, 0.045, 0.5]}>
                            <meshStandardMaterial color="#b45309" roughness={0.85} />
                          </mesh>
                          <mesh geometry={cargoBoxGeometry} position={[0, 0.42, 0]} castShadow>
                            <meshStandardMaterial color="#b45309" roughness={0.7} />
                          </mesh>
                        </group>
                      )}

                      {/* Right Item */}
                      {cargoType === 'drums' ? (
                        <group position={[bayWidth / 3.5, 0.42, 0]}>
                          <mesh geometry={steelDrumGeometry} castShadow>
                            <meshStandardMaterial color="#0369a1" metalness={0.8} roughness={0.3} />
                          </mesh>
                        </group>
                      ) : cargoType === 'totes' ? (
                        <group position={[bayWidth / 3.5, 0.15, 0]}>
                          <mesh geometry={plasticToteGeometry} castShadow>
                            <meshStandardMaterial color="#2563eb" roughness={0.4} />
                          </mesh>
                        </group>
                      ) : (
                        <group position={[bayWidth / 3.5, 0, 0]}>
                          <mesh geometry={palletTopGeometry} position={[0, 0.09, 0]} castShadow>
                            <meshStandardMaterial color="#d97706" roughness={0.85} />
                          </mesh>
                          <mesh geometry={palletFootGeometry} position={[-0.4, 0.045, -0.5]}>
                            <meshStandardMaterial color="#b45309" roughness={0.85} />
                          </mesh>
                          <mesh geometry={palletFootGeometry} position={[0.4, 0.045, -0.5]}>
                            <meshStandardMaterial color="#b45309" roughness={0.85} />
                          </mesh>
                          <mesh geometry={palletFootGeometry} position={[-0.4, 0.045, 0.5]}>
                            <meshStandardMaterial color="#b45309" roughness={0.85} />
                          </mesh>
                          <mesh geometry={palletFootGeometry} position={[0.4, 0.045, 0.5]}>
                            <meshStandardMaterial color="#b45309" roughness={0.85} />
                          </mesh>
                          <mesh geometry={cargoBoxGeometry} position={[0, 0.42, 0]} castShadow>
                            <meshStandardMaterial color="#ca8a04" roughness={0.7} />
                          </mesh>
                        </group>
                      )}
                    </group>
                  )}
                </group>
              )
            })}
          </group>
        )
      })}
    </group>
  )
}

export default function PalletRackRenderer({ node: rawNode }: Props) {
  const ref = useRef<THREE.Group>(null!)

  // Merge live slider / handle drag overrides in real time
  const liveOverride = useLiveNodeOverrides((s) => s.overrides?.get(rawNode.id))
  const liveTransform = useLiveTransforms((s) => s.get(rawNode.id))

  const node = useMemo<PalletRackNode>(
    () => (liveOverride ? ({ ...rawNode, ...liveOverride } as PalletRackNode) : rawNode),
    [rawNode, liveOverride],
  )

  const isPreview = node.id === 'pallet_rack_preview_ghost' || (node as any).isTransient

  const handlers = useNodeEvents(
    isPreview ? (null as any) : (node as any),
    'warehouse:pallet-rack' as any,
  )

  // Register 3D group ref with Pascal sceneRegistry ONLY for real scene nodes (NOT preview ghosts)
  useRegistry(isPreview ? (null as any) : node.id, node.type, ref)

  const {
    depth = 1.1,
    isBackToBack = false,
    rowSpacerDistance = 0.3,
  } = node

  const rawAny = node as any
  const position = liveTransform?.position ?? rawAny.position ?? [0, 0, 0]
  const rotationY =
    liveTransform?.rotation ??
    (Array.isArray(rawAny.rotation) ? rawAny.rotation[1] ?? 0 : rawAny.rotation ?? 0)

  const halfSpacer = (depth + rowSpacerDistance) / 2

  return (
    <group
      ref={ref}
      position={position}
      rotation={[0, rotationY, 0]}
      visible={node.visible !== false}
      {...handlers}
    >
      {/* Front Rack Row */}
      <SingleRackRow node={node} rowOffsetZ={isBackToBack ? halfSpacer : 0} />

      {/* Twin Back-to-Back Rear Rack Row with Steel Spacer Frame Ties */}
      {isBackToBack && (
        <group>
          <SingleRackRow node={node} rowOffsetZ={-halfSpacer} />

          {/* Steel Row Spacer Ties connecting twin rows */}
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[node.columns * node.bayWidth, 0.04, rowSpacerDistance]} />
            <meshStandardMaterial color="#64748b" metalness={0.8} />
          </mesh>
          <mesh position={[0, node.uprightHeight * 0.8, 0]}>
            <boxGeometry args={[node.columns * node.bayWidth, 0.04, rowSpacerDistance]} />
            <meshStandardMaterial color="#64748b" metalness={0.8} />
          </mesh>
        </group>
      )}
    </group>
  )
}
