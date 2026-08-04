'use client'

import { SegmentedControl, SliderControl } from '@pascal-app/editor'
import type { CSSProperties } from 'react'
import { Caption, Note } from '../panels/kit'
import {
  fieldStep,
  fieldToMetres,
  lengthLabel,
  lengthUnit,
  lengthValue,
  metresToField,
  useUnit,
} from '../units'
import { clearOpening, fittedLevelCount, pitchZ, railHeight, railTopY } from './lanes'
import type { DriveInRackNode } from './schema'

/**
 * The clear-opening editor — the single control for a lane's vertical stack.
 *
 * `levelClear`, `levelClears` and `topClear` all live here. Three sliders in two
 * groups all setting the same dimension is exactly the nested-settings problem
 * the selective rack's `LevelsField` was built to fix, and shipping the same
 * arrangement on a new kind would have been shipping a known defect on purpose.
 *
 * The catalogue's pitch F is shown beside each row rather than edited: the
 * pitch is the opening plus the rail's own section, snapped up to the upright's
 * 50 mm slot, and the user sets the opening. Showing the derived figure is what
 * makes the 50 mm snapping visible instead of mysterious.
 */

const MUTED = 'var(--muted-foreground)'
const WARN = '#f59e0b'
const BORDER_50 = 'color-mix(in oklab, var(--border) 50%, transparent)'

const styles = {
  row: { display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0 0.5rem' },
  name: { flex: '0 0 3.25rem', fontSize: '0.6875rem', color: MUTED },
  input: {
    flex: '0 0 3.5rem',
    minWidth: 0,
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER_50}`,
    background: '#2C2C2E',
    padding: '0.1875rem 0.375rem',
    fontSize: '0.6875rem',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
    color: 'var(--foreground)',
  },
  derived: { flex: 1, fontSize: '0.625rem', color: MUTED, fontVariantNumeric: 'tabular-nums' },
} satisfies Record<string, CSSProperties>

type CustomField = {
  node: DriveInRackNode
  onUpdate: (patch: Partial<DriveInRackNode>) => void
}

export const LEVEL_CLEAR_BOUNDS = { min: 0.3, max: 4, step: 0.05 } as const
export const TOP_CLEAR_BOUNDS = { min: 0.3, max: 4, step: 0.05 } as const

export function LevelClearsField({ node, onUpdate }: CustomField) {
  // The floor opening is a row too, so a lane of three rails has four rows.
  const rows = node.levels + 1
  const fitted = fittedLevelCount(node)
  const clears = node.levelClears ?? []
  const rail = railHeight(node)
  const unit = useUnit()

  /** Trim to the row count so a lane taken from five levels to two and back
   *  does not resurrect the old overrides. */
  const sized = (source: readonly (number | null)[] | null | undefined): (number | null)[] =>
    Array.from({ length: rows }, (_, index) => source?.[index] ?? null)

  const setClear = (level: number, raw: string) => {
    const next = sized(clears)
    next[level] = raw === '' ? null : fieldToMetres(Number(raw), unit)
    // All-null returns the field to the schema's "no overrides" state, so a
    // saved scene reads identically to one that was never touched.
    onUpdate({ levelClears: next.every((value) => value == null) ? null : next })
  }

  return (
    <>
      <Caption>Varsayılan açıklıklar</Caption>
      <SliderControl
        label="Kat açıklığı"
        max={LEVEL_CLEAR_BOUNDS.max}
        min={LEVEL_CLEAR_BOUNDS.min}
        onChange={(levelClear) => onUpdate({ levelClear })}
        precision={2}
        step={LEVEL_CLEAR_BOUNDS.step}
        unit="m"
        value={node.levelClear}
      />
      <SliderControl
        label="Üst boşluk"
        max={TOP_CLEAR_BOUNDS.max}
        min={TOP_CLEAR_BOUNDS.min}
        onChange={(topClear) => onUpdate({ topClear })}
        precision={2}
        step={TOP_CLEAR_BOUNDS.step}
        unit="m"
        value={node.topClear}
      />

      <Caption hint="boş = varsayılan">Kat başına</Caption>
      {Array.from({ length: rows }, (_, level) => {
        const doesNotFit = level > fitted
        // The catalogue's F, shown rather than edited — this is where the 50 mm
        // slot snapping becomes visible instead of mysterious.
        const pitch = railTopY(node, level + 1) - railTopY(node, level)
        return (
          <div key={level} style={styles.row}>
            <span
              style={doesNotFit ? { ...styles.name, color: WARN } : styles.name}
              title={doesNotFit ? 'Dikme yüksekliğine sığmıyor' : undefined}
            >
              {level === 0 ? 'Zemin' : `Kat ${level}`}
              {doesNotFit ? ' ⚠' : ''}
            </span>
            <input
              inputMode="decimal"
              onChange={(event) => setClear(level, event.target.value)}
              placeholder={metresToField(
                clearOpening({ ...node, levelClears: null }, level),
                unit,
              ).toFixed(2)}
              step={fieldStep(0.05, unit)}
              style={styles.input}
              type="number"
              value={clears[level] == null ? '' : metresToField(clears[level] as number, unit)}
            />
            <span style={styles.derived}>
              {lengthUnit(unit)} → adım {lengthLabel(pitch, unit)}
            </span>
          </div>
        )
      })}

      <Note>
        Adım = açıklık + ray kesiti ({(rail * 1000).toFixed(0)} mm), dikmenin 50 mm yuva aralığına
        yukarı yuvarlanır (s.19 şek.3 / s.21 şek.6).
      </Note>
      {node.levels > fitted && (
        <Note>
          {node.levels - fitted} kat {lengthLabel(node.uprightHeight, unit)} dikmeye sığmıyor.
        </Note>
      )}
    </>
  )
}

/**
 * Post spacing into the depth — auto, or a declared figure.
 *
 * `null` means "one post per pallet position", which is an ASSUMPTION the
 * schema records: the catalogue ties frame depth to "aisle dimensions and
 * pallet size" (p.17) without publishing a table, and the p.16 render shows a
 * post at each position. The control exists so a real frame table can override
 * the derivation the day one arrives.
 */
export function PostPitchField({ node, onUpdate }: CustomField) {
  const derived = pitchZ(node)
  const unit = useUnit()
  return (
    <>
      <Caption hint={node.postPitchZ === null ? `auto — ${lengthLabel(derived, unit, 3)}` : 'elle'}>
        Dikme aralığı
      </Caption>
      <SegmentedControl
        onChange={(value: string) =>
          onUpdate({ postPitchZ: value === 'auto' ? null : Number(value) })
        }
        options={[
          { label: 'Auto', value: 'auto' },
          // Etiket çevrilir, `value` ASLA: `value` şemaya yazılan metre ve
          // `String(node.postPitchZ)` ile karşılaştırılıyor. Bu üç sayı bir
          // katalog serisi değil — üstteki not tam olarak bunun bir VARSAYIM
          // olduğunu söylüyor — yani çevrilmemeleri için bir gerekçe yok.
          ...[1, 1.2, 1.5].map((metres) => ({
            label: lengthValue(metres, unit, unit === 'imperial' ? 2 : 1),
            value: String(metres),
          })),
        ]}
        value={node.postPitchZ === null ? 'auto' : String(node.postPitchZ)}
      />
      <Note>
        Auto = palet konumu başına bir dikme. Katalog çerçeve derinliğini bir tabloyla yayınlamıyor
        (s.17); bu bir VARSAYIM ve alan onu geçersiz kılmak için var.
      </Note>
    </>
  )
}
