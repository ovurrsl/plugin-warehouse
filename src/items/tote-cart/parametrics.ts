import type { ParametricDescriptor } from '@pascal-app/core'
import type { ToteCartNode } from './schema'

export const toteCartParametrics: ParametricDescriptor<ToteCartNode> = {
  groups: [
    {
      label: 'Trolley Dimensions & Tiers',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.4, max: 1.5, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.3, max: 1.2, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.8, max: 2.2, step: 0.05 },
        { key: 'shelfLevels', kind: 'number', min: 1, max: 6, step: 1 },
      ],
    },
    {
      label: 'Frame & Bin Colors',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'toteColor', kind: 'color' },
      ],
    },
  ],
}
