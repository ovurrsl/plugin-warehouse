'use client'

import type { CSSProperties } from 'react'
import { MAST_TABLES, type MastRowId, mastRowsFor } from '../handling/masts'
import {
  displayNameOf,
  TRUCK_MODEL_ID_LIST,
  TRUCK_MODELS,
  type TruckModelId,
} from '../handling/models'
import type { TruckNode } from './schema'

/**
 * `kind: 'custom'` alanları — rack/auto-fields'in dersi: host'un enum alanı
 * statik seçenek listesi ister ve görünen ad taşıyamaz; modele göre daralan
 * bir liste ancak custom bileşenle çizilir.
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
  select: {
    width: '100%',
    padding: '0.375rem 0.5rem',
    borderRadius: '0.375rem',
    border: '1px solid var(--border)',
    background: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '0.75rem',
  },
} satisfies Record<string, CSSProperties>

/** Model seçici — görünen adlar kullanıcının İngilizce terimleri, değer
 *  kalıcı kimlik. Model değişince mast satırı sıfırlanır: eski satır yeni
 *  modelin tablosu olmayabilir ve sessizce taşınmış bir mast, yanlış boyda
 *  çizilmiş bir makinedir. */
export function ModelField({
  node,
  onUpdate,
}: {
  node: TruckNode
  onUpdate: (patch: Partial<TruckNode>) => void
}) {
  return (
    <div style={styles.field}>
      <span style={styles.label}>Model</span>
      <select
        onChange={(event) => {
          const model = event.target.value as TruckModelId
          onUpdate({ model, mastRowId: null })
        }}
        style={styles.select}
        value={node.model}
      >
        {TRUCK_MODEL_ID_LIST.map((id) => (
          <option key={id} value={id}>
            {displayNameOf(TRUCK_MODELS[id])}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Mast satırı seçici. Model tablo sunmuyorsa bölüm HİÇ çizilmez — gri bir
 * kontrol değil (§6.5): transpalet ailelerinin mastı yoktur ve boş bir
 * seçici "veri eksik" der, oysa doğrusu "böyle bir şey yok"tur.
 */
export function MastRowField({
  node,
  onUpdate,
}: {
  node: TruckNode
  onUpdate: (patch: Partial<TruckNode>) => void
}) {
  const model = TRUCK_MODELS[node.model]
  const rows = mastRowsFor(model)
  if (model.mastTables.length === 0) return null

  return (
    <div style={styles.field}>
      <span style={styles.label}>
        <span>Mast</span>
        {rows.length === 0 && <span>satırlar katalogda değil</span>}
      </span>
      <select
        onChange={(event) => {
          const value = event.target.value
          onUpdate({ mastRowId: value === '' ? null : (value as MastRowId) })
        }}
        style={styles.select}
        value={node.mastRowId ?? ''}
      >
        <option value="">Seçilmedi</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {`${MAST_TABLES[row.table].label} · ${row.type} h3 ${row.h3.toFixed(2)} m`}
          </option>
        ))}
      </select>
    </div>
  )
}
