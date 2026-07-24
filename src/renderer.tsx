import React, { useRef } from 'react';
import { useRegistry } from '@pascal-app/core';
import type { WarehouseNode } from './schema';

export function Renderer({ node }: { node: WarehouseNode }) {
  // Register this object so the editor's raycaster can hit it.
  const ref = useRef<THREE.Group>(null!);
  useRegistry(node.id, node.type, ref);

  // Parse attributes
  const w = node.width ?? 2;
  const h = node.height ?? 3;
  const d = node.depth ?? 1;
  const color = node.color ?? '#cccccc';

  // Basic representation based on preset
  let geometry;
  if (node.preset === 'rack') {
    // Just a placeholder rack
    geometry = (
      <group>
        {/* Frame legs */}
        <mesh position={[-w/2 + 0.05, h/2, -d/2 + 0.05]}><boxGeometry args={[0.1, h, 0.1]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[w/2 - 0.05, h/2, -d/2 + 0.05]}><boxGeometry args={[0.1, h, 0.1]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[-w/2 + 0.05, h/2, d/2 - 0.05]}><boxGeometry args={[0.1, h, 0.1]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[w/2 - 0.05, h/2, d/2 - 0.05]}><boxGeometry args={[0.1, h, 0.1]} /><meshStandardMaterial color={color} /></mesh>
        {/* Shelves */}
        <mesh position={[0, 0.1, 0]}><boxGeometry args={[w, 0.05, d]} /><meshStandardMaterial color="#aa5511" /></mesh>
        <mesh position={[0, h/2, 0]}><boxGeometry args={[w, 0.05, d]} /><meshStandardMaterial color="#aa5511" /></mesh>
        <mesh position={[0, h-0.1, 0]}><boxGeometry args={[w, 0.05, d]} /><meshStandardMaterial color="#aa5511" /></mesh>
      </group>
    );
  } else if (node.preset === 'pallet') {
    // Pallet
    geometry = (
      <mesh position={[0, 0.075, 0]}>
        <boxGeometry args={[1.2, 0.15, 0.8]} />
        <meshStandardMaterial color="#d4a373" />
      </mesh>
    );
  } else if (node.preset === 'forklift') {
    // Forklift placeholder
    geometry = (
      <group>
        <mesh position={[0, 0.5, 0]}><boxGeometry args={[1.2, 1, 2.5]} /><meshStandardMaterial color="#fca311" /></mesh>
        {/* Forks */}
        <mesh position={[0, 0.1, 1.8]}><boxGeometry args={[0.8, 0.05, 1.5]} /><meshStandardMaterial color="#222" /></mesh>
        {/* Cab */}
        <mesh position={[0, 1.5, -0.2]}><boxGeometry args={[1, 1, 1.2]} /><meshStandardMaterial color="#333" /></mesh>
      </group>
    );
  }

  return (
    <group ref={ref}>
      {geometry}
    </group>
  );
}
