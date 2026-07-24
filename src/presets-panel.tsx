import React from 'react';
import { useEditor } from '@pascal-app/editor';
import { euroPalletDefinition } from './euro-pallet/definition';

export default function PresetsPanel() {
  const setTool = useEditor((s) => s.setTool);
  const setMode = useEditor((s) => s.setMode);

  const handleSelectEuroPallet = () => {
    setMode('build');
    setTool(euroPalletDefinition.kind);
  };

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h3 style={{ margin: 0, fontSize: '16px' }}>Warehouse Presets</h3>

      <button 
        style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', backgroundColor: '#f0f0f0' }}
        onClick={handleSelectEuroPallet}
      >
        Place Euro Pallet
      </button>

      <p style={{ fontSize: '12px', color: '#666' }}>
        Click a preset to activate the placement tool in the editor.
      </p>
    </div>
  );
}
