/**
 * Sarmal (spiral) konveyör kat seviyesi ve dinamik yükseliş çözümü.
 *
 * Host merdiven (`systems/stair/stair-rise.ts`) ve asansör (`systems/elevator/elevator-service.ts`)
 * mimarisini aynalar.
 *
 * Bina katlarının yükseklik ve kotları (`levelElevationsOfBuilding` / `getLevelFloorToFloorHeight`)
 * değiştikçe sarmalın seyahat yüksekliği (`travelHeight` / rise) dinamik olarak yeniden hesaplanır.
 */

import {
  buildingOfLevel,
  type LevelLike,
  levelElevationsOfBuilding,
  levelsOfBuilding,
  parentLevelIdOf,
} from '../host-adapter'
import type { ConveyorSpiralNode } from './spiral-schema'

/**
 * Sarmal konveyörün bağlandığı binanın katlarını ordinal sırasıyla listeler.
 */
export function resolveSpiralBuildingLevels(
  nodes: Readonly<Record<string, unknown>>,
  node: ConveyorSpiralNode,
): LevelLike[] {
  const fromId = node.fromLevelId ?? node.baseLevelId ?? parentLevelIdOf(nodes, node)
  const toId = node.toLevelId ?? node.topLevelId
  const buildingId = buildingOfLevel(nodes, fromId) ?? (toId ? buildingOfLevel(nodes, toId) : null)
  return levelsOfBuilding(nodes, buildingId)
}

/**
 * Sarmal konveyörün toplam dikey yükselişini (rise / travelHeight) dinamik olarak çözer.
 *
 * `fromLevelId` (veya `baseLevelId` / parentLevelId) ve `toLevelId` (veya `topLevelId`)
 * tanımlıysa, bina kat kotları arasındaki fark (`toEntry.baseY - fromEntry.baseY`) hesaplanır.
 * Tanımlı değilse veya bina dışındaysa güvenle `node.travelHeight` değerine düşer.
 */
export function resolveSpiralRise(
  nodes: Readonly<Record<string, unknown>>,
  node: ConveyorSpiralNode,
): number {
  return resolveSpiralHeight(node, nodes)
}

/**
 * `resolveSpiralRise` için PROJECT.md sözleşme arayüzü:
 * `resolveSpiralHeight(node, nodes)`.
 */
export function resolveSpiralHeight(
  node: ConveyorSpiralNode,
  nodes?: Readonly<Record<string, unknown>>,
): number {
  if (!nodes) return node.travelHeight ?? 4

  const fromId = node.fromLevelId ?? node.baseLevelId ?? parentLevelIdOf(nodes, node)
  const toId = node.toLevelId ?? node.topLevelId

  if (fromId && toId) {
    const buildingId = buildingOfLevel(nodes, fromId) ?? buildingOfLevel(nodes, toId)
    const elevations = levelElevationsOfBuilding(nodes, buildingId)
    const fromEntry = elevations.find((e) => e.id === fromId)
    const toEntry = elevations.find((e) => e.id === toId)

    if (fromEntry && toEntry) {
      const rise = Math.abs(toEntry.baseY - fromEntry.baseY)
      if (rise > 0) return rise
    }
  }

  return node.travelHeight ?? 4
}

/**
 * Bina katlarının parmak izi — renderer ve UI seçicileri bunu dinleyip
 * kat yüksekliği veya kotu değiştiğinde geometriyi ve 3D yüksekliği anında günceller.
 */
export function spiralLevelFingerprint(
  nodes: Readonly<Record<string, unknown>>,
  node: ConveyorSpiralNode,
): string {
  const fromId = node.fromLevelId ?? node.baseLevelId ?? parentLevelIdOf(nodes, node)
  const toId = node.toLevelId ?? node.topLevelId
  const buildingId = buildingOfLevel(nodes, fromId) ?? (toId ? buildingOfLevel(nodes, toId) : null)
  const levels = levelsOfBuilding(nodes, buildingId)
  const parts = levels.map((l) => `${l.id}:${l.level}:${l.height ?? ''}:${l.baseElevation ?? ''}`)

  return [buildingId ?? '-', fromId ?? '-', toId ?? '-', node.travelHeight ?? 4, ...parts].join('|')
}
