import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { PALLET_PRESET_IDS } from '../pallet/presets'
import { CAPACITY_CLASSES } from './catalog'
import type { PalletLiftNode } from './schema'

/** Palet preset seçenekleri — palet ailesinin ortak listesi. */
const PALLET_PRESET_OPTIONS = [...PALLET_PRESET_IDS]

/**
 * Müfettiş alanları — ailenin deseni: `customPanel` yok, alanlar bildirilir ve
 * host'un kendi editörleri çizer.
 *
 * `fromLevelId`/`toLevelId` bir `ref` (kat seçici) alanı: değerleri bina
 * katlarının kimlikleri, statik bir enum'la sayılamaz. `null` (uç açık)
 * seçilebilir. `fallbackTravelM` bir sayı alanı — yalnız kat çözülemediğinde
 * okunur ama panelden ERİŞİLEBİLİR olmak zorunda (panel-reachability bekçisi).
 *
 * Kat SAYISI burada YOK: binadan türetiliyor (bkz. `levels.ts`).
 */
export const palletLiftParametrics: ParametricDescriptor<PalletLiftNode> = {
  groups: [
    {
      label: 'Machine',
      fields: [
        {
          key: 'capacityClass',
          kind: 'enum',
          options: [...CAPACITY_CLASSES],
          display: 'segmented',
        },
        { key: 'mastCount', kind: 'enum', options: ['2', '4'], display: 'segmented' },
        { key: 'palletPreset', kind: 'enum', options: PALLET_PRESET_OPTIONS, display: 'select' },
      ],
    },
    {
      label: 'Service',
      fields: [
        // Kat kimliği — statik enum'la sayılamaz, host kat seçicisi (`ref`).
        { key: 'fromLevelId', kind: 'ref', refKind: 'level' },
        { key: 'toLevelId', kind: 'ref', refKind: 'level' },
        // Yalnız <2 kat çözülünce okunur; yine de erişilebilir olmalı.
        { key: 'fallbackTravelM', kind: 'number', unit: 'm', min: 1.5, max: 12, step: 0.5 },
      ],
    },
    {
      label: 'Options',
      fields: [
        { key: 'hasEnclosure', kind: 'boolean' },
        { key: 'hasDoors', kind: 'boolean' },
        { key: 'hasControlPanel', kind: 'boolean' },
      ],
    },
    {
      label: 'Finish',
      fields: [
        { key: 'mastColor', kind: 'color' },
        { key: 'platformColor', kind: 'color' },
        { key: 'doorColor', kind: 'color' },
      ],
    },
    {
      label: 'Transform',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []

      // 4500 kg ağır hizmet sınıfı iki kolonla yayınlanmıyor — ağır yük dört
      // kolonlu mast ister (spec §1: 2-4 kolon, üst sınıf uçta). HATA: iki
      // kolonlu bir 4500 kg makine katalogda yok.
      if (node.capacityClass === '4500' && node.mastCount === '2') {
        issues.push({
          field: 'mastCount',
          severity: 'error',
          msg: '4500 kg ağır hizmet sınıfı dört kolonlu mast ister; iki kolon bu kapasitede yayınlanmıyor. Mast sayısını 4 yapın ya da kapasiteyi düşürün.',
        })
      }

      return issues
    },
  ],
}
