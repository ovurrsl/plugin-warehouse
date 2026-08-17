import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import {
  SPIRAL_BELT_WIDTHS,
  SPIRAL_MAX_INCLINE_DEG,
  SPIRAL_OUTER_DIAMETERS,
  SPIRAL_PALLET_MIN_DIAMETER_MM,
} from './spiral-catalog'
import { turnCount } from './spiral-metrics'
import type { ConveyorSpiralNode } from './spiral-schema'

/**
 * Müfettiş alanları — ailenin deseni: alanlar bildirilir, host'un editörleri
 * çizer, `customPanel` yok.
 *
 * `entryHeight` Geometry grubunda: teleskopiğin `Tail` kotu gibi bu da
 * makinenin birleşebilmesinin şartı ve panelden erişilebilir olmak zorunda
 * (panel-reachability bekçisi). Sınıf başına eğim üst sınırı zod'da değil
 * (çapraz sınır 13), invariants'ta uyarıyla.
 */
export const conveyorSpiralParametrics: ParametricDescriptor<ConveyorSpiralNode> = {
  groups: [
    {
      label: 'Machine',
      fields: [
        { key: 'loadClass', kind: 'enum', options: ['light', 'pallet'], display: 'segmented' },
        {
          key: 'outerDiameter',
          kind: 'enum',
          options: [...SPIRAL_OUTER_DIAMETERS],
          display: 'select',
        },
        { key: 'beltWidth', kind: 'enum', options: [...SPIRAL_BELT_WIDTHS], display: 'segmented' },
        // Akış: yükseliş mi alçalış mı. Giriş/çıkış rollerini ve animasyon
        // yönünü belirler; hiçbir vertex kımıldatmaz.
        { key: 'flow', kind: 'enum', options: ['up', 'down'], display: 'segmented' },
        // Kiralite — aynalanmış helis (VERTEKS taşır).
        { key: 'handedness', kind: 'enum', options: ['cw', 'ccw'], display: 'segmented' },
      ],
    },
    {
      label: 'Geometry',
      fields: [
        { key: 'travelHeight', kind: 'number', unit: 'm', min: 1, max: 15, step: 0.1 },
        { key: 'inclineDeg', kind: 'number', unit: 'deg', min: 3, max: 13, step: 0.5 },
        // Giriş (alt) bant kotu — birleşmenin şartı; varsayılan 0,75 m.
        { key: 'entryHeight', kind: 'number', unit: 'm', min: 0.37, max: 3, step: 0.01 },
      ],
    },
    {
      label: 'Options',
      fields: [
        { key: 'hasCage', kind: 'boolean' },
        { key: 'hasHandrail', kind: 'boolean' },
      ],
    },
    {
      label: 'Finish',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'legColor', kind: 'color' },
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

      // Palet sınıfının asgari dış çapı YAYINLANMIŞ (spec §4): 2.400 mm.
      if (
        node.loadClass === 'pallet' &&
        Number(node.outerDiameter) < SPIRAL_PALLET_MIN_DIAMETER_MM
      ) {
        issues.push({
          field: 'outerDiameter',
          severity: 'error',
          msg: `Palet sınıfı en az ${SPIRAL_PALLET_MIN_DIAMETER_MM} mm dış çap ister (spec §4). Seçili: ${node.outerDiameter} mm.`,
        })
      }

      // Sınıf başına eğim üst sınırı: hafif ≤12,5°, palet ≤13° (spec §4).
      if (node.loadClass === 'light' && node.inclineDeg > SPIRAL_MAX_INCLINE_DEG.light) {
        issues.push({
          field: 'inclineDeg',
          severity: 'warning',
          msg: `Hafif sınıf ≤${SPIRAL_MAX_INCLINE_DEG.light}° eğim ister; ${node.inclineDeg}° kartonların kaymasına yol açabilir.`,
        })
      }

      // Bant çapa göre çok geniş: R = (çap − bant)/2 kolonu barındıramayacak
      // kadar küçülür.
      if (Number(node.beltWidth) >= Number(node.outerDiameter) / 2) {
        issues.push({
          field: 'beltWidth',
          severity: 'warning',
          msg: 'Bant genişliği dış çapa göre orantısız — helis yarıçapı merkez kolonu barındıramaz. Daha büyük çap seçin.',
        })
      }

      // Çok tur = çok slat = çok üçgen. Görsel bütçe uyarısı.
      if (turnCount(node) > 20) {
        issues.push({
          field: 'travelHeight',
          severity: 'warning',
          msg: `${turnCount(node).toFixed(1)} tur çok sayıda slat üretir; eğimi artırarak ya da yüksekliği azaltarak üçgen sayısını düşürebilirsiniz.`,
        })
      }

      return issues
    },
  ],
}
