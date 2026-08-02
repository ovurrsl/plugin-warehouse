import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { LevelsField } from './auto-fields'
import {
  clearAbove,
  collidingLevels,
  depthPublished,
  dividerHeightAt,
  doorLengthMismatch,
  doorTallerThanFrame,
  drawerHeightM,
  droppedLevelCount,
  fittedLevels,
  levelElevation,
  spliceRequired,
} from './bays'
import type { M3ShelvingNode } from './schema'
import {
  DOOR_BAY_LENGTH,
  frameHeightPublished,
  nearestShelfLength,
  SHELF_DEPTHS,
} from './standards'

/**
 * Auto-derived inspector fields rather than a `customPanel`: the escape hatch
 * short-circuits `groups`, `actions` and `trailingSection` together, so taking
 * it would mean owning the Move/Duplicate/Delete buttons too.
 *
 * Note what is **not** here: a cross-brace count and a cross-tie count. Both
 * are catalogue consequences of the height and the back panel, and a field for
 * either would be a number that can disagree with the two things that decide
 * it. `bays.crossBraceSets` and `bays.crossTieCount` own them, and the panel
 * reports what they came out as.
 */
export const m3Parametrics: ParametricDescriptor<M3ShelvingNode> = {
  groups: [
    {
      label: 'Bay',
      fields: [
        { key: 'shelfLength', kind: 'number', unit: 'm', min: 0.5, max: 2, step: 0.05 },
        { key: 'shelfDepth', kind: 'number', unit: 'm', min: 0.2, max: 0.8, step: 0.05 },
        { key: 'frameHeight', kind: 'number', unit: 'm', min: 0.8, max: 8, step: 0.25 },
        {
          key: 'frameVariant',
          kind: 'enum',
          options: ['basic', 'diagonals', 'central-panel', 'side-panel', 'mesh'],
          display: 'select',
        },
      ],
    },
    {
      label: 'Levels',
      // The whole vertical layout: elevations, panels, dividers, drawers.
      fields: [{ key: 'levels', kind: 'custom', component: LevelsField }],
    },
    {
      label: 'Enclosure',
      fields: [
        {
          key: 'backPanel',
          kind: 'enum',
          options: ['none', 'metal', 'mesh'],
          display: 'segmented',
        },
        { key: 'door', kind: 'enum', options: ['none', 'h1000', 'h2000'], display: 'segmented' },
      ],
    },
    {
      label: 'Finish',
      fields: [
        { key: 'uprightColor', kind: 'color' },
        { key: 'componentColor', kind: 'color' },
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

  trailingSection: () => import('./m3-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []

      const dropped = droppedLevelCount(node)
      if (dropped > 0) {
        issues.push({
          field: 'frameHeight',
          severity: 'warning',
          msg: `${dropped} kat ${node.frameHeight.toFixed(2)} m çerçevenin üstünde kalıyor ve çizilmiyor.`,
        })
      }

      /**
       * Two levels on the same slot.
       *
       * Worth its own check because the two entries read as *different* numbers
       * in the panel — 1.00 and 1.01 — and land on the same 25 mm slot. Without
       * this the user sees one shelf where they placed two and has nothing to
       * go on.
       */
      for (const index of collidingLevels(node)) {
        const level = node.levels[index]
        if (!level) continue
        issues.push({
          field: 'levels',
          severity: 'error',
          msg: `Kat ${index + 1} (${levelElevation(level).toFixed(3)} m) başka bir katla AYNI 25 mm yuvaya düşüyor; ikisi üst üste çizilir.`,
        })
      }

      /**
       * CATALOG. The door exists for one bay length and no other.
       *
       * An error rather than a warning, and reported rather than corrected: the
       * part genuinely does not exist for this bay, and silently dropping the
       * door would leave the user believing they had one.
       */
      if (doorLengthMismatch(node)) {
        issues.push({
          field: 'door',
          severity: 'error',
          msg: `Kapı yalnız ${(DOOR_BAY_LENGTH * 1000).toFixed(0)} mm gözde var (KATALOG); bu göz ${(node.shelfLength * 1000).toFixed(0)} mm. Çizilir ama sipariş edilemez.`,
        })
      }

      if (doorTallerThanFrame(node)) {
        issues.push({
          field: 'door',
          severity: 'error',
          msg: 'Kapı çerçeveden yüksek — üst kirişi havada kalıyor.',
        })
      }

      /**
       * A bay cut to an unpublished length.
       *
       * Reported, never corrected: a run against a wall really does get cut,
       * and snapping the number would move a bay the user positioned.
       */
      const nearest = nearestShelfLength(node.shelfLength)
      if (Math.abs(nearest - node.shelfLength) > 1e-6) {
        issues.push({
          field: 'shelfLength',
          severity: 'warning',
          msg: `${(node.shelfLength * 1000).toFixed(0)} mm katalog serisinde yok; en yakını ${(nearest * 1000).toFixed(0)} mm. Duvara kesilen gözlerde olağan.`,
        })
      }

      if (!depthPublished(node)) {
        issues.push({
          field: 'shelfDepth',
          severity: 'warning',
          msg: `${(node.shelfDepth * 1000).toFixed(0)} mm derinlik katalog serisinde yok (${SHELF_DEPTHS.map((d) => (d * 1000).toFixed(0)).join(' / ')}).`,
        })
      }

      /**
       * The two height series are reported apart on purpose. A 2.250 mm frame
       * is real, but it is printed only in the Spanish edition — a user
       * quoting from the English one deserves to know before ordering.
       */
      const heightSeries = frameHeightPublished(node.frameHeight)
      if (heightSeries === 'es-only') {
        issues.push({
          field: 'frameHeight',
          severity: 'warning',
          msg: `${(node.frameHeight * 1000).toFixed(0)} mm yalnız İSPANYOLCA katalogda listeli; İngilizce baskıda yok. Gerçek bir boy, ama teklifte doğrulayın.`,
        })
      } else if (heightSeries === 'unlisted') {
        issues.push({
          field: 'frameHeight',
          severity: 'warning',
          msg: `${(node.frameHeight * 1000).toFixed(0)} mm yayımlanmış serilerde yok (1.500 / 2.000 / 2.500 / 2.750 / 3.000 / 4.000 mm).`,
        })
      }

      if (spliceRequired(node)) {
        issues.push({
          field: 'frameHeight',
          severity: 'warning',
          msg: '8 m üstü çerçeve iki dikmenin eklenmesiyle yapılır (KATALOG) — farklı bir malzeme listesi.',
        })
      }

      const levels = fittedLevels(node)
      if (levels.length === 0) {
        issues.push({
          field: 'levels',
          severity: 'error',
          msg: 'Hiçbir kat çerçeveye sığmıyor — göz iki dikmeden ibaret çiziliyor.',
        })
      }

      levels.forEach((level, index) => {
        if (
          level.structure === 'shelf' &&
          level.dividers > 0 &&
          dividerHeightAt(node, index) === null
        ) {
          issues.push({
            field: 'levels',
            severity: 'warning',
            msg: `Kat ${index + 1}: üstteki açıklık ${(clearAbove(node, index) * 1000).toFixed(0)} mm, katalogun en kısa bölücüsü 100 mm — bölücü çizilmiyor.`,
          })
        }
        if (level.structure === 'drawers') {
          const opening = clearAbove(node, index)
          if (drawerHeightM(level) > opening + 1e-9) {
            issues.push({
              field: 'levels',
              severity: 'warning',
              msg: `Kat ${index + 1}: ${(drawerHeightM(level) * 1000).toFixed(0)} mm çekmece ${(opening * 1000).toFixed(0)} mm açıklığa girmiyor — üstteki raf çekmecenin üstüne oturuyor.`,
            })
          }
        }
      })

      return issues
    },
  ],
}
