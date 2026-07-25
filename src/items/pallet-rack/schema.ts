import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const PalletRackNode = BaseNode.extend({
  id: objectId('pallet_rack'),
  type: nodeType('warehouse:pallet-rack'),
  name: z.string().default('Pallet Rack'),                       // Friendly display name in outliner & inspector

  // Ensure position & rotation are always 3D tuple arrays [x, y, z] for useDraftNode compatibility
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z
    .union([
      z.tuple([z.number(), z.number(), z.number()]),
      z.number().transform((ry) => [0, ry, 0] as [number, number, number]),
    ])
    .default([0, 0, 0]),

  // Structural Dimensions & Tiers
  columns: z.number().int().min(1).max(20).default(1),           // Number of side-by-side connected bays
  levels: z.number().int().min(1).max(8).default(4),             // Shelf tiers
  tierHeight: z.number().positive().min(0.5).max(2.5).default(1.1), // Pitch height per level (meters)
  bayWidth: z.number().positive().min(1.0).max(5.0).default(2.7),  // Bay width per column (meters)
  depth: z.number().positive().min(0.6).max(2.5).default(1.1),     // Single rack depth (meters)
  uprightHeight: z.number().positive().min(1.5).max(12.0).default(4.5), // Total post height (meters)

  // Back-to-Back Double Row Configuration
  isBackToBack: z.boolean().default(false),                       // Twin back-to-back rack row layout
  rowSpacerDistance: z.number().min(0.1).max(1.0).default(0.3),  // Distance between twin rows (meters)

  // Beam Dimensions (Beams Kalınlığı, Yüksekliği)
  beamThickness: z.number().min(0.03).max(0.12).default(0.05),   // Beam thickness (meters)
  beamHeight: z.number().min(0.08).max(0.20).default(0.12),      // Beam profile height (meters)
  beamProfile: z.enum(['step-beam', 'box-beam']).default('step-beam'),

  // Upright Column Profile Dimensions (Upright Genişlik, Kalınlık, Derinlik)
  uprightWidth: z.number().min(0.06).max(0.16).default(0.08),    // Upright post width (meters)
  uprightThickness: z.number().min(0.06).max(0.16).default(0.08),// Upright post thickness (meters)
  bracingType: z.enum(['z-bracing', 'x-bracing', 'open']).default('z-bracing'), // Diagonal truss struts
  footplateType: z.enum(['heavy-duty', 'standard']).default('heavy-duty'),        // Base anchor shoes

  // Photorealistic Finish & Signage
  finishStyle: z.enum(['brand-new', 'industrial-satin', 'heavy-duty']).default('brand-new'),
  capacitySignage: z.boolean().default(true),                    // Vertical MAX LOAD warning plate on end frame
  showBarcodes: z.boolean().default(true),                       // Aisle/Bay location barcodes

  // Shelf Decking & Safety Options
  deckType: z.enum(['wire-mesh', 'wood', 'steel', 'open']).default('wire-mesh'),
  wireMeshDensity: z.enum(['dense-mesh', 'standard-mesh']).default('standard-mesh'),
  cornerProtectors: z.boolean().default(true),                  // Yellow upright base guards
  backMesh: z.boolean().default(false),                         // Rear safety wire mesh

  // Storage Cargo & Product Type Selection (Box, Pallet, Drums, Totes, Mixed, Empty)
  cargoType: z.enum(['pallet', 'box', 'drums', 'totes', 'mixed', 'empty']).default('pallet'),
  palletStyle: z.enum(['eur-pallet', 'industrial', 'mixed-crates']).default('eur-pallet'),
  cargoDistribution: z.enum(['random-realistic', 'heavy-bottom', 'full-uniform']).default('random-realistic'),
  fillRate: z.number().min(0).max(100).default(75),               // Cargo load fill percentage

  // Industrial Colors
  uprightColor: z.string().default('#1e40af'),                  // Blue upright frames
  beamColor: z.string().default('#f97316'),                     // Orange horizontal load beams
  hasPallets: z.boolean().default(true),
})

export type PalletRackNode = z.infer<typeof PalletRackNode>
