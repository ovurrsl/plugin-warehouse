import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'
import { getRackUprightTexture } from './upright-texture'

/**
 * One material for every rack in the scene.
 *
 * Part colours ride in the geometry's vertex colour attribute, so blue
 * uprights, orange beams and galvanised shelves all draw from this single
 * instance. The version being replaced wrote `<meshStandardMaterial>` inline on
 * each part, which meant a 10-bay rack minted about 250 materials and a
 * warehouse minted hundreds of thousands — every one a separate uniform upload,
 * and none of them ever disposed.
 *
 * **Tek örnek "sahne başına" değil, "ayar başına".** Host'un Display menüsü
 * materyali değiştirerek çalışıyor (Render: Solid/Rendered, Textures, Theme),
 * ve bu paket onu okumadığı için depo ekipmanı bütün bina düzleşirken PBR
 * kalıyordu. `surfaceMaterial` çözümü tek yerde yapıyor ve önbelleği aile ×
 * ayar başına tutuyor: tavan altı örnek, düğüm sayısından bağımsız.
 */

function spec() {
  return {
    family: 'rack',
    // A two-column atlas: blank for most parts, the punched slot pattern for
    // the upright faces. The geometry picks a column per part through its UVs,
    // which is what lets the perforations exist without a second material — and
    // so without a second draw call on every rack in the warehouse.
    map: getRackUprightTexture(),
    vertexColors: true,
    // Racking is powder-coated steel, not bare metal. The earlier version used
    // metalness 0.75 with a flat colour, which is wrong twice: painted steel is
    // a dielectric, and a near-metal surface with no environment map to reflect
    // renders close to black. These values read as paint under any lighting.
    metalness: 0.15,
    roughness: 0.55,
  }
}

export function getRackMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(spec(), appearance)
}

/**
 * The ghost shown while placing. A separate cached instance rather than a
 * mutated clone: the real material is a module singleton, so setting
 * `transparent` on it would make every committed rack in the scene translucent.
 */
export function getRackPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(spec(), appearance)
}
