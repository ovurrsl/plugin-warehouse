import type { ParametricDescriptor } from '@pascal-app/core'
import type { LoadedEuroPalletNode } from './schema'

export const loadedEuroPalletParametrics: ParametricDescriptor<LoadedEuroPalletNode> = {
  groups: [
    {
      label: 'Cargo Stack Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.6, max: 2.0, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.6, max: 2.0, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.4, max: 2.5, step: 0.05 },
      ],
    },
    {
      label: 'Cargo Type & Packaging',
      fields: [
        {
          key: 'cargoType',
          kind: 'enum',
          options: ['boxes', 'drums', 'totes'],
          display: 'segmented',
        },
        { key: 'wrapPlastic', kind: 'boolean' },
        { key: 'cornerGuards', kind: 'boolean' },
        { key: 'boxColor', kind: 'color' },
      ],
    },
  ],
}
