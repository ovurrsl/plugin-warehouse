import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { MAST_TABLES } from '../handling/masts'
import { TRUCK_MODELS } from '../handling/models'
import { MastRowField, ModelField } from './fields'
import { mastRowOf, modelOf } from './metrics'
import type { TruckNode } from './schema'

/**
 * Müfettiş alanları — pallet'in deseni: `customPanel` yok (Move/Duplicate/
 * Delete'i de sahiplenirdi), alanlar bildirilir ve host'un kendi editörleri
 * çizer.
 *
 * `model` ve `mastRowId` `kind: 'custom'` — doğrulanmış host kısıtı: enum
 * seçenekleri statiktir, modele göre daraltılamaz, ve görünen ad (Electric
 * forklift · 1.3 t) seçenek dizesine yazılamaz. `referenceLoad` standart
 * enum kalır: iki seçeneği de her modelde aynıdır, yalnız Ast'sız ailelerde
 * alan gizlenir (`visibleIf` alanı gizler — seçeneği değil, ki gereken tam da
 * bu).
 *
 * `invariants` yalnız TEK düğümün saf fonksiyonudur; sahneyi okuyan her
 * bulgu (koridor payı, sarkan rota) `trailingSection`'a gider. Ve
 * `trailingSection` olmadan invariants çöpe gider — host bildirir, hiçbir
 * yerde okumaz.
 */
export const truckParametrics: ParametricDescriptor<TruckNode> = {
  groups: [
    {
      label: 'Truck',
      fields: [
        { key: 'model', kind: 'custom', component: ModelField },
        { key: 'mastRowId', kind: 'custom', component: MastRowField },
        {
          key: 'referenceLoad',
          kind: 'enum',
          options: ['1000x1200', '800x1200'],
          display: 'segmented',
          // Alan gizlenir, seçenek değil — Ast'sız ailede (tt, mpt) okunacak
          // bir yük yönelimi yoktur.
          visibleIf: (n) => TRUCK_MODELS[n.model].ast !== null,
        },
        { key: 'forkHeight', kind: 'number', unit: 'm', min: 0, max: 18, step: 0.05 },
      ],
    },
    {
      label: 'Duty',
      fields: [{ key: 'duty', kind: 'enum', options: ['parked', 'shuttle'], display: 'segmented' }],
    },
    {
      label: 'Transform',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],

  trailingSection: () => import('./truck-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const model = modelOf(node.model)
      const row = mastRowOf(node.mastRowId)

      // Sipariş edilen mast bu modelde sunulmuyor — şema hatası değil,
      // uyarı: sahne yüklenir, panel söyler, sessizce düzeltilmez (§2.5).
      if (node.mastRowId && row && !model.mastTables.includes(row.table)) {
        issues.push({
          field: 'mastRowId',
          severity: 'error',
          msg: `Kayıtlı mast satırı (${MAST_TABLES[row.table].label}) bu modelde sunulmuyor.`,
        })
      }

      if (row && node.forkHeight > row.h3 + 0.0005) {
        issues.push({
          field: 'forkHeight',
          severity: 'error',
          msg: `Çatal kotu ${node.forkHeight.toFixed(2)} m, seçili mastın h3'ü ${row.h3.toFixed(2)} m — bu konfigürasyon bu kota çıkamaz.`,
        })
      }
      if (!row && node.forkHeight > 0.15) {
        issues.push({
          field: 'forkHeight',
          severity: 'warning',
          msg: 'Mast satırı seçilmeden kaldırma kotu doğrulanamaz — kot çizilir ama taahhüt edilmez.',
        })
      }

      if (node.duty === 'shuttle' && !node.routeId) {
        issues.push({
          field: 'duty',
          severity: 'warning',
          msg: 'Görev "shuttle" ama rota atanmamış — araç park hâlinde kalır.',
        })
      }

      return issues
    },
  ],
}
