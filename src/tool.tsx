import { useEffect } from 'react';
import { useScene, generateId } from '@pascal-app/core';
import type { EquipmentPreset, WarehouseNode } from './schema';

export function Tool({
  parentId,
  position,
  rotation,
  preset,
  onComplete,
}: {
  parentId: string;
  position: [number, number, number];
  rotation: number;
  preset: EquipmentPreset;
  onComplete: () => void;
}) {
  // When the user clicks to place, we create the node
  useEffect(() => {
    const id = generateId('warehouse_');
    const node: WarehouseNode = {
      id,
      type: 'warehouse:equipment',
      parentId,
      preset,
      visible: true,
      width: preset === 'rack' ? 2 : preset === 'pallet' ? 1.2 : 1.2,
      height: preset === 'rack' ? 3 : preset === 'pallet' ? 0.15 : 2.5,
      depth: preset === 'rack' ? 1 : preset === 'pallet' ? 0.8 : 2.5,
      color: preset === 'rack' ? '#225588' : '#cccccc',
      metadata: { position, rotation }, // Typically handled by position systems, simplified here
    };

    useScene.getState().createNode(node, parentId);
    onComplete();
  }, [parentId, position, rotation, preset, onComplete]);

  return null;
}

export function Preview({
  position,
  rotation,
  preset,
}: {
  position: [number, number, number];
  rotation: number;
  preset: EquipmentPreset;
}) {
  // The ghost preview attached to the cursor
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[1, 2, 1]} />
        <meshBasicMaterial color="#00ff00" wireframe transparent opacity={0.5} />
      </mesh>
    </group>
  );
}
