'use client'

import { MAST_TABLES, type MastRowId, mastRowsFor } from '../handling/masts'
import {
  displayNameOf,
  TRUCK_MODEL_ID_LIST,
  TRUCK_MODELS,
  type TruckModelId,
} from '../handling/models'
import { SelectRow } from '../panels/kit'
import type { TruckNode } from './schema'

/**
 * `kind: 'custom'` alanları — rack/auto-fields'in dersi: host'un enum alanı
 * statik seçenek listesi ister ve görünen ad taşıyamaz; modele göre daralan
 * bir liste ancak custom bileşenle çizilir.
 *
 * Kutunun kendisi host'un segmentli olmayan enum satırının aynısı
 * (`parametric-inspector.tsx:355-370`): solda etiket, sağda `<select>`. Kendi
 * ölçülerini yazmak yerine `SelectRow`'u kullanmalarının sebebi tam da bu —
 * bu iki alan, yanlarındaki host alanlarından ayırt edilememeli.
 */

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
    <SelectRow
      label="Model"
      onChange={(model: TruckModelId) => onUpdate({ model, mastRowId: null })}
      options={TRUCK_MODEL_ID_LIST.map((id) => ({
        label: displayNameOf(TRUCK_MODELS[id]),
        value: id,
      }))}
      value={node.model}
    />
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
    <SelectRow
      label={rows.length === 0 ? 'Mast — satırlar katalogda değil' : 'Mast'}
      onChange={(value: string) =>
        onUpdate({ mastRowId: value === '' ? null : (value as MastRowId) })
      }
      options={[
        { label: 'Seçilmedi', value: '' },
        ...rows.map((row) => ({
          label: `${MAST_TABLES[row.table].label} · ${row.type} h3 ${row.h3.toFixed(2)} m`,
          value: row.id as string,
        })),
      ]}
      value={node.mastRowId ?? ''}
    />
  )
}
