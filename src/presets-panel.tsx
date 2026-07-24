import React from 'react';
// Note: In a real plugin you would import useEditor or dispatch from the host
// Here we provide a simple UI that would typically dispatch a 'setTool' action.

export default function PresetsPanel() {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h3 style={{ margin: 0, fontSize: '16px' }}>Warehouse Presets</h3>
      
      <button 
        style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
        onClick={() => console.log('Activate Rack Tool')}
      >
        Storage Rack
      </button>

      <button 
        style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
        onClick={() => console.log('Activate Pallet Tool')}
      >
        Wood Pallet
      </button>

      <button 
        style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
        onClick={() => console.log('Activate Forklift Tool')}
      >
        Forklift
      </button>

      <p style={{ fontSize: '12px', color: '#666' }}>
        Click a preset to activate the placement tool in the editor.
      </p>
    </div>
  );
}
