import { describe, expect, test } from 'bun:test'
import { PalletRackNode } from './schema'
import {
  directAccessSlotCount,
  formatIndustrialAddress,
  formatSlotAddress,
  letterToLevel,
  levelToLetter,
  palletSlotCount,
  palletSlotsOf,
  parseSlotAddress,
  pickingSlotsOf,
  slotById,
} from './slots'

describe('M1: Dynamic Slot Addressing & Industrial Formatting', () => {
  describe('level letter mapping', () => {
    test('maps 0-based level index to industrial letters A through F and beyond', () => {
      expect(levelToLetter(0)).toBe('A')
      expect(levelToLetter(1)).toBe('B')
      expect(levelToLetter(2)).toBe('C')
      expect(levelToLetter(3)).toBe('D')
      expect(levelToLetter(4)).toBe('E')
      expect(levelToLetter(5)).toBe('F')
      expect(levelToLetter(6)).toBe('G')
    })

    test('maps industrial letters back to 0-based level index', () => {
      expect(letterToLevel('A')).toBe(0)
      expect(letterToLevel('B')).toBe(1)
      expect(letterToLevel('C')).toBe(2)
      expect(letterToLevel('D')).toBe(3)
      expect(letterToLevel('E')).toBe(4)
      expect(letterToLevel('F')).toBe(5)
      expect(letterToLevel('G')).toBe(6)
      expect(letterToLevel('d')).toBe(3) // case insensitive
    })
  })

  describe('formatIndustrialAddress', () => {
    test('formats single-face single-deep slot address as A-02-D2', () => {
      const address = {
        row: 'A',
        bay: 2,
        level: 3,
        position: 2,
        depth: 1,
        aisle: 'A',
      }
      expect(formatIndustrialAddress(address)).toBe('A-02-D2')
    })

    test('formats single-face double-deep rear slot address with -2 suffix', () => {
      const address = {
        row: 'A',
        bay: 2,
        level: 3,
        position: 2,
        depth: 2,
        aisle: 'A',
      }
      expect(formatIndustrialAddress(address)).toBe('A-02-D2-2')
    })

    test('zero pads bay index to at least 2 digits', () => {
      expect(formatIndustrialAddress({ row: 'B', bay: 1, level: 0, position: 1, depth: 1, aisle: 'B' })).toBe('B-01-A1')
      expect(formatIndustrialAddress({ row: 'B', bay: 15, level: 1, position: 3, depth: 1, aisle: 'B' })).toBe('B-15-B3')
    })
  })

  describe('parseSlotAddress dual-format parser', () => {
    test('parses modern industrial format without depth suffix', () => {
      const parsed = parseSlotAddress('A-02-D2')
      expect(parsed).toEqual({
        row: 'A',
        bay: 2,
        level: 3,
        position: 2,
        depth: 1,
        aisle: 'A',
        levelLetter: 'D',
      })
    })

    test('parses modern industrial format with depth suffix', () => {
      const parsed = parseSlotAddress('A-02-D2-2')
      expect(parsed).toEqual({
        row: 'A',
        bay: 2,
        level: 3,
        position: 2,
        depth: 2,
        aisle: 'A',
        levelLetter: 'D',
      })
    })

    test('parses legacy format returning strictly 5 keys for backward compatibility', () => {
      const parsed = parseSlotAddress('R1-B2-L3-P4-D1')
      expect(parsed).toEqual({
        row: 1,
        bay: 2,
        level: 3,
        position: 4,
        depth: 1,
      })
      expect(Object.keys(parsed ?? {})).toEqual(['row', 'bay', 'level', 'position', 'depth'])
    })

    test('rejects malformed address strings', () => {
      expect(parseSlotAddress('')).toBeNull()
      expect(parseSlotAddress('INVALID-ADDR')).toBeNull()
      expect(parseSlotAddress('R1-B2')).toBeNull()
      expect(parseSlotAddress('A-2-D1')).toBeNull() // bay must be at least 2 digits
    })
  })

  describe('dynamic slot enumeration (eliminating hardcoded row 1, bay 1)', () => {
    test('named rack uses rowLabel and bayIndex in slot addresses', () => {
      const node = PalletRackNode.parse({
        rowLabel: 'C',
        bayIndex: 5,
        levels: 1,
      })
      const slots = palletSlotsOf(node)
      expect(slots.length).toBeGreaterThan(0)
      for (const slot of slots) {
        expect(slot.row).toBe('C')
        expect(slot.aisle).toBe('C')
        expect(slot.bay).toBe(5)
        expect(slot.id.startsWith('C-05-')).toBe(true)
      }
    })

    test('frontAisleLabel takes precedence over rowLabel when provided', () => {
      const node = PalletRackNode.parse({
        rowLabel: 'Row-Main',
        frontAisleLabel: 'A1',
        bayIndex: 3,
        levels: 1,
      })
      const slots = palletSlotsOf(node)
      for (const slot of slots) {
        expect(slot.row).toBe('A1')
        expect(slot.aisle).toBe('A1')
        expect(slot.bay).toBe(3)
        expect(slot.id.startsWith('A1-03-')).toBe(true)
      }
    })

    test('unnamed rack falls back to legacy R1-B1-L0-P1-D1 format', () => {
      const node = PalletRackNode.parse({
        rowLabel: '',
        frontAisleLabel: '',
        bayIndex: 1,
        levels: 1,
      })
      const slots = palletSlotsOf(node)
      for (const slot of slots) {
        expect(slot.id.startsWith('R1-B1-')).toBe(true)
      }
    })

    test('zoneCode propagates to slot objects when present', () => {
      const node = PalletRackNode.parse({
        rowLabel: 'A',
        bayIndex: 1,
        zoneCode: 'ZONE-NORTH',
        levels: 1,
      })
      const slots = palletSlotsOf(node)
      for (const slot of slots) {
        expect(slot.zoneCode).toBe('ZONE-NORTH')
      }
    })
  })

  describe('dual-facing bay logic & direct access engine', () => {
    test('both depth 1 and depth 2 have directAccess: true in dual-facing bays', () => {
      const dual = PalletRackNode.parse({
        accessMode: 'dual-facing',
        depthPositions: 2,
        frontAisleLabel: 'A',
        rearAisleLabel: 'B',
        bayIndex: 2,
        levels: 1,
      })
      const slots = palletSlotsOf(dual)
      expect(slots.length).toBeGreaterThan(0)
      for (const slot of slots) {
        expect(slot.directAccess).toBe(true)
      }
      expect(directAccessSlotCount(dual)).toBe(palletSlotCount(dual))
    })

    test('front beam slots face front aisle and rear beam slots face rear aisle', () => {
      const dual = PalletRackNode.parse({
        accessMode: 'dual-facing',
        depthPositions: 2,
        frontAisleLabel: 'A',
        rearAisleLabel: 'B',
        bayIndex: 2,
        levels: 1,
      })
      const slots = palletSlotsOf(dual)
      const frontSlots = slots.filter((s) => s.localPosition[2] > 0)
      const rearSlots = slots.filter((s) => s.localPosition[2] < 0)

      expect(frontSlots.length).toBe(rearSlots.length)
      expect(frontSlots.length).toBeGreaterThan(0)

      for (const slot of frontSlots) {
        expect(slot.row).toBe('A')
        expect(slot.aisle).toBe('A')
        expect(slot.id.startsWith('A-02-')).toBe(true)
        expect(slot.directAccess).toBe(true)
      }
      for (const slot of rearSlots) {
        expect(slot.row).toBe('B')
        expect(slot.aisle).toBe('B')
        expect(slot.id.startsWith('B-02-')).toBe(true)
        expect(slot.directAccess).toBe(true)
      }
    })

    test('single-face double-deep preserves directAccess: false for depth 2', () => {
      const single = PalletRackNode.parse({
        accessMode: 'single-face',
        depthPositions: 2,
        levels: 1,
      })
      for (const slot of palletSlotsOf(single)) {
        expect(slot.directAccess).toBe(slot.depth === 1)
      }
      expect(directAccessSlotCount(single)).toBe(palletSlotCount(single) / 2)
    })

    test('picking slots in dual-facing mode resolve front and rear aisles correctly', () => {
      const dualPicking = PalletRackNode.parse({
        accessMode: 'dual-facing',
        frontAisleLabel: 'A',
        rearAisleLabel: 'B',
        bayIndex: 4,
        levels: 2,
        pickingLevels: 2,
      })
      const slots = pickingSlotsOf(dualPicking)
      expect(slots.length).toBeGreaterThan(0)
      const frontSlots = slots.filter((s) => s.localPosition[2] > 0)
      const rearSlots = slots.filter((s) => s.localPosition[2] < 0)

      for (const slot of frontSlots) {
        expect(slot.row).toBe('A')
        expect(slot.id.startsWith('A-04-')).toBe(true)
        expect(slot.directAccess).toBe(true)
      }
      for (const slot of rearSlots) {
        expect(slot.row).toBe('B')
        expect(slot.id.startsWith('B-04-')).toBe(true)
        expect(slot.directAccess).toBe(true)
      }
    })
  })

  describe('slot address bijection & slotById lookup integrity', () => {
    test('formatSlotAddress(slot) === slot.id strictly holds for all slots in dual-facing mode', () => {
      const dual = PalletRackNode.parse({
        id: 'pallet_rack_dual_bijection',
        accessMode: 'dual-facing',
        depthPositions: 2,
        rowLabel: 'A',
        rearAisleLabel: 'B',
        bayIndex: 1,
        levels: 2,
      })
      const slots = palletSlotsOf(dual)
      expect(slots.length).toBeGreaterThan(0)
      for (const slot of slots) {
        expect(formatSlotAddress(slot)).toBe(slot.id)
        expect(slotById(dual, formatSlotAddress(slot))).toBe(slot)
        expect(slotById(dual, slot.id)).toBe(slot)

        const parsed = parseSlotAddress(slot.id)
        expect(parsed).not.toBeNull()
        expect(parsed?.depth).toBe(slot.depth)
        expect(parsed?.aisle).toBe(slot.aisle)
        expect(parsed?.bay).toBe(slot.bay)
        expect(parsed?.level).toBe(slot.level)
        expect(parsed?.position).toBe(slot.position)
      }
    })

    test('formatSlotAddress(slot) === slot.id holds for single-face double-deep racks', () => {
      const single = PalletRackNode.parse({
        id: 'pallet_rack_single_bijection',
        accessMode: 'single-face',
        depthPositions: 2,
        rowLabel: 'A',
        bayIndex: 2,
        levels: 2,
      })
      const slots = palletSlotsOf(single)
      for (const slot of slots) {
        expect(formatSlotAddress(slot)).toBe(slot.id)
        expect(slotById(single, formatSlotAddress(slot))).toBe(slot)
        if (slot.bayDepth === 2) {
          expect(slot.id.endsWith('-2')).toBe(true)
          expect(slot.depth).toBe(2)
        } else {
          expect(slot.id.endsWith('-2')).toBe(false)
          expect(slot.depth).toBe(1)
        }
      }
    })

    test('slotById successfully retrieves picking slots as well as pallet slots', () => {
      const mixed = PalletRackNode.parse({
        id: 'pallet_rack_mixed_lookup',
        accessMode: 'dual-facing',
        rowLabel: 'C',
        rearAisleLabel: 'D',
        bayIndex: 1,
        levels: 2,
        pickingLevels: 1,
      })
      const palletSlots = palletSlotsOf(mixed)
      const pickingSlots = pickingSlotsOf(mixed)

      for (const slot of palletSlots) {
        expect(slotById(mixed, slot.id)).toBe(slot)
        expect(formatSlotAddress(slot)).toBe(slot.id)
      }
      for (const slot of pickingSlots) {
        expect(slotById(mixed, slot.id)).toBe(slot)
        expect(formatSlotAddress(slot)).toBe(slot.id)
      }
    })

    test('multi-deep picking shelves (depth > 2) generate unique IDs and symmetric depth partitions without collision', () => {
      const rack = PalletRackNode.parse({
        id: 'pallet_rack_picking_multideep',
        accessMode: 'dual-facing',
        frontAisleLabel: 'A',
        rearAisleLabel: 'B',
        bayIndex: 1,
        pickingLevels: 1,
        levels: 1,
        depth: 1.5,
        pickingBoxDepth: 0.3,
      })

      const slots = pickingSlotsOf(rack)
      expect(slots.length).toBe(16)
      // Invariant 1: Zero duplicate IDs
      expect(new Set(slots.map((s) => s.id)).size).toBe(16)

      // Invariant 2: Bidirectional address format equality & lookup
      for (const slot of slots) {
        expect(formatSlotAddress(slot)).toBe(slot.id)
        expect(slotById(rack, slot.id)).not.toBeNull()
        expect(slotById(rack, formatSlotAddress(slot))).not.toBeNull()
      }

      // Invariant 3: Direct access only for outermost positions (depth === 1)
      const directSlots = slots.filter((s) => s.directAccess)
      expect(directSlots.length).toBe(8)
      for (const slot of directSlots) {
        expect(slot.depth).toBe(1)
      }

      const nonDirectSlots = slots.filter((s) => !s.directAccess)
      expect(nonDirectSlots.length).toBe(8)
      for (const slot of nonDirectSlots) {
        expect(slot.depth).toBe(2)
      }
    })
  })
})
