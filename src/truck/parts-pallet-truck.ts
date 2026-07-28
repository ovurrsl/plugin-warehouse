/**
 * Transpalet gövdeleri — manuel (mpt) ve elektrikli (ept), tek emitter.
 *
 * İki makine aynı anatomiyi paylaşır — başlık + iki geniş çatal + yük
 * makaraları + kol — ve farkları tamamen yayınlanmış satırlardan çıkar:
 * başlık boyu l2 (0.380 ↔ 0.989), çatal kesiti s/e (38/150 ↔ 56/172),
 * indirilmiş çatal kotu h13 (0.051 ↔ 0.085), kol tepesi h14, iz genişlikleri
 * b10/b11. `ept` ayrıca operatör platformu ve sürüş kaportası taşır.
 *
 * Boyuna yerleşim: çatal ucu +l1/2 (zincir `l1 = l2 + çatal` her iki satırda
 * kapanıyor), başlık arka yüzden l2 kadar. Tekerlek çapları spec sheet'in
 * lastik satırından — VDI satırı değil, yalnız görsel.
 */

import type { TruckModel } from '../handling/models'
import { forkSpreadM } from './metrics'
import {
  GROUND_CLEARANCE,
  pushWheel,
  type TruckBody,
  type TruckDetail,
  type TruckPart,
} from './parts'

// Spec sheet lastik satırları (görsel): AM ön Ø170×50 / arka Ø50×70;
// ERE tahrik Ø230×77, destek Ø140×57, yük Ø85×110.
const MPT_STEER = { diameter: 0.17, width: 0.05 }
const MPT_ROLLER = { diameter: 0.05, width: 0.07 }
const EPT_DRIVE = { diameter: 0.23, width: 0.077 }
const EPT_SUPPORT = { diameter: 0.14, width: 0.057 }
const EPT_ROLLER = { diameter: 0.085, width: 0.11 }

export function palletTruckParts(
  model: TruckModel,
  body: TruckBody,
  detail: TruckDetail,
): TruckPart[] {
  const powered = model.variant === 'powered-pallet'
  const halfL = model.l1 / 2
  const rearX = -halfL
  const faceX = rearX + model.l2
  const { s, e, length } = model.fork
  const spread = forkSpreadM(model)
  const centerZ = (spread - e) / 2
  const forkTopY = model.h13 ?? 0.06
  const h14Top = typeof model.h14 === 'number' ? model.h14 : (model.h14?.[1] ?? 1.2)
  const rollerTrackZ = (model.b11 ?? spread * 0.55) / 2
  const parts: TruckPart[] = []

  switch (body) {
    case 'chassis': {
      if (powered) {
        // Sürüş kaportası: batarya + motor, başlığın ön yarısı.
        const hoodRear = rearX + 0.46
        parts.push({
          role: 'chassis',
          center: [(hoodRear + faceX) / 2, 0.55, 0],
          size: [faceX - hoodRear, 1.0, model.b1 - 0.03],
        })
        // Operatör platformu: en arkada, basamak kotunda (0.202).
        parts.push({
          role: 'platform',
          center: [(rearX + hoodRear) / 2, 0.21, 0],
          size: [hoodRear - rearX, 0.05, model.b1 - 0.06],
        })
        if (detail === 'full') {
          // Kaporta sırtı + yan korkuluklar + şarj kapağı.
          parts.push({
            role: 'cowl',
            center: [faceX - 0.12, 1.12, 0],
            size: [0.24, 0.14, model.b1 - 0.12],
          })
          // Yan korkuluklar kaporta kabuğunun İÇİNDE biter (T20: zarf
          // genişliği katmanla değişmez).
          for (const side of [-1, 1] as const) {
            parts.push({
              role: 'platform',
              center: [(rearX + hoodRear) / 2, 0.5, side * (model.b1 / 2 - 0.035)],
              size: [hoodRear - rearX - 0.06, 0.55, 0.04],
            })
          }
          parts.push({
            role: 'chassis',
            center: [hoodRear + 0.1, 0.95, 0],
            size: [0.18, 0.06, model.b1 - 0.2],
          })
        }
        // Destek tekerleri kaportanın altında iki yanda.
        for (const side of [-1, 1] as const) {
          pushWheel(parts, {
            x: rearX + 0.62,
            z: side * (model.b1 / 2 - 0.1),
            ...EPT_SUPPORT,
            detail,
          })
        }
      } else {
        // Manuel başlık: pompa gövdesi — dar, merkezde.
        parts.push({
          role: 'chassis',
          center: [(rearX + faceX) / 2, 0.26, 0],
          size: [model.l2, 0.36, 0.3],
        })
        if (detail === 'full') {
          // Pompa silindiri + indirme kolu.
          parts.push({
            role: 'chassis',
            center: [rearX + 0.16, 0.5, 0],
            size: [0.12, 0.14, 0.16],
          })
          parts.push({
            role: 'tiller',
            center: [rearX + 0.1, 0.4, 0.12],
            size: [0.16, 0.03, 0.03],
          })
        }
      }

      // Çatallar: geniş transpalet kesiti, üst yüz tam h13'te.
      for (const side of [-1, 1] as const) {
        const z = side * centerZ
        if (detail === 'full') {
          parts.push({
            role: 'fork',
            center: [faceX + (length - 0.12) / 2, forkTopY - s / 2, z],
            size: [length - 0.12, s, e],
          })
          // Burun: makara üstüne inen eğik uç — yarı kalınlık.
          parts.push({
            role: 'fork',
            center: [faceX + length - 0.06, forkTopY - s * 0.75, z],
            size: [0.12, s / 2, e],
          })
          // Topuk plakası başlığa bağlar.
          parts.push({
            role: 'fork',
            center: [faceX + 0.04, forkTopY / 2, z],
            size: [0.08, forkTopY, e],
          })
        } else {
          parts.push({
            role: 'fork',
            center: [faceX + length / 2, forkTopY - s / 2, z],
            size: [length, s, e],
          })
        }
      }

      // Yük makaraları çatal burnunun altında — tandem çift (4 adet, iki
      // katmanda da: tekerlek sayısı katmanla değişmez).
      const roller = powered ? EPT_ROLLER : MPT_ROLLER
      for (const side of [-1, 1] as const) {
        for (const dx of [-0.09, 0.09]) {
          pushWheel(parts, {
            x: faceX + length - 0.22 + dx,
            z: side * rollerTrackZ,
            ...roller,
            detail,
          })
        }
      }
      return parts
    }

    case 'steer': {
      if (powered) {
        // Tek tahrik tekeri, başlığın altında merkezde.
        pushWheel(parts, { x: rearX + 0.35, z: 0, ...EPT_DRIVE, detail })
      } else {
        // İkiz dümen tekeri — b10 = 0.109 yayınlanmış iz.
        const twinZ = ((model.b10 ?? 0.109) + MPT_STEER.width) / 2
        pushWheel(parts, { x: rearX + 0.17, z: twinZ, ...MPT_STEER, detail })
        pushWheel(parts, { x: rearX + 0.17, z: -twinZ, ...MPT_STEER, detail })
      }
      // Kol: YATIK kiriş — dik kolon transpaleti süpürgeye çevirir; gerçek
      // kol arkaya yatar ve tepesi tam h14'te biter. İki katmanda da durur.
      const columnBaseX = powered ? rearX + 0.72 : rearX + 0.3
      const columnTopX = powered ? rearX + 0.4 : rearX + 0.08
      const columnBaseY = powered ? 1.0 : 0.4
      parts.push({
        kind: 'beam',
        role: 'tiller',
        from: [columnBaseX, columnBaseY],
        to: [columnTopX, h14Top - 0.06],
        z: 0,
        thickness: 0.055,
        width: 0.07,
      })
      parts.push({
        role: 'tiller',
        center: [columnTopX, h14Top - 0.03, 0],
        size: [0.06, 0.06, powered ? 0.5 : 0.42],
      })
      if (detail === 'full') {
        // Kulp uçları — tutamağın İÇİNDE kalır: zarf genişliği katmanla
        // değişemez (T20).
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'tiller',
            center: [columnTopX, h14Top - 0.08, side * (powered ? 0.22 : 0.18)],
            size: [0.05, 0.12, 0.04],
          })
        }
      }
      return parts
    }

    default:
      return parts
  }
}

export { GROUND_CLEARANCE }
