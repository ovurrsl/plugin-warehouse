'use client'

import { SliderControl } from '@pascal-app/editor'
import { Note } from '../panels/kit'
import { moduleLengthM, rollerPitchM, rollerPitchMm } from './metrics'
import type { ConveyorRollerNode } from './schema'

/**
 * Yatak uzunluğu — TEK kontrol, metre cinsinden.
 *
 * ## Neden custom alan
 *
 * Uzunluk iki yerden, iki birimden ayarlanıyordu: `Bed` grubunda `rollers`
 * (adet), trailing panelde ise metre kutusu. İkisi aynı sayıyı yönetiyordu ve
 * hangisinin diğerini nasıl etkilediği yalnız `moduleLengthM`'in gövdesinde
 * yazıyordu. Kullanıcının "içi içe giren ayarlar" dediği şeyin konveyördeki
 * hâli buydu.
 *
 * Kalan tek kontrol metre, çünkü bir konveyör metreyle sipariş edilir. Makara
 * sayısı düğümde saklanmaya devam ediyor — yatak fiziksel olarak odur, ve
 * metre cinsinden bir slider'ın her adımda yeni bir geometri basmasını
 * engelleyen de odur.
 *
 * ## Neden metreye yuvarlanmıyor, makaraya yuvarlanıyor
 *
 * 6 m istemek 75 mm hatvede tam 6.000 m veriyor; 6.1 m istemek 6.075 m veriyor
 * — yatağın gerçekten olabileceği en yakın uzunluk. Panel neye yerleştiğini
 * yazıyor, böylece yuvarlama sessiz değil görünür oluyor.
 */
export const BED_ROLLER_BOUNDS = { min: 27, max: 200 } as const

export function BedLengthField({
  node,
  onUpdate,
}: {
  node: ConveyorRollerNode
  onUpdate: (patch: Partial<ConveyorRollerNode>) => void
}) {
  const pitch = rollerPitchM(node)
  return (
    <>
      <SliderControl
        label="Bed length"
        max={BED_ROLLER_BOUNDS.max * pitch}
        min={BED_ROLLER_BOUNDS.min * pitch}
        onChange={(metres) =>
          onUpdate({
            rollers: Math.max(
              BED_ROLLER_BOUNDS.min,
              Math.min(BED_ROLLER_BOUNDS.max, Math.round(metres / pitch)),
            ),
          })
        }
        precision={3}
        step={pitch}
        unit="m"
        value={moduleLengthM(node)}
      />
      <Note>
        {node.rollers} makara @ {rollerPitchMm(node)} mm — yatak bir makara katına yuvarlanır
      </Note>
    </>
  )
}
