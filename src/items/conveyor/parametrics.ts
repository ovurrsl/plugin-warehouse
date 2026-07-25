import type { ParametricDescriptor } from '@pascal-app/core'
import type { ConveyorNode } from './schema'

export const conveyorParametrics: ParametricDescriptor<ConveyorNode> = {
  groups: [
    {
      label: 'Conveyor Segment Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 1.0, max: 10.0, step: 0.5 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.4, max: 2.0, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.2, max: 2.0, step: 0.05 },
      ],
    },
    {
      label: 'Steel Frame & Mesh Colors',
      fields: [
        { key: 'hasSideRails', kind: 'boolean' },
        { key: 'frameColor', kind: 'color' },
        { key: 'beltColor', kind: 'color' },
      ],
    },
  ],
}
