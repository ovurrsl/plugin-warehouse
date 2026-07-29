'use client'

import { SegmentedControl } from '@pascal-app/editor'
import type { CSSProperties } from 'react'
import type { PalletRackNode } from './schema'
import {
  autoPalletSupportBars,
  autoPalletsPerLevel,
  autoPickingBoxesAcross,
  autoPickingBoxesDeep,
  fittedLevelCount,
  levelClearOpening,
} from './slots'

/**
 * The fields that mean "work it out unless I say otherwise".
 *
 * Four of the rack's settings are `number | null`, where **null is the whole
 * point**: null means the value is derived from the geometry, so a bay widened
 * from 2.7 m to 3.5 m starts holding four pallets instead of three without
 * anyone editing a second field.
 *
 * The host's plain number field cannot express that — `parametric-inspector.tsx`
 * renders a number as `typeof value === 'number' ? value : 0`, so a null shows
 * as 0, clamped by the slider to its minimum, and the first drag writes a real
 * number over the null: a value that tracked the geometry is silently frozen.
 *
 * These used to live in the plugin's own trailing section on the stated grounds
 * that `ParamField` had no kind for a nullable number. That was simply wrong —
 * `kind: 'custom'` exists, the host subscribes the node and passes `onUpdate`,
 * and first-party kinds already use it for exactly this. Being wrong about it
 * cost more than the duplicated markup: a field in the trailing section is
 * exempt from `parametrics.test.ts`'s coverage assertions, so all four sat
 * outside the one test that checks every schema field is reachable.
 */

const MUTED = 'var(--muted-foreground)'

const styles = {
  field: { display: 'flex', flexDirection: 'column', gap: '0.3125rem' },
  label: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    fontSize: '0.6875rem',
    color: MUTED,
  },
} satisfies Record<string, CSSProperties>

/** Auto plus the counts around the derived one, so the choice is a short list
 *  rather than a slider whose useful range is three values wide. */
function optionsAround(auto: number, min: number, max: number): string[] {
  const wanted = [auto - 1, auto, auto + 1, auto + 2]
  const seen = new Set<number>()
  for (const value of wanted) {
    if (value >= min && value <= max) seen.add(value)
  }
  return [...seen].sort((a, b) => a - b).map(String)
}

function AutoField({
  auto,
  label,
  max,
  min,
  onChange,
  value,
}: {
  auto: number
  label: string
  max: number
  min: number
  onChange: (next: number | null) => void
  value: number | null
}) {
  return (
    <div style={styles.field}>
      <span style={styles.label}>
        <span>{label}</span>
        <span style={{ opacity: 0.7 }}>{value === null ? `auto — ${auto}` : 'set by hand'}</span>
      </span>
      <SegmentedControl
        onChange={(next: string) => onChange(next === 'auto' ? null : Number(next))}
        options={[
          { label: 'Auto', value: 'auto' },
          ...optionsAround(auto, min, max).map((option) => ({ label: option, value: option })),
        ]}
        value={value === null ? 'auto' : String(value)}
      />
    </div>
  )
}

/**
 * One component per field, each matching the host's custom-field contract:
 * `{ node, onUpdate }`, rendered inside the group it belongs to.
 *
 * The bounds are passed as literals here and asserted against the schema in
 * `parametrics.test.ts` — they used to match by inspection only, which is the
 * kind of agreement that holds until someone widens a schema range.
 */
type CustomField = { node: PalletRackNode; onUpdate: (patch: Partial<PalletRackNode>) => void }

export const PALLETS_PER_LEVEL_BOUNDS = { min: 1, max: 12 } as const
export const SUPPORT_BARS_BOUNDS = { min: 0, max: 3 } as const
export const BOXES_ACROSS_BOUNDS = { min: 1, max: 30 } as const
export const BOXES_DEEP_BOUNDS = { min: 1, max: 10 } as const

export function PalletsPerLevelField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPalletsPerLevel(node)}
      label="Pallets per level"
      max={PALLETS_PER_LEVEL_BOUNDS.max}
      min={PALLETS_PER_LEVEL_BOUNDS.min}
      onChange={(palletsPerLevel) => onUpdate({ palletsPerLevel })}
      value={node.palletsPerLevel}
    />
  )
}

export function PalletSupportBarsField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPalletSupportBars(node)}
      label="Pallet support bars"
      max={SUPPORT_BARS_BOUNDS.max}
      min={SUPPORT_BARS_BOUNDS.min}
      onChange={(palletSupportBars) => onUpdate({ palletSupportBars })}
      value={node.palletSupportBars}
    />
  )
}

export function PickingBoxesAcrossField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPickingBoxesAcross(node)}
      label="Boxes across"
      max={BOXES_ACROSS_BOUNDS.max}
      min={BOXES_ACROSS_BOUNDS.min}
      onChange={(pickingBoxesAcross) => onUpdate({ pickingBoxesAcross })}
      value={node.pickingBoxesAcross}
    />
  )
}

export function PickingBoxesDeepField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPickingBoxesDeep(node)}
      label="Boxes deep"
      max={BOXES_DEEP_BOUNDS.max}
      min={BOXES_DEEP_BOUNDS.min}
      onChange={(pickingBoxesDeep) => onUpdate({ pickingBoxesDeep })}
      value={node.pickingBoxesDeep}
    />
  )
}

/**
 * Kat başına açıklık — `levelClears` geçersiz kılmaları.
 *
 * Boş kutu = varsayılan (`firstLevelClear` / `levelClear` / picking açıklığı);
 * sayı = o katın kendi açıklığı. Yalnız gerçekten sığan katlar listelenir —
 * sığmayan bir kata değer yazdırmak, hiçbir şeyi hareket ettirmeyen bir alan
 * üretirdi.
 */
export function LevelClearsField({
  node,
  onUpdate,
}: {
  node: PalletRackNode
  onUpdate: (patch: Partial<PalletRackNode>) => void
}) {
  const fitted = fittedLevelCount(node)
  if (fitted === 0) return null
  const current = node.levelClears ?? []

  const setLevel = (level: number, raw: string) => {
    const next: Array<number | null> = Array.from(
      { length: Math.max(current.length, fitted) },
      (_, index) => current[index] ?? null,
    )
    next[level] = raw === '' ? null : Number(raw)
    // Hepsi null'a dönerse alan şemadaki "hiç geçersiz kılma yok" hâline
    // döner — kaydedilmiş sahne, hiç dokunulmamış sahneyle aynı okunur.
    onUpdate({ levelClears: next.every((v) => v == null) ? null : next })
  }

  return (
    <div style={styles.field}>
      <span style={styles.label}>
        <span>Kat açıklıkları</span>
        <span>boş = varsayılan</span>
      </span>
      {Array.from({ length: fitted }, (_, index) => {
        const level = index // 0 = zemin açıklığı
        const value = current[level]
        return (
          <div key={level} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{ fontSize: '0.625rem', color: MUTED, width: '3.5rem' }}>
              {level === 0 ? 'Zemin' : `Kat ${level}`}
            </span>
            <input
              inputMode="decimal"
              onChange={(event) => setLevel(level, event.target.value)}
              placeholder={levelClearOpening({ ...node, levelClears: null }, level).toFixed(2)}
              step={0.05}
              style={{
                flex: 1,
                padding: '0.25rem 0.375rem',
                borderRadius: '0.25rem',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'var(--foreground)',
                fontSize: '0.6875rem',
              }}
              type="number"
              value={value ?? ''}
            />
            <span style={{ fontSize: '0.625rem', color: MUTED }}>m</span>
          </div>
        )
      })}
    </div>
  )
}
