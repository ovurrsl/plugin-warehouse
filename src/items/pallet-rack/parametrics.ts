import type { ParametricDescriptor } from '@pascal-app/core'
import type { PalletRackNode } from './schema'

export const palletRackParametrics: ParametricDescriptor<PalletRackNode> = {
  groups: [
    {
      label: 'Racking Layout & Back-to-Back Row',
      fields: [
        { key: 'columns', kind: 'number', min: 1, max: 20, step: 1 },
        { key: 'levels', kind: 'number', min: 1, max: 8, step: 1 },
        { key: 'tierHeight', kind: 'number', unit: 'm', min: 0.5, max: 2.5, step: 0.05 },
        { key: 'bayWidth', kind: 'number', unit: 'm', min: 1.0, max: 5.0, step: 0.1 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.6, max: 2.5, step: 0.05 },
        { key: 'uprightHeight', kind: 'number', unit: 'm', min: 1.5, max: 12.0, step: 0.2 },
        { key: 'isBackToBack', kind: 'boolean' },
        {
          key: 'rowSpacerDistance',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 1.0,
          step: 0.05,
          visibleIf: (n) => n.isBackToBack,
        },
      ],
    },
    {
      label: 'Beam & Upright Steel Dimensions',
      fields: [
        { key: 'beamThickness', kind: 'number', unit: 'm', min: 0.03, max: 0.12, step: 0.005 },
        { key: 'beamHeight', kind: 'number', unit: 'm', min: 0.08, max: 0.2, step: 0.005 },
        {
          key: 'beamProfile',
          kind: 'enum',
          options: ['step-beam', 'box-beam'],
          display: 'segmented',
        },
        { key: 'uprightWidth', kind: 'number', unit: 'm', min: 0.06, max: 0.16, step: 0.005 },
        { key: 'uprightThickness', kind: 'number', unit: 'm', min: 0.06, max: 0.16, step: 0.005 },
        {
          key: 'bracingType',
          kind: 'enum',
          options: ['z-bracing', 'x-bracing', 'open'],
          display: 'segmented',
        },
        {
          key: 'footplateType',
          kind: 'enum',
          options: ['heavy-duty', 'standard'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Product & Cargo Storage Type',
      fields: [
        {
          key: 'cargoType',
          kind: 'enum',
          options: ['pallet', 'box', 'drums', 'totes', 'mixed', 'empty'],
          display: 'segmented',
        },
        {
          key: 'palletStyle',
          kind: 'enum',
          options: ['eur-pallet', 'industrial', 'mixed-crates'],
          display: 'segmented',
        },
        {
          key: 'cargoDistribution',
          kind: 'enum',
          options: ['random-realistic', 'heavy-bottom', 'full-uniform'],
          display: 'segmented',
        },
        { key: 'fillRate', kind: 'number', unit: '%', min: 0, max: 100, step: 5 },
        { key: 'hasPallets', kind: 'boolean' },
      ],
    },
    {
      label: 'Safety, Decking & Finish',
      fields: [
        {
          key: 'deckType',
          kind: 'enum',
          options: ['wire-mesh', 'wood', 'steel', 'open'],
          display: 'segmented',
        },
        {
          key: 'finishStyle',
          kind: 'enum',
          options: ['brand-new', 'industrial-satin', 'heavy-duty'],
          display: 'segmented',
        },
        { key: 'capacitySignage', kind: 'boolean' },
        { key: 'showBarcodes', kind: 'boolean' },
        { key: 'cornerProtectors', kind: 'boolean' },
        { key: 'backMesh', kind: 'boolean' },
        { key: 'uprightColor', kind: 'color' },
        { key: 'beamColor', kind: 'color' },
      ],
    },
  ],
}
