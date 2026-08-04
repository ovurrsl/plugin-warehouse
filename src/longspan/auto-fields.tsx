'use client'

import { ActionButton, ActionGroup, SegmentedControl, SliderControl } from '@pascal-app/editor'
import type { CSSProperties } from 'react'
import { Caption, Note, SelectRow } from '../panels/kit'
import { lengthLabel, useUnit } from '../units'
import { clearAbove, fittedLevels, levelElevation, levelNeedsZtam, slotPitchFor } from './levels'
import type { LongspanLevel, LongspanNode } from './schema'
import { SHELF_KINDS } from './standards'

/**
 * The level editor — the one control for an M7 bay's whole vertical layout.
 *
 * `levels` is an array of descriptors rather than a count, because a bay can
 * mix four structures; a generic field kind cannot express that, so this is a
 * `kind: 'custom'` component. `parametrics.test.ts` and the recursive
 * reachability guard both still see every field it edits, because the guard
 * walks the Zod tree rather than the top-level keys.
 *
 * Each row shows the **snapped** elevation and the clear height above it. The
 * snap is not cosmetic: a beam level lands on the frame's 50 mm front pitch and
 * a reinforced HM shelf on its 25 mm side pitch, so retyping the same number on
 * two rows of different structures legitimately gives two different heights.
 * Showing the result is what makes that visible instead of mysterious.
 */

const MUTED = 'var(--muted-foreground)'
const WARN = '#f59e0b'
const BORDER_50 = 'color-mix(in oklab, var(--border) 50%, transparent)'

const styles = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    borderRadius: '0.5rem',
    border: `1px solid ${BORDER_50}`,
    padding: '0.5rem',
  },
  row: { display: 'flex', alignItems: 'center', gap: '0.375rem' },
  tag: { flex: '0 0 3rem', fontSize: '0.625rem', color: MUTED },
  derived: { flex: 1, fontSize: '0.625rem', color: MUTED, fontVariantNumeric: 'tabular-nums' },
  chip: {
    flex: '0 0 auto',
    padding: '0.1875rem 0.4375rem',
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER_50}`,
    background: '#2C2C2E',
    color: 'var(--foreground)',
    fontSize: '0.6875rem',
    lineHeight: 1,
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>

type CustomField = {
  node: LongspanNode
  onUpdate: (patch: Partial<LongspanNode>) => void
}

const STRUCTURE_LABEL: Record<LongspanLevel['structure'], string> = {
  'beam-shelf': 'Kirişli raf',
  'reinforced-hm': 'HM (kirişsiz)',
  'beam-only': 'Yalnız kiriş',
  hanging: 'Askılı',
}

export function LevelsField({ node, onUpdate }: CustomField) {
  const unit = useUnit()
  const fitted = fittedLevels(node)
  const fittedSet = new Set(fitted)

  const setLevel = (index: number, patch: Partial<LongspanLevel>) => {
    onUpdate({
      levels: node.levels.map((level, position) =>
        position === index ? { ...level, ...patch } : level,
      ),
    })
  }

  const addLevel = () => {
    // A new level goes above the highest one, one clear opening up — which is
    // where a user adding a shelf means to put it. Guessing "at zero" would put
    // it inside the bottom one and produce a collision warning on a click that
    // did nothing wrong.
    const top = fitted[fitted.length - 1]
    const above = top ? levelElevation(top) + 0.55 : 0.3
    const last = node.levels[node.levels.length - 1]
    onUpdate({
      levels: [
        ...node.levels,
        {
          elevation: Math.min(above, node.frameHeight),
          structure: last?.structure ?? 'beam-shelf',
          shelfKind: last?.shelfKind ?? 'chipboard',
          panels: last?.panels ?? 1,
        },
      ],
    })
  }

  const removeLevel = (index: number) => {
    // The schema floors the array at one: a frame with no level is two posts,
    // which the catalogue does not sell.
    if (node.levels.length <= 1) return
    onUpdate({ levels: node.levels.filter((_, position) => position !== index) })
  }

  return (
    <>
      <Caption hint={`${node.levels.length}`}>Katlar</Caption>
      {node.levels.map((level, index) => {
        const snapped = levelElevation(level)
        const doesNotFit = !fittedSet.has(level)
        const order = fitted.indexOf(level)
        const clear = order >= 0 ? clearAbove(node, order) : 0
        const pitch = slotPitchFor(level)
        const carriesPanel = level.structure === 'beam-shelf' || level.structure === 'reinforced-hm'

        return (
          <div key={`${index}-${level.structure}`} style={styles.card}>
            <div style={styles.row}>
              <span style={doesNotFit ? { ...styles.tag, color: WARN } : styles.tag}>
                {doesNotFit ? 'sığmaz' : `#${order + 1}`}
              </span>
              <span style={styles.derived}>
                {lengthLabel(snapped, unit, 3)} · {(pitch * 1000).toFixed(0)} mm yuva
                {!doesNotFit && ` · üstünde ${lengthLabel(clear, unit)}`}
              </span>
              {node.levels.length > 1 && (
                <button onClick={() => removeLevel(index)} style={styles.chip} type="button">
                  ×
                </button>
              )}
            </div>

            <SliderControl
              label="Kot"
              max={node.frameHeight}
              min={0}
              onChange={(elevation) => setLevel(index, { elevation })}
              precision={3}
              step={pitch}
              unit="m"
              value={level.elevation}
            />

            <SelectRow
              label="Yapı"
              onChange={(structure: LongspanLevel['structure']) => {
                // An HM level carries the HM panel by definition — it is one
                // folded sheet, not a choice — so switching structure sets the
                // shelf too. Leaving `chipboard` on an HM level would be a
                // stored value the geometry ignores.
                const shelfKind = structure === 'reinforced-hm' ? 'hm' : level.shelfKind
                setLevel(index, { structure, shelfKind })
              }}
              options={(['beam-shelf', 'reinforced-hm', 'beam-only', 'hanging'] as const).map(
                (value) => ({ label: STRUCTURE_LABEL[value], value }),
              )}
              value={level.structure}
            />

            {carriesPanel && level.structure !== 'reinforced-hm' && (
              <SegmentedControl
                onChange={(shelfKind: string) =>
                  setLevel(index, { shelfKind: shelfKind as LongspanLevel['shelfKind'] })
                }
                options={[
                  { label: 'Sunta', value: 'chipboard' },
                  { label: 'Tel', value: 'mesh' },
                  { label: 'Galvaniz', value: 'galvanised-picking' },
                ]}
                value={level.shelfKind}
              />
            )}

            {level.structure === 'beam-shelf' && (
              <SliderControl
                label="Panel"
                max={12}
                min={1}
                onChange={(panels) => setLevel(index, { panels: Math.round(panels) })}
                precision={0}
                step={1}
                value={level.panels}
              />
            )}

            {levelNeedsZtam(node, level) && (
              <Note>
                Z-TAM kelepçeleri otomatik eklendi: {SHELF_KINDS.chipboard.label} rafı 1.9 m ve
                üstünde kirişleri levhaya bastırmak zorunda (KATALOG).
              </Note>
            )}
          </div>
        )
      })}

      <ActionGroup>
        <ActionButton label="+ Kat ekle" onClick={addLevel} />
      </ActionGroup>
    </>
  )
}
