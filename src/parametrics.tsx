import React from 'react';
import type { WarehouseNode } from './schema';

export function Parametrics({
  node,
  onChange,
}: {
  node: WarehouseNode;
  onChange: (updates: Partial<WarehouseNode>) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
      <label>
        <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Width (m)</span>
        <input
          type="number"
          step="0.1"
          value={node.width ?? 2}
          onChange={(e) => onChange({ width: parseFloat(e.target.value) })}
          style={{ width: '100%', padding: '4px' }}
        />
      </label>
      <label>
        <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Height (m)</span>
        <input
          type="number"
          step="0.1"
          value={node.height ?? 3}
          onChange={(e) => onChange({ height: parseFloat(e.target.value) })}
          style={{ width: '100%', padding: '4px' }}
        />
      </label>
      <label>
        <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Color</span>
        <input
          type="color"
          value={node.color ?? '#cccccc'}
          onChange={(e) => onChange({ color: e.target.value })}
          style={{ width: '100%', padding: '0' }}
        />
      </label>
    </div>
  );
}
