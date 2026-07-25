import type { ParametricDescriptor } from '@pascal-app/core'
import type { EuroPalletNode } from './schema'

export const euroPalletParametrics: ParametricDescriptor<EuroPalletNode> = {
  groups: [
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
    {
      label: 'Rotation',
      fields: [{ key: 'rotation', kind: 'vec3' }],
    },
  ],
}
