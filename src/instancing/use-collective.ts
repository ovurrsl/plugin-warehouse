'use client'

import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { useWarehouseStore } from '../store'
import {
  type InstanceTier,
  refreshInstance,
  registerInstance,
  setInstanceExcluded,
  unregisterInstance,
} from './collective'

export type CollectiveOptions = {
  nodeId: string
  objectRef: React.RefObject<THREE.Object3D | null>
  geometryFor: (tier: InstanceTier) => THREE.BufferGeometry
  keyFor: (tier: InstanceTier) => string
  materialFor: (tier: InstanceTier) => THREE.Material
  materialKeyFor: (tier: InstanceTier) => string
  farSq: number
  nearSq: number
  /** Kendi mesh'ini çizmesi gereken hâller: seçili ya da canlı sürükleniyor. */
  excluded: boolean
}

/**
 * Bir düğümü kolektif çiziciye kaydeder ve kendi mesh'ini çizip
 * çizmeyeceğini söyler.
 *
 * @returns `true` → düğüm KENDİ mesh'ini çizer (instancing kapalı, ya da
 *          seçili/sürükleniyor, ya da dışa aktarım). `false` → kolektif
 *          çiziyor, düğüm çizmemeli; iki kez çizerse z-savaşı olur.
 */
export function useCollective(options: CollectiveOptions): boolean {
  const enabled = useWarehouseStore((s) => s.instancingEnabled)
  const drawsSelf = !enabled || options.excluded

  // Değişen alanları ref'te tut: kayıt her renderda yeniden kurulmasın.
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    if (!enabled) return
    const object = latest.current.objectRef.current
    if (!object) return
    const current = latest.current
    registerInstance({
      nodeId: current.nodeId,
      object,
      geometryFor: current.geometryFor,
      keyFor: current.keyFor,
      materialFor: current.materialFor,
      materialKeyFor: current.materialKeyFor,
      farSq: current.farSq,
      nearSq: current.nearSq,
      excluded: current.excluded,
      tier: 'full',
    })
    return () => unregisterInstance(current.nodeId)
    // `nodeId` ve `enabled` dışındaki her şey ref üzerinden okunur — bir
    // renk değişimi kaydı yeniden kurmaz, yalnız bir sonraki yeniden
    // inşada yeni anahtarla toplanır.
  }, [enabled, options.nodeId])

  // Seçim/sürükleme: aynı değere set etmek sayacı artırmaz, her render
  // güvenle çağrılabilir.
  useEffect(() => {
    if (!enabled) return
    setInstanceExcluded(options.nodeId, options.excluded)
  }, [enabled, options.nodeId, options.excluded])

  /**
   * Şekil ya da materyal değişti — kayıt YERİNDE güncellenir.
   *
   * Silip yeniden kurmak düğümü bir kare boyunca hiç çizilmez bırakırdı:
   * eski kayıt gitmiş, yenisi henüz havuza toplanmamış olurdu.
   */
  // İki katmanın anahtarı da girer: yalnız `full`'e bakmak, uzak katmanın
  // materyali değişince kaydı tazelemeden bırakırdı.
  const shapeKey =
    `${options.keyFor('full')}::${options.materialKeyFor('full')}|` +
    `${options.keyFor('simple')}::${options.materialKeyFor('simple')}`
  useEffect(() => {
    if (!enabled) return
    const current = latest.current
    refreshInstance(current.nodeId, {
      geometryFor: current.geometryFor,
      keyFor: current.keyFor,
      materialFor: current.materialFor,
      materialKeyFor: current.materialKeyFor,
    })
  }, [enabled, shapeKey])

  return drawsSelf
}
