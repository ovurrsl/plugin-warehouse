import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { PALLET_PRESETS } from '../pallet/presets'
import {
  FRAME_HEIGHT_STEP_M,
  GRADIENT_RANGE,
  INTERMEDIATE_RETAINER_MIN_DEPTH,
  LANE_LENGTH_DATUM_M,
  MAX_PALLETS_DEEP,
  MIN_CLEAR_HEIGHT_M,
  ROLLER_PITCH_STEP_M,
} from './catalog'
import {
  channelDepthM,
  channelDropM,
  exceedsLaneDatum,
  frameHeightIsValid,
  frameHeightM,
  hasBrakeRollers,
  hasIntermediateRetainers,
  nearestValidFrameHeightM,
  rollerPitchIsValid,
} from './metrics'
import type { LiveRackingNode } from './schema'

const PRESET_KEYS = Object.keys(PALLET_PRESETS) as (keyof typeof PALLET_PRESETS)[]

/**
 * Alanlar bildirilir, host'un kendi editörleri çizer (`customPanel` yok —
 * o Move/Duplicate/Delete'i de sahiplenirdi).
 *
 * **Bay genişliği ve makara boyu ALAN DEĞİL.** İkisi de katalog formülüyle
 * paletten türüyor (E = A + 160, D = A + 30); alan yapmak, kullanıcının
 * katalogla çelişen bir sayı yazabilmesi demekti. Panel ikisini de okuma
 * olarak gösteriyor.
 */
export const liveRackingParametrics: ParametricDescriptor<LiveRackingNode> = {
  groups: [
    {
      label: 'Channel',
      fields: [
        { key: 'variant', kind: 'enum', options: ['FIFO', 'LIFO'], display: 'segmented' },
        { key: 'palletPreset', kind: 'enum', options: PRESET_KEYS, display: 'select' },
        { key: 'palletsDeep', kind: 'number', min: 1, max: MAX_PALLETS_DEEP, step: 1 },
        {
          key: 'gradient',
          kind: 'number',
          min: GRADIENT_RANGE.min,
          max: GRADIENT_RANGE.max,
          step: 0.005,
        },
        { key: 'rollerPitch', kind: 'number', unit: 'm', min: 0.05, max: 0.6, step: 0.075 },
      ],
    },
    {
      label: 'Levels',
      fields: [
        { key: 'levels', kind: 'number', min: 1, max: 12, step: 1 },
        { key: 'firstLevelClear', kind: 'number', unit: 'm', min: 0.4, max: 6, step: 0.05 },
        {
          key: 'levelClear',
          kind: 'number',
          unit: 'm',
          min: 0.4,
          max: 6,
          step: 0.05,
          // Tek katta üstünde boşluk bırakılacak bir kat yok.
          visibleIf: (node) => node.levels > 1,
        },
      ],
    },
    {
      label: 'Options',
      fields: [
        { key: 'withRetainers', kind: 'boolean' },
        { key: 'splitRollers', kind: 'boolean' },
        {
          key: 'intermediateRetainers',
          kind: 'boolean',
          /**
           * Eşiğin (15) biraz ALTINDAN görünür olması bilerek: eşikte
           * gizleseydik, sığ bir kanalda işaretli kalmış bir bayrağı
           * kullanıcı geri alamazdı. Görünür ama etkisiz olduğu aralıkta
           * invariant bunu açıkça söylüyor.
           */
          visibleIf: (node) => node.palletsDeep > 10,
        },
        { key: 'hingedChannels', kind: 'boolean' },
      ],
    },
    {
      label: 'Finish',
      fields: [
        { key: 'uprightColor', kind: 'color' },
        { key: 'beamColor', kind: 'color' },
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

  trailingSection: () => import('./panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []

      // Katalog: makara aralığı (ölçü Y) 75 mm'nin katı. Fren tamburu
      // aralığını da bu belirlediği için serbest bir sayı, sipariş
      // edilemeyecek bir kanal üretir.
      if (!rollerPitchIsValid(node)) {
        issues.push({
          field: 'rollerPitch',
          severity: 'warning',
          msg: `Makara aralığı ${(node.rollerPitch * 1000).toFixed(0)} mm — katalog ${(ROLLER_PITCH_STEP_M * 1000).toFixed(0)} mm'nin katını istiyor.`,
        })
      }

      // Katalog: kanal altındaki serbest yükseklik H ≥ 400 mm.
      if (node.firstLevelClear < MIN_CLEAR_HEIGHT_M) {
        issues.push({
          field: 'firstLevelClear',
          severity: 'error',
          msg: `İlk kat açıklığı ${(node.firstLevelClear * 1000).toFixed(0)} mm — katalog en az ${(MIN_CLEAR_HEIGHT_M * 1000).toFixed(0)} mm veriyor.`,
        })
      }

      // Fren makarası yalnız ikiden derin kanalda takılır. Sığ bir kanalda
      // hız regülasyonu YOK ve bu bir eksiklik değil, katalogun kuralı —
      // ama kullanıcı derinliği düşürünce sessizce kaybolduğu için söylenir.
      if (!hasBrakeRollers(node) && node.palletsDeep > 1) {
        issues.push({
          field: 'palletsDeep',
          severity: 'warning',
          msg: 'İki palet derinlikte fren makarası takılmaz (katalog kuralı); hız yalnız eğimle sınırlanır.',
        })
      }

      // Uzun kanalda ara tutucu olmadan paletler sonuna kadar serbest akar.
      if (node.palletsDeep >= INTERMEDIATE_RETAINER_MIN_DEPTH && !node.intermediateRetainers) {
        issues.push({
          field: 'intermediateRetainers',
          severity: 'warning',
          msg: `${node.palletsDeep} palet derinlikte katalog ara tutucu öneriyor.`,
        })
      }

      // İşaretli ama eşiğin altında: hiçbir tutucu üretilmiyor. Sessiz
      // kalmak, kullanıcıya taktığı bir donanımı taktırmış gibi göstermek
      // olurdu — kutunun işaretli olması tek başına bir söz.
      if (node.intermediateRetainers && !hasIntermediateRetainers(node)) {
        issues.push({
          field: 'intermediateRetainers',
          severity: 'warning',
          msg: `Ara tutucu ${INTERMEDIATE_RETAINER_MIN_DEPTH} paletten sığ kanalda takılmıyor — bu kanalda hiçbir parça üretmiyor.`,
        })
      }

      // Katalog: çerçeve yüksekliği 50 mm'nin katı (dikme delik adımı).
      // Yükseklik serbest bir toplam olduğu için tutturmak tesadüfe kalıyor.
      //
      // Alan bildirmiyor ÇÜNKÜ tek bir sahibi yok: yükseklik
      // `firstLevelClear + (levels−1)·levelClear + yapı + düşüş`. Birine
      // iliştirmek, kullanıcıyı düzeltmesi gereken alanın o olduğuna
      // inandırırdı — dördünden herhangi biri olabilir.
      if (!frameHeightIsValid(node)) {
        issues.push({
          severity: 'warning',
          msg: `Çerçeve yüksekliği ${(frameHeightM(node) * 1000).toFixed(0)} mm — katalog ${(FRAME_HEIGHT_STEP_M * 1000).toFixed(0)} mm'nin katını istiyor; en yakını ${(nearestValidFrameHeightM(node) * 1000).toFixed(0)} mm.`,
        })
      }

      // Katalog datumu 20 m; daha uzunu kurulabiliyor ama bilerek olmalı.
      if (exceedsLaneDatum(node)) {
        issues.push({
          field: 'palletsDeep',
          severity: 'warning',
          msg: `Kanal ${channelDepthM(node).toFixed(1)} m — katalogun ${LANE_LENGTH_DATUM_M} m koridor datumunu aşıyor (kurulabilir, ama standart dışı).`,
        })
      }

      // Düşüş kanalın kendi yapısını aşarsa giriş ucu bir sonraki katın
      // içine girer — kot zinciri bunu zaten hesaba katıyor ama kullanıcı
      // eğimi yükselttiğinde raf beklenmedik biçimde uzar.
      const drop = channelDropM(node)
      if (drop > node.levelClear && node.levels > 1) {
        issues.push({
          field: 'gradient',
          severity: 'warning',
          msg: `Kanal ${drop.toFixed(2)} m düşüyor, kat aralığından (${node.levelClear.toFixed(2)} m) fazla — raf belirgin biçimde yükselir.`,
        })
      }

      return issues
    },
  ],
}
