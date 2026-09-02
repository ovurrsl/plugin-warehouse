/**
 * Regulatory Standards Registry for Zero Defect Start-up (ZDSU).
 *
 * Implements national and international warehouse engineering, safety, and fire
 * protection frameworks:
 * 1. Turkey (TR): TSE / BYKHY (Binaların Yangından Korunması) / İSG Mevzuatı
 * 2. Europe (EU): EN 15635 / EN 15620 / FEM 10.2.02 / EN ISO 14122
 * 3. United States (US): NFPA 13 / OSHA 1910 / ANSI B56.1 / WERC Benchmarks
 */

import type {
  RegulatoryStandardId,
  RegulatoryStandardProfile,
  StandardThresholds,
} from './zero-defect-types'

export const REGULATORY_STANDARDS: Record<RegulatoryStandardId, RegulatoryStandardProfile> = {
  TR: {
    id: 'TR',
    name: 'Türkiye Standartları & Yangın Yönetmeliği (TSE / BYKHY / İSG)',
    shortName: '🇹🇷 TR (TSE)',
    region: 'Turkey',
    governingBodies: [
      'TSE (Türk Standardları Enstitüsü)',
      'Çevre, Şehircilik ve İklim Değişikliği Bakanlığı (BYKHY)',
      'Çalışma ve Sosyal Güvenlik Bakanlığı (İSG)',
    ],
    citations: {
      sprinkler:
        'BYKHY Madde 95-97 / TS EN 12845 (Depolarda sprinkler deflektör mesafesi ≥ 0.50m, yüksek depolamada ≥ 0.90m)',
      flueSpace:
        'TS EN 15635 §8.4 / BYKHY Ek-9 (Sırt sırta raflarda min 100mm dikey baca/emniyet aralığı)',
      aisles:
        'İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği / TS EN 15620',
      racking:
        'TS EN 15635 / TS EN 15512 (Ayak darbe koruyucuları zorunlu, sehim limiti ≤ L/200)',
      staging:
        'BYKHY Madde 31 / Lojistik Depolama Yangın Güvenliği Rehberi (Min 30.0 m²/dok)',
      mezzanine:
        'BYKHY Madde 41 & İSG Yönetmeliği (Korkuluk ≥ 1.10m, Etek sacı ≥ 100mm, Merdiven ≥ 0.90m, Tavan ≥ 2.10m)',
      floorUtilization: 'İSG Depolama Alanı Güvenlik Limitleri (Azami %70 depolama, %55 yükleme)',
      emergencyEgress: 'BYKHY Madde 31 (Acil çıkış ve ana tahliye koridoru min 1.20m)',
    },
    thresholds: {
      sprinklerClearanceM: 0.5,
      sprinklerHighHazardClearanceM: 0.9,
      minFlueSpaceM: 0.1,
      egressAisleMinClearM: 1.2,
      mainAisleMinClearM: 3.0,
      stagingAreaPerDockM2: 30.0,
      criticalStagingBufferDeficitM2: 20.0,
      minDockClearanceM: 3.0,
      dockApronDepthM: 15.0,
      maxMezzanineOccupancyPerM2: 0.5,
      defaultBeamClearanceMm: 100,
      maxStorageUtilizationPct: 70,
      maxStagingUtilizationPct: 55,
      maxContinuousRackRowLengthM: 40.0,
      enforceUprightProtectors: true,
      mezzanineMinGuardrailHeightM: 1.1,
      mezzanineMinKickPlateHeightM: 0.1,
      mezzanineMinHeadroomM: 2.1,
      aisleWidths: {
        counterbalance: { min: 3.5, rec: 3.8 },
        reach: { min: 2.7, rec: 3.0 },
        vnaTurret: { min: 1.65, rec: 1.85 },
      },
    },
  },
  EU: {
    id: 'EU',
    name: 'European Standards (EN 15635 / EN 15620 / FEM / EN ISO 14122)',
    shortName: '🇪🇺 EU (EN/FEM)',
    region: 'Europe',
    governingBodies: [
      'CEN (European Committee for Standardization)',
      'FEM (Fédération Européenne de la Manutention)',
      'ISO (International Organization for Standardization)',
    ],
    citations: {
      sprinkler:
        'EN 12845 §12.4.1 / CEA 4001 (Min 0.50m below deflector, 1.00m for high density storage)',
      flueSpace:
        'EN 15635 §8.4.2 / EN 15620 Table 2 (Continuous longitudinal flue clearance ≥ 75mm - 100mm)',
      aisles: 'FEM 10.2.02 / EN 15620 (Handling Class 400/300A/300B clearances)',
      racking:
        'EN 15635 §8.4 / EN 15512 (Corner column protectors ≥ 400mm, beam deflection ≤ L/200)',
      staging: 'FEM 10.2.02 Warehouse Design Rules (Min 30.0 m²/dock, recommended ≥ 40.0 m²)',
      mezzanine:
        'EN ISO 14122-2/3 (Guardrail ≥ 1.10m, Kick-plate ≥ 100mm, Stairs ≥ 0.80m single / 1.00m multi, Headroom ≥ 2.00m)',
      floorUtilization: 'FEM 10.2.02 Storage Density Limits (Max 70% storage, 55% staging)',
      emergencyEgress: 'EN ISO 14122-2 (Minimum clear escape passageway width 1.20m)',
    },
    thresholds: {
      sprinklerClearanceM: 0.5,
      sprinklerHighHazardClearanceM: 1.0,
      minFlueSpaceM: 0.075,
      egressAisleMinClearM: 1.2,
      mainAisleMinClearM: 3.0,
      stagingAreaPerDockM2: 30.0,
      criticalStagingBufferDeficitM2: 25.0,
      minDockClearanceM: 3.0,
      dockApronDepthM: 16.0,
      maxMezzanineOccupancyPerM2: 0.5,
      defaultBeamClearanceMm: 100,
      maxStorageUtilizationPct: 70,
      maxStagingUtilizationPct: 55,
      maxContinuousRackRowLengthM: 40.0,
      enforceUprightProtectors: true,
      mezzanineMinGuardrailHeightM: 1.1,
      mezzanineMinKickPlateHeightM: 0.1,
      mezzanineMinHeadroomM: 2.0,
      aisleWidths: {
        counterbalance: { min: 3.5, rec: 3.8 },
        reach: { min: 2.7, rec: 3.0 },
        vnaTurret: { min: 1.65, rec: 1.85 },
      },
    },
  },
  US: {
    id: 'US',
    name: 'United States Standards (NFPA 13 / OSHA 1910 / ANSI / WERC)',
    shortName: '🇺🇸 US (NFPA/OSHA)',
    region: 'United States',
    governingBodies: [
      'NFPA (National Fire Protection Association)',
      'OSHA (Occupational Safety and Health Administration)',
      'ANSI / RMI (Rack Manufacturers Institute)',
      'WERC (Warehousing Education and Research Council)',
    ],
    citations: {
      sprinkler:
        'NFPA 13 §20.6 / FM Global 8-9 (Min 18" [0.457m] standard, 36" [0.914m] ESFR/high challenge)',
      flueSpace:
        'NFPA 13 §20.6.3 / NFPA 230 (Continuous longitudinal & transverse flue space ≥ 3" [75mm])',
      aisles:
        'OSHA 1910.176(a) / ANSI B56.1 (Marked operating aisles, truck stacking clearance + 12"-20")',
      racking:
        'ANSI MH16.1 (RMI) / OSHA 1910.176 (Load capacity plaques, floor anchors, beam safety locks)',
      staging:
        'WERC Warehouse Benchmarks (Min 25.0 m² [270 sq ft]/dock, benchmark ≥ 35.0 m²)',
      mezzanine:
        'OSHA 1910.29 / IBC Chapter 10 (Guardrail 42" ± 3" [1.067m], Toeboard ≥ 3.5" [89mm], Headroom ≥ 7\' [2.134m])',
      floorUtilization: 'WERC & Lean Warehousing Benchmarks (Max 70% storage, 55% staging)',
      emergencyEgress:
        'OSHA 1910.36 / IBC Ch. 10 (Min 28" [0.71m] to 36" [0.914m], recommended 44" [1.12m])',
    },
    thresholds: {
      sprinklerClearanceM: 0.457, // 18 inches
      sprinklerHighHazardClearanceM: 0.914, // 36 inches
      minFlueSpaceM: 0.075, // 3 inches
      egressAisleMinClearM: 1.0,
      mainAisleMinClearM: 2.8,
      stagingAreaPerDockM2: 25.0,
      criticalStagingBufferDeficitM2: 25.0,
      minDockClearanceM: 2.5,
      dockApronDepthM: 14.0,
      maxMezzanineOccupancyPerM2: 0.4,
      defaultBeamClearanceMm: 75,
      maxStorageUtilizationPct: 70,
      maxStagingUtilizationPct: 55,
      maxContinuousRackRowLengthM: 45.7, // 150 feet
      enforceUprightProtectors: false,
      mezzanineMinGuardrailHeightM: 1.067, // 42 inches
      mezzanineMinKickPlateHeightM: 0.089, // 3.5 inches
      mezzanineMinHeadroomM: 2.134, // 7.0 feet
      aisleWidths: {
        counterbalance: { min: 3.5, rec: 3.8 },
        reach: { min: 2.7, rec: 3.0 },
        vnaTurret: { min: 1.65, rec: 1.85 },
      },
    },
  },
}

export const DEFAULT_STANDARD_ID: RegulatoryStandardId = 'TR'

export function getStandardProfile(id?: RegulatoryStandardId | null): RegulatoryStandardProfile {
  if (!id) return REGULATORY_STANDARDS[DEFAULT_STANDARD_ID]
  return REGULATORY_STANDARDS[id] ?? REGULATORY_STANDARDS[DEFAULT_STANDARD_ID]
}

export function getStandardThresholds(id?: RegulatoryStandardId | null): StandardThresholds {
  return getStandardProfile(id).thresholds
}
