'use client'

import type { CSSProperties } from 'react'
import { FLOOR_TYPES, LOAD_CLASSES } from './catalog'
import type { MezzanineNode, MezzanineTier } from './schema'

/**
 * `grid` ve `tiers` — iç içe nesne / dizi-of-nesne, jenerik field kind'ları
 * (`number`/`enum`/`vec3`) bunu ifade edemez. Rack'ın `LevelClearsField`
 * deseni: `kind: 'custom'`, host düğümü abone eder ve `onUpdate` geçer —
 * `trailingSection`'ın aksine bu alanlar `parametrics.test.ts`'in kapsama
 * denetiminde GÖRÜNÜR kalır.
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
  row: { display: 'flex', alignItems: 'center', gap: '0.375rem' },
  input: {
    flex: 1,
    padding: '0.25rem 0.375rem',
    borderRadius: '0.25rem',
    border: '1px solid var(--border)',
    background: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '0.6875rem',
  },
  select: {
    flex: 1,
    padding: '0.25rem 0.375rem',
    borderRadius: '0.25rem',
    border: '1px solid var(--border)',
    background: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '0.6875rem',
  },
  tierCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    borderRadius: '0.375rem',
    border: '1px solid var(--border)',
    padding: '0.375rem 0.5rem',
  },
  button: {
    padding: '0.25rem 0.5rem',
    borderRadius: '0.25rem',
    border: '1px solid var(--border)',
    background: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '0.625rem',
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>

type CustomField = { node: MezzanineNode; onUpdate: (patch: Partial<MezzanineNode>) => void }

export function GridField({ node, onUpdate }: CustomField) {
  const { grid } = node
  const set = (patch: Partial<typeof grid>) => onUpdate({ grid: { ...grid, ...patch } })
  return (
    <div style={styles.field}>
      <span style={styles.label}>
        <span>Grid</span>
      </span>
      <div style={styles.row}>
        <input
          min={1}
          onChange={(e) => set({ baysX: Math.max(1, Number(e.target.value)) })}
          step={1}
          style={styles.input}
          type="number"
          value={grid.baysX}
        />
        <span style={{ fontSize: '0.625rem', color: MUTED }}>× bays X</span>
        <input
          min={1}
          onChange={(e) => set({ baysY: Math.max(1, Number(e.target.value)) })}
          step={1}
          style={styles.input}
          type="number"
          value={grid.baysY}
        />
        <span style={{ fontSize: '0.625rem', color: MUTED }}>bays Z</span>
      </div>
      <div style={styles.row}>
        <input
          min={2}
          onChange={(e) => set({ bayWidthM: Number(e.target.value) })}
          step={0.1}
          style={styles.input}
          type="number"
          value={grid.bayWidthM}
        />
        <span style={{ fontSize: '0.625rem', color: MUTED }}>× bay width m</span>
        <input
          min={2}
          onChange={(e) => set({ bayDepthM: Number(e.target.value) })}
          step={0.1}
          style={styles.input}
          type="number"
          value={grid.bayDepthM}
        />
        <span style={{ fontSize: '0.625rem', color: MUTED }}>bay depth m</span>
      </div>
    </div>
  )
}

const FLOOR_TYPE_IDS = Object.keys(FLOOR_TYPES) as Array<MezzanineTier['floorType']>

export function TiersField({ node, onUpdate }: CustomField) {
  const setTier = (index: number, patch: Partial<MezzanineTier>) => {
    const next = node.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier))
    onUpdate({ tiers: next })
  }

  const addTier = () => {
    const index = node.tiers.length
    const last = node.tiers[index - 1]
    onUpdate({
      tiers: [
        ...node.tiers,
        {
          index,
          elevationM: 'auto',
          clearHeightM: last?.clearHeightM ?? 3,
          loadClass: last?.loadClass ?? 500,
          floorType: last?.floorType ?? 'WOOD_CHIPBOARD_30',
        },
      ],
    })
  }

  const removeTier = (index: number) => {
    // En az bir tier kalmalı — şemanın kendi kuralı (`tiers.min(1)`); son
    // tier'i silme düğmesi devre dışı kalır, `parse` reddetmeyi bekletmez.
    if (node.tiers.length <= 1) return
    const next = node.tiers.filter((_, i) => i !== index).map((tier, i) => ({ ...tier, index: i }))
    onUpdate({ tiers: next })
  }

  return (
    <div style={styles.field}>
      <span style={styles.label}>
        <span>Tiers</span>
        <span>{node.tiers.length}</span>
      </span>
      {node.tiers.map((tier, index) => (
        <div key={tier.index} style={styles.tierCard}>
          <div style={styles.row}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 600 }}>
              Tier {index} {index === 0 ? '(ground)' : ''}
            </span>
            {node.tiers.length > 1 && (
              <button
                onClick={() => removeTier(index)}
                style={{ ...styles.button, marginLeft: 'auto' }}
                type="button"
              >
                Remove
              </button>
            )}
          </div>
          <div style={styles.row}>
            <input
              min={2}
              max={6}
              onChange={(e) => setTier(index, { clearHeightM: Number(e.target.value) })}
              step={0.1}
              style={styles.input}
              type="number"
              value={tier.clearHeightM}
            />
            <span style={{ fontSize: '0.625rem', color: MUTED }}>clear m</span>
            <select
              onChange={(e) =>
                setTier(index, { loadClass: Number(e.target.value) as MezzanineTier['loadClass'] })
              }
              style={styles.select}
              value={tier.loadClass}
            >
              {LOAD_CLASSES.map((value) => (
                <option key={value} value={value}>
                  {value} kg/m²
                </option>
              ))}
            </select>
          </div>
          <select
            onChange={(e) =>
              setTier(index, { floorType: e.target.value as MezzanineTier['floorType'] })
            }
            style={styles.select}
            value={tier.floorType}
          >
            {FLOOR_TYPE_IDS.map((id) => (
              <option key={id} value={id}>
                {FLOOR_TYPES[id].label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button onClick={addTier} style={styles.button} type="button">
        + Add tier
      </button>
    </div>
  )
}
