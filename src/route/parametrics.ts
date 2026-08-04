import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { TRUCK_VARIANTS } from '../handling/catalog'
import { millimetreLabel, unitNow } from '../units'
import { PEDESTRIAN_WIDTH_NOTE } from './catalog'
import { LINE_WIDTH_IDS } from './constants'
import { routeReading } from './metrics'
import { ROUTE_DATUMS, ROUTE_ROLES, ROUTE_TRAFFIC, type RouteNode } from './schema'

/**
 * The inspector for a marked route.
 *
 * **Every issue here is a measurement or a citation, never a verdict.** No
 * instrument binding a Turkish user publishes a traffic-route width — the
 * İşyeri Bina Yönetmeliği says *yeterli mesafe* and names no figure — so the
 * panel may say what a route measures and what a manufacturer's table asks for,
 * and may not say that a layout passes or fails.
 */
export const routeParametrics: ParametricDescriptor<RouteNode> = {
  groups: [
    {
      label: 'Route',
      fields: [
        { key: 'role', kind: 'enum', options: ROUTE_ROLES, display: 'segmented' },
        { key: 'traffic', kind: 'enum', options: ROUTE_TRAFFIC, display: 'segmented' },
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 20, step: 0.05 },
        { key: 'lineWidth', kind: 'enum', options: LINE_WIDTH_IDS, display: 'select' },
      ],
    },
    {
      label: 'Traffic',
      fields: [
        {
          key: 'requiredFor',
          kind: 'enum',
          options: TRUCK_VARIANTS,
          display: 'select',
          visibleIf: (node) => node.role === 'vehicle',
        },
        {
          // Surfaced rather than assumed, because the two answers differ by the
          // pallet's overhang and the layout silently loses floor area if the
          // reader guesses wrong.
          key: 'datum',
          kind: 'enum',
          options: ROUTE_DATUMS,
          display: 'segmented',
          visibleIf: (node) => node.role === 'vehicle',
        },
      ],
    },
  ],

  // The readings below, under the node's own fields. Without this they are
  // computed on every render and dropped — the host declares
  // `parametrics.invariants` and reads it nowhere — which for this kind meant
  // losing the feature itself: the published aisle band, the margin in
  // millimetres, and the note that a pedestrian width is an estimate.
  trailingSection: () => import('./route-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const unit = unitNow()
      const reading = routeReading(node)

      if (node.role === 'pedestrian') {
        // A statement of provenance, not a check. There is nothing to check
        // against: the only published pedestrian width in the survey is German.
        issues.push({ field: 'width', severity: 'warning', msg: PEDESTRIAN_WIDTH_NOTE })
        return issues
      }

      if (!reading.band) {
        issues.push({
          field: 'requiredFor',
          severity: 'warning',
          msg: 'Bir araç sınıfı seçilmedi — bu koridor hiçbir genişliğe karşı okunmuyor.',
        })
        return issues
      }

      const margin = reading.marginM ?? 0

      if (reading.band.basis === 'estimate') {
        // A margin against an estimate is still only a number. Colouring it
        // would launder an argument into a compliance statement.
        issues.push({ field: 'width', severity: 'warning', msg: reading.band.note })
        return issues
      }

      if (margin < 0) {
        issues.push({
          field: 'width',
          severity: 'error',
          msg: `${reading.band.label} için yayınlanmış en az ${reading.band.min.toFixed(2)} m — bu koridor ${millimetreLabel(Math.abs(margin), unit)} dar. (Mecalux / EN 15620, yükler arası; yasal bir sınır değil.)`,
        })
      } else {
        issues.push({
          field: 'width',
          severity: 'warning',
          msg: `${reading.band.label}: ${reading.band.min.toFixed(2)}–${reading.band.max.toFixed(2)} m. Bu koridorda ${millimetreLabel(margin, unit)} pay var.`,
        })
      }
      return issues
    },
  ],
}
