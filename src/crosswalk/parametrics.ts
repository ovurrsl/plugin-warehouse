import type { ParametricDescriptor } from '@pascal-app/core'
import type { CrosswalkNode } from './schema'

export const crosswalkParametrics: ParametricDescriptor<CrosswalkNode> = {
  groups: [
    {
      label: 'Yaya Geçidi',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.5, max: 20, step: 0.1 },
        { key: 'length', kind: 'number', unit: 'm', min: 0.5, max: 10, step: 0.1 },
        { key: 'stripeCount', kind: 'number', min: 2, max: 20, step: 1 },
        { key: 'stripeColor', kind: 'color' },
      ],
    },
  ],
}
