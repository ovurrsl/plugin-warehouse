import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { lengthLabel, millimetreLabel, publishedMillimetres, unitNow } from '../units'
import { LevelsField } from './auto-fields'
import {
  collidingLevels,
  crossBracingAdvised,
  droppedLevelCount,
  fittedLevels,
  hmLengthUnpublished,
  levelElevation,
} from './levels'
import type { LongspanNode } from './schema'
import { FRAME_DEPTHS, nearestBayLength } from './standards'

/**
 * Auto-derived inspector fields rather than a `customPanel`: the escape hatch
 * short-circuits `groups`, `actions` and `trailingSection` together, so taking
 * it would mean owning the Move/Duplicate/Delete buttons too.
 *
 * The vertical layout is one custom field — `LevelsField` — for the reason the
 * other two racking kinds learned the hard way: splitting one dimension across
 * several controls in several groups is the "nested settings" complaint, and it
 * is easier not to introduce than to unpick.
 */
export const longspanParametrics: ParametricDescriptor<LongspanNode> = {
  groups: [
    {
      label: 'Bay',
      fields: [
        { key: 'bayLength', kind: 'number', unit: 'm', min: 0.6, max: 3, step: 0.05 },
        { key: 'frameDepth', kind: 'number', unit: 'm', min: 0.3, max: 1.4, step: 0.05 },
        { key: 'frameHeight', kind: 'number', unit: 'm', min: 1, max: 8, step: 0.5 },
      ],
    },
    {
      label: 'Levels',
      // The whole vertical layout: elevations, structures, shelf kinds, panel
      // counts. One control, because it is one thing.
      fields: [{ key: 'levels', kind: 'custom', component: LevelsField }],
    },
    {
      label: 'Steel',
      fields: [
        {
          key: 'uprightProfile',
          kind: 'enum',
          options: ['M-7515', 'M-7520', 'M-80MLD', 'M-81MLD'],
          display: 'select',
        },
        {
          key: 'beamProfile',
          kind: 'enum',
          options: ['ZE-35', 'ZE-55', 'ZE-65', 'ZS-35', 'ZS-55', 'ZS-65'],
          display: 'select',
        },
        { key: 'crossBracing', kind: 'boolean' },
        { key: 'uprightColor', kind: 'color' },
        { key: 'beamColor', kind: 'color' },
      ],
    },
    {
      label: 'Placement',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],

  trailingSection: () => import('./longspan-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const unit = unitNow()

      const dropped = droppedLevelCount(node)
      if (dropped > 0) {
        issues.push({
          field: 'frameHeight',
          severity: 'warning',
          msg: `${dropped} kat ${lengthLabel(node.frameHeight, unit)} çerçevenin üstünde kalıyor ve çizilmiyor.`,
        })
      }

      /**
       * Two levels on the same slot.
       *
       * Worth its own check because the two entries read as *different* numbers
       * in the panel — 1.00 and 1.02 — and land on the same 50 mm slot. Without
       * this the user sees one shelf where they placed two and has nothing to
       * go on.
       */
      for (const index of collidingLevels(node)) {
        const level = node.levels[index]
        if (!level) continue
        issues.push({
          field: 'levels',
          severity: 'error',
          msg: `Kat ${index + 1} (${lengthLabel(levelElevation(level), unit, 3)}) başka bir katla AYNI yuvaya düşüyor; ikisi üst üste çizilir.`,
        })
      }

      // The HM shelf has its own length series, narrower than the frame's.
      if (hmLengthUnpublished(node)) {
        issues.push({
          field: 'bayLength',
          severity: 'warning',
          msg: `HM rafı 1.000 / 1.250 / 1.400 mm boylarında yayımlanıyor; ${millimetreLabel(node.bayLength, unit)} bu seride yok (KATALOG).`,
        })
      }

      // CATALOG, and advice rather than enforcement: the stability threshold is
      // a calculation the catalogue does not publish.
      if (crossBracingAdvised(node)) {
        issues.push({
          field: 'crossBracing',
          severity: 'warning',
          msg: `${lengthLabel(node.frameHeight, unit, 1)} HM ünitesi koridor yönünde çapraz bağ istiyor (KATALOG). Eşik yayımlanmadığı için karar sizin.`,
        })
      }

      /**
       * A bay cut to an unpublished length.
       *
       * Reported, never corrected: a run against a wall really does get cut,
       * and snapping the number would move a bay the user positioned. The panel
       * names the nearest catalogue length so an order can be checked against
       * it.
       */
      const nearest = nearestBayLength(node.bayLength)
      if (Math.abs(nearest - node.bayLength) > 1e-6) {
        issues.push({
          field: 'bayLength',
          severity: 'warning',
          msg: `${millimetreLabel(node.bayLength, unit)} katalog serisinde yok; en yakını ${publishedMillimetres(nearest * 1000)}. Duvara kesilen gözlerde olağan.`,
        })
      }

      const depthPublished = FRAME_DEPTHS.some((depth) => Math.abs(depth - node.frameDepth) < 1e-6)
      if (!depthPublished) {
        issues.push({
          field: 'frameDepth',
          severity: 'warning',
          msg: `${millimetreLabel(node.frameDepth, unit)} derinlik katalog serisinde yok (${FRAME_DEPTHS.map((d) => (d * 1000).toFixed(0)).join(' / ')} mm).`,
        })
      }

      if (fittedLevels(node).length === 0) {
        issues.push({
          field: 'levels',
          severity: 'error',
          msg: 'Hiçbir kat çerçeveye sığmıyor — göz iki dikmeden ibaret çiziliyor.',
        })
      }

      return issues
    },
  ],
}
