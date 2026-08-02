import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { PALLET_PRESETS } from '../pallet/presets'
import { LevelClearsField, PostPitchField } from './auto-fields'
import {
  bearingVerdict,
  boardsRunAlongRails,
  bracingConflictsWithEntry,
  centralisersUnavailable,
  depthClearanceTight,
  fittedLevelCount,
  forkliftEnvelope,
  railBearingEachSide,
  sideClearanceTight,
} from './lanes'
import type { DriveInRackNode } from './schema'
import { BEARING_MIN_DISPLACED, BEARING_MIN_IN_MOTION } from './standards'

const PRESET_KEYS = Object.keys(PALLET_PRESETS) as (keyof typeof PALLET_PRESETS)[]

/**
 * Auto-derived inspector fields rather than a `customPanel`, for the reason the
 * selective rack's descriptor gives: the escape hatch short-circuits `groups`,
 * `actions` *and* `trailingSection`, so taking it means owning the
 * Move/Duplicate/Delete buttons too.
 *
 * The invariants are where most of this file's value is. A drive-in lane has
 * more ways to be quietly wrong than any other kind in this package, because
 * almost every failure is a *clearance* rather than a collision: a pallet that
 * rests on 18 mm of rail looks exactly like one resting on 87 mm, right up
 * until it is loaded.
 */
export const driveInParametrics: ParametricDescriptor<DriveInRackNode> = {
  groups: [
    {
      label: 'Lane',
      fields: [
        { key: 'laneClearWidth', kind: 'number', unit: 'm', min: 0.9, max: 2.2, step: 0.05 },
        { key: 'palletsDeep', kind: 'number', min: 1, max: 16, step: 1 },
        { key: 'depthClearance', kind: 'number', unit: 'm', min: 0.01, max: 0.2, step: 0.005 },
        {
          key: 'entryMode',
          kind: 'enum',
          options: ['drive-in', 'drive-through'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Levels',
      fields: [
        { key: 'levels', kind: 'number', min: 0, max: 10, step: 1 },
        /**
         * The single control for a level's clear opening.
         *
         * `levelClear`, `levelClears` and `topClear` all live inside it — the
         * same consolidation the selective rack's `LevelsField` got, and for the
         * same reason: three sliders in two groups all setting the same
         * dimension is exactly the "nested settings" complaint.
         */
        { key: 'levelClears', kind: 'custom', component: LevelClearsField },
        { key: 'uprightHeight', kind: 'number', unit: 'm', min: 1, max: 20, step: 0.1 },
        { key: 'railType', kind: 'enum', options: ['gp', 'c'], display: 'segmented' },
      ],
    },
    {
      label: 'Load',
      fields: [
        { key: 'palletPreset', kind: 'enum', options: PRESET_KEYS, display: 'select' },
        {
          key: 'palletOrientation',
          kind: 'enum',
          options: ['short-side-out', 'long-side-out'],
          display: 'select',
        },
        { key: 'clearanceSide', kind: 'number', unit: 'm', min: 0.03, max: 0.3, step: 0.005 },
        { key: 'ghostFill', kind: 'number', min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      label: 'Structure',
      fields: [
        {
          key: 'constructiveSystem',
          kind: 'enum',
          options: ['cs1', 'cs2', 'cs3'],
          display: 'segmented',
        },
        { key: 'uprightWidth', kind: 'number', unit: 'm', min: 0.05, max: 0.25, step: 0.001 },
        { key: 'uprightDepth', kind: 'number', unit: 'm', min: 0.05, max: 0.25, step: 0.001 },
        { key: 'topBeamHeight', kind: 'number', unit: 'm', min: 0.06, max: 0.3, step: 0.01 },
        { key: 'postPitchZ', kind: 'custom', component: PostPitchField },
        { key: 'uprightColor', kind: 'color' },
        { key: 'beamColor', kind: 'color' },
        { key: 'railColor', kind: 'color' },
      ],
    },
    {
      label: 'Guidance',
      fields: [
        { key: 'guideRails', kind: 'boolean' },
        {
          key: 'guideVariant',
          kind: 'enum',
          options: ['lpn50', 'vgpc', 'single', 'u-profile'],
          display: 'select',
          // A variant with no guide fitted is the canonical inert control.
          visibleIf: (node) => node.guideRails,
        },
        {
          key: 'centralisers',
          kind: 'boolean',
          // p.24: a GP fitting. On a C rail there is nothing to centre against,
          // and the geometry does not build them — so the control would be
          // visible, adjustable and inert.
          visibleIf: (node) => node.railType === 'gp',
        },
        { key: 'uprightReinforcer', kind: 'boolean' },
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

  trailingSection: () => import('./drivein-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []

      // Levels silently stop existing when they do not fit the post, and
      // nothing on screen says so — the lane just has fewer rails than the
      // number in the field.
      const fitted = fittedLevelCount(node)
      if (fitted < node.levels) {
        issues.push({
          field: 'levels',
          severity: 'warning',
          msg: `${node.levels} kattan yalnız ${fitted}'i ${node.uprightHeight.toFixed(2)} m dikmeye sığıyor. Dikmeyi yükseltin ya da açıklıkları küçültün.`,
        })
      }

      /**
       * The bearing. The figure this whole kind turns on.
       *
       * A pallet resting on 18 mm of rail looks exactly like one resting on
       * 87 mm — the failure is invisible until it is loaded, which is why the
       * catalogue publishes two separate minima and why this reports both.
       */
      const bearing = railBearingEachSide(node)
      const verdict = bearingVerdict(node)
      if (verdict === 'insufficient') {
        issues.push({
          field: 'palletOrientation',
          severity: 'error',
          msg: `Palet raya her yanda yalnız ${(bearing * 1000).toFixed(0)} mm oturuyor; katalog hareket hâlinde bile ${(BEARING_MIN_IN_MOTION * 1000).toFixed(0)} mm istiyor (s.10, s.18).`,
        })
      } else if (verdict === 'in-motion-only') {
        issues.push({
          field: 'palletOrientation',
          severity: 'warning',
          msg: `Oturma her yanda ${(bearing * 1000).toFixed(0)} mm — yerleşmiş ve kaymış bir palet için istenen ${(BEARING_MIN_DISPLACED * 1000).toFixed(0)} mm'nin altında (s.18 şek.2).`,
        })
      }

      // p.8 fig.1. Reported, not forbidden: a rigid pallet may legitimately be
      // stored this way, and the catalogue's own drawing says so.
      if (boardsRunAlongRails(node)) {
        issues.push({
          field: 'palletOrientation',
          severity: 'warning',
          msg: 'Palet alt tahtaları raylara PARALEL uzanıyor — ortası boşta kalır. Katalog bunu yalnız rijit paletler için kabul ediyor (s.8 şek.1).',
        })
      }

      if (sideClearanceTight(node)) {
        issues.push({
          field: 'clearanceSide',
          severity: 'warning',
          msg: `Yan boşluk ${(node.clearanceSide * 1000).toFixed(0)} mm; katalog her yanda en az 75 mm istiyor (s.18).`,
        })
      }

      if (depthClearanceTight(node)) {
        issues.push({
          field: 'depthClearance',
          severity: 'warning',
          msg: `Derinlik payı ${(node.depthClearance * 1000).toFixed(0)} mm; katalog birim yük başına en az 25 mm istiyor (s.19 şek.4).`,
        })
      }

      // p.13. The one combination the catalogue rules out outright — and the
      // geometry declines to build the plane, so a saved scene stays buildable.
      if (bracingConflictsWithEntry(node)) {
        issues.push({
          field: 'constructiveSystem',
          severity: 'error',
          msg: 'Drive-through ile CS3 birlikte olamaz: CS3 kapalı uca dikey çapraz düzlem koyar, drive-through orayı giriş yapar (s.13). Çapraz çizilmiyor.',
        })
      }

      if (centralisersUnavailable(node)) {
        issues.push({
          field: 'centralisers',
          severity: 'warning',
          msg: 'Merkezleyiciler GP rayına ait (s.24); C rayında merkezlenecek bir şey yok ve çizilmiyorlar.',
        })
      }

      /**
       * The truck has to fit the lane it drives into.
       *
       * Reported as a figure rather than as a pass/fail because this package
       * does not know which truck: the aisle-width tables live on the handling
       * kind, and a lane is specified before a fleet is chosen.
       */
      const envelope = forkliftEnvelope(node)
      if (envelope.maxTruckWidth <= 0) {
        issues.push({
          field: 'laneClearWidth',
          severity: 'error',
          msg: 'Şerit, 75 mm yan boşluklardan sonra hiçbir araca yer bırakmıyor (s.19).',
        })
      }

      return issues
    },
  ],
}
