'use client'

import { ActionButton, ActionGroup, SegmentedControl, SliderControl } from '@pascal-app/editor'
import type { CSSProperties } from 'react'
import { Caption, Note, SelectRow } from '../panels/kit'
import {
  clearAbove,
  dividerHeightAt,
  drawerCount,
  drawerHeightM,
  fittedLevels,
  levelElevation,
  levelLoadKg,
} from './bays'
import type { M3Level, M3ShelvingNode } from './schema'
import { SHELF_MODELS, SLOT_PITCH } from './standards'

/**
 * The level editor — the one control for an M3 bay's whole vertical layout.
 *
 * One control, because it is one thing. Splitting a single dimension across
 * several sliders in several groups is the "nested settings" complaint this
 * engagement started from, and it is easier not to introduce than to unpick.
 *
 * Each row shows the **snapped** elevation, the clear height above it, and the
 * figures the level's own choices produce — the divider height that fits, the
 * drawer count the length gives, the kilograms the model is rated for. All
 * three are derived, and showing them is what keeps a derivation from reading
 * as something that just happened.
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
  node: M3ShelvingNode
  onUpdate: (patch: Partial<M3ShelvingNode>) => void
}

export function LevelsField({ node, onUpdate }: CustomField) {
  const fitted = fittedLevels(node)
  const fittedSet = new Set(fitted)

  const setLevel = (index: number, patch: Partial<M3Level>) => {
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
    const above = top ? levelElevation(top) + 0.5 : 0.3
    const last = node.levels[node.levels.length - 1]
    onUpdate({
      levels: [
        ...node.levels,
        {
          elevation: Math.min(above, node.frameHeight),
          structure: last?.structure ?? 'shelf',
          model: last?.model ?? 'HL',
          dividers: 0,
          drawerModel: last?.drawerModel ?? 'MA',
          drawerWidth: last?.drawerWidth ?? 'wide',
        },
      ],
    })
  }

  const removeLevel = (index: number) => {
    // The schema floors the array at one: a frame with no shelf is two posts.
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
        const dividerHeight = order >= 0 ? dividerHeightAt(node, order) : null
        const drawers = drawerCount(node, level)

        return (
          <div key={`${index}-${level.structure}`} style={styles.card}>
            <div style={styles.row}>
              <span style={doesNotFit ? { ...styles.tag, color: WARN } : styles.tag}>
                {doesNotFit ? 'sığmaz' : `#${order + 1}`}
              </span>
              <span style={styles.derived}>
                {snapped.toFixed(3)} m · {levelLoadKg(level)} kg
                {!doesNotFit && ` · üstünde ${clear.toFixed(2)} m`}
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
              // The 25 mm grid IS the step: an M3 shelf has nowhere else to sit.
              step={SLOT_PITCH}
              unit="m"
              value={level.elevation}
            />

            <SegmentedControl
              onChange={(structure: string) =>
                setLevel(index, { structure: structure as M3Level['structure'] })
              }
              options={[
                { label: 'Raf', value: 'shelf' },
                { label: 'Çekmeceli', value: 'drawers' },
              ]}
              value={level.structure}
            />

            <SelectRow
              label="Panel"
              onChange={(model: M3Level['model']) => setLevel(index, { model })}
              options={(['HL', 'HM'] as const).map((value) => ({
                label: `${SHELF_MODELS[value].label} — ${SHELF_MODELS[value].loadKg} kg`,
                value,
              }))}
              value={level.model}
            />

            {level.structure === 'shelf' && (
              <>
                <SliderControl
                  label="Bölücü"
                  max={12}
                  min={0}
                  onChange={(dividers) => setLevel(index, { dividers: Math.round(dividers) })}
                  precision={0}
                  step={1}
                  value={level.dividers}
                />
                {level.dividers > 0 && (
                  <Note>
                    {dividerHeight === null
                      ? `Üstteki açıklık ${(clear * 1000).toFixed(0)} mm; katalog serisinin en kısası 100 mm, bu yüzden bölücü çizilmiyor.`
                      : `Bölücü boyu ${(dividerHeight * 1000).toFixed(0)} mm — açıklığa sığan en büyük katalog boyu. Üstteki rafı indirirseniz kendiliğinden kısalır.`}
                  </Note>
                )}
              </>
            )}

            {level.structure === 'drawers' && (
              <>
                <SelectRow
                  label="Çekmece"
                  onChange={(drawerModel: M3Level['drawerModel']) =>
                    setLevel(index, { drawerModel })
                  }
                  options={[
                    { label: 'MA — 130 mm', value: 'MA' },
                    { label: 'MB — 80 mm', value: 'MB' },
                  ]}
                  value={level.drawerModel}
                />
                <SegmentedControl
                  onChange={(drawerWidth: string) =>
                    setLevel(index, { drawerWidth: drawerWidth as M3Level['drawerWidth'] })
                  }
                  options={[
                    { label: 'Dar 122', value: 'narrow' },
                    { label: 'Geniş 246', value: 'wide' },
                  ]}
                  value={level.drawerWidth}
                />
                <Note>
                  {drawers} çekmece — göz boyu ÷ çekmece genişliği. Katalogun iki satırı (1.000
                  mm'de 4/8, 1.250 mm'de 5/10) tam olarak bu bölme; sayı elle girilmiyor.
                  {level.structure === 'drawers' &&
                    clear > 0 &&
                    drawerHeightM(level) > clear &&
                    ' Dikkat: çekmece üstündeki açıklıktan yüksek.'}
                </Note>
              </>
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
