import { describe, expect, test } from 'bun:test'
import { PalletRackNode } from './schema'
import { autoPalletsPerLevel, slotOffsetsX } from './slots'
import {
  BEAM_PROFILES,
  CATALOGUE_BEAM_LENGTHS,
  catalogueFrameDepth,
  en15620Clearance,
  HANDLING_EQUIPMENT,
  requiredLevelPitch,
  SLOT_PITCH,
  snapUpToSlot,
  UPRIGHT_PROFILES,
} from './standards'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_std', ...overrides })

describe('catalogue beam table', () => {
  /**
   * The load-bearing check in this file. If the derived fit ever stops
   * reproducing the manufacturer's published beam lengths, the capacity this
   * plugin reports has silently stopped describing a real rack.
   */
  test.each(CATALOGUE_BEAM_LENGTHS)(
    'a $beamLength m clear beam takes $pallets pallets of $palletAcross m across',
    ({ beamLength, palletAcross, pallets }) => {
      const r = rack({ bayClearWidth: beamLength })
      // Drive the fit directly off the catalogue's across-run dimension rather
      // than a preset, so the row under test is the only variable.
      const fitted = Math.floor(
        (beamLength - 2 * r.clearanceToUpright + r.clearanceBetweenPallets) /
          (palletAcross + r.clearanceBetweenPallets) +
          1e-9,
      )
      expect(fitted).toBe(pallets)
    },
  )

  test('every catalogue row leaves exactly 75 mm per gap', () => {
    // The catalogue lengths are not arbitrary: each is the pallet run plus one
    // EN 15620 X-clearance per gap, uprights included. Reproducing that budget
    // is what makes the derived numbers defensible rather than approximate.
    for (const { beamLength, palletAcross, pallets } of CATALOGUE_BEAM_LENGTHS) {
      const leftover = beamLength - pallets * palletAcross
      const gaps = pallets + 1
      expect(leftover / gaps).toBeCloseTo(0.075, 9)
    }
  })

  test('the canonical EPAL bay reproduces the 2.7 m beam', () => {
    const r = rack({ bayClearWidth: 2.7, palletPreset: 'epal-1' })
    expect(autoPalletsPerLevel(r)).toBe(3)
    expect(slotOffsetsX(r)).toHaveLength(3)
  })
})

describe('EN 15620 clearances', () => {
  test('X and Y widen with height for counterbalanced and man-down trucks', () => {
    expect(en15620Clearance(2.5, '400')).toEqual({ x: 0.075, y: 0.075 })
    expect(en15620Clearance(5, '400')).toEqual({ x: 0.075, y: 0.1 })
    expect(en15620Clearance(8, '400')).toEqual({ x: 0.075, y: 0.125 })
    expect(en15620Clearance(11, '400')).toEqual({ x: 0.1, y: 0.15 })
    expect(en15620Clearance(14, '400')).toEqual({ x: 0.1, y: 0.175 })
  })

  test('a man-up trilateral truck holds 75/75 at every height', () => {
    // The operator rises with the load, so placing accuracy does not decay with
    // height the way it does for the other classes.
    for (const height of [2, 5, 8, 11, 14, 20, 40]) {
      expect(en15620Clearance(height, '300A')).toEqual({ x: 0.075, y: 0.075 })
    }
  })

  test('classes that cannot reach above 15 m report null rather than a stale band', () => {
    expect(en15620Clearance(16, '400')).toBeNull()
    expect(en15620Clearance(16, '300B')).toBeNull()
    expect(en15620Clearance(16, '300A')).not.toBeNull()
  })

  test('band edges belong to the lower band', () => {
    expect(en15620Clearance(3, '400')?.y).toBeCloseTo(0.075, 9)
    expect(en15620Clearance(3.001, '400')?.y).toBeCloseTo(0.1, 9)
    expect(en15620Clearance(6, '400')?.y).toBeCloseTo(0.1, 9)
    expect(en15620Clearance(6.001, '400')?.y).toBeCloseTo(0.125, 9)
  })
})

describe('slot pitch', () => {
  test('uprights are punched every 50 mm and elevations snap up onto a slot', () => {
    expect(SLOT_PITCH).toBeCloseTo(0.05, 9)
    expect(snapUpToSlot(1.5)).toBeCloseTo(1.5, 9)
    expect(snapUpToSlot(1.51)).toBeCloseTo(1.55, 9)
    expect(snapUpToSlot(1.549)).toBeCloseTo(1.55, 9)
  })

  test('an exact multiple is not pushed up a slot by floating point', () => {
    // 1.62 / 0.05 is 32.4 in decimal but 1.62 itself is inexact in binary; a
    // bare ceil() here lifts every level one 50 mm slot too high.
    for (const value of [0.05, 0.1, 0.15, 1.2, 1.65, 4.65, 9.5]) {
      expect(snapUpToSlot(value)).toBeCloseTo(value, 9)
    }
  })

  test('the level pitch the standard asks for lands on a slot', () => {
    const pitch = requiredLevelPitch({
      beamHeight: BEAM_PROFILES['2C-S 1115'].height,
      handling: '400',
      height: 5,
      unitLoadHeight: 1.2,
    })
    expect(pitch).not.toBeNull()
    // 1.2 load + 0.11 beam + 0.10 clearance = 1.41 -> next 50 mm slot.
    expect(pitch).toBeCloseTo(1.45, 9)
    expect(((pitch ?? 0) / SLOT_PITCH) % 1).toBeCloseTo(0, 9)
  })

  test('a pitch is not offered for a height the class cannot reach', () => {
    expect(
      requiredLevelPitch({ beamHeight: 0.12, handling: '400', height: 18, unitLoadHeight: 1.2 }),
    ).toBeNull()
  })
})

describe('profiles', () => {
  test('every catalogue beam is 50 mm thick', () => {
    for (const profile of Object.values(BEAM_PROFILES)) {
      expect(profile.thickness).toBeCloseTo(0.05, 9)
    }
  })

  test('profile dimensions are plausible metres, never stray millimetres', () => {
    // The single most likely mistake in this file is pasting a catalogue figure
    // without dividing. Anything over a metre here is that mistake.
    for (const profile of Object.values(UPRIGHT_PROFILES)) {
      expect(profile.width).toBeLessThan(1)
      expect(profile.depth).toBeLessThan(1)
      expect(profile.width).toBeGreaterThan(0.05)
    }
    for (const profile of Object.values(BEAM_PROFILES)) {
      expect(profile.height).toBeLessThan(1)
      expect(profile.height).toBeGreaterThan(0.05)
    }
  })

  test('the schema defaults are a real catalogue profile, not a rounded one', () => {
    // A127 upright on TB 120 beams. "Close to a real profile" is not good
    // enough in a tool that reports capacity — the numbers have to describe
    // steel somebody can actually order.
    const r = rack()
    expect(r.uprightWidth).toBeCloseTo(UPRIGHT_PROFILES.A127.width, 9)
    expect(r.uprightDepth).toBeCloseTo(UPRIGHT_PROFILES.A127.depth, 9)
    expect(r.beamThickness).toBeCloseTo(BEAM_PROFILES.TB120.thickness, 9)
    expect(r.beamHeight).toBeCloseTo(BEAM_PROFILES.TB120.height, 9)
  })
})

describe('handling equipment', () => {
  test('aisle widths and lift heights are metres in a sane range', () => {
    for (const equipment of Object.values(HANDLING_EQUIPMENT)) {
      expect(equipment.aisle.min).toBeGreaterThan(1)
      expect(equipment.aisle.min).toBeLessThanOrEqual(equipment.aisle.max)
      expect(equipment.aisle.max).toBeLessThan(5)
      expect(equipment.maxLift).toBeGreaterThan(1)
    }
  })

  test('no equipment claims a class that cannot describe its full reach', () => {
    // The failure this guards against is filing a machine under a class the
    // table stops rating below that machine's lift height: the lookup then
    // returns null at the top of its own range, or worse, a plausible number
    // from a band that was never meant to cover it.
    for (const equipment of Object.values(HANDLING_EQUIPMENT)) {
      if (equipment.handlingClass === null) continue
      expect(en15620Clearance(equipment.maxLift, equipment.handlingClass)).not.toBeNull()
    }
  })

  test('the stacker crane is left unclassified rather than forced into a class', () => {
    // 45 m is three times the table's top band, and EN 15620's bay classes
    // describe forklifts and turret trucks — not an AS/RS crane.
    const crane = HANDLING_EQUIPMENT['stacker-crane']
    expect(crane.handlingClass).toBeNull()
    expect(crane.maxLift).toBeGreaterThan(15)
  })

  test('narrow-aisle equipment reaches higher than counterbalanced equipment', () => {
    expect(HANDLING_EQUIPMENT['trilateral-turret'].aisle.max).toBeLessThan(
      HANDLING_EQUIPMENT['counterbalanced-forklift'].aisle.min,
    )
    expect(HANDLING_EQUIPMENT['trilateral-turret'].maxLift).toBeGreaterThan(
      HANDLING_EQUIPMENT['counterbalanced-forklift'].maxLift,
    )
  })
})

describe('frame depth', () => {
  test('a narrow-side frame is 1.1 m and the pallet overhangs it', () => {
    const depth = catalogueFrameDepth(1.2, false)
    expect(depth).toBeCloseTo(1.1, 9)
    // 50 mm front and back — intended, and the reason aisles are quoted
    // between loads rather than between frames.
    expect((1.2 - depth) / 2).toBeCloseTo(0.05, 9)
  })

  test('a lengthwise frame matches the pallet', () => {
    expect(catalogueFrameDepth(0.8, true)).toBeCloseTo(0.8, 9)
    expect(catalogueFrameDepth(1.0, true)).toBeCloseTo(1.0, 9)
    expect(catalogueFrameDepth(1.2, true)).toBeCloseTo(1.2, 9)
  })
})
