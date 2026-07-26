import { describe, expect, test } from 'bun:test'
import { palletRackParametrics } from './parametrics'
import { PalletRackNode } from './schema'

/**
 * The inspector against the schema.
 *
 * A `ParamField` is a *claim about a schema field* — this key exists, it is a
 * number, it ranges from min to max. Nothing checks that claim at build time:
 * the descriptor is plain data and the host renders whatever it is handed. So a
 * field can name a key that no longer exists, declare a range the schema
 * refuses, or offer an enum option the schema rejects, and the only symptom is
 * a control that silently does nothing when you drag it.
 *
 * These tests are the check. They are behavioural rather than introspective —
 * they push values through `PalletRackNode.parse` — so they test the contract
 * the user actually meets rather than zod's internal shape.
 */

const shape = PalletRackNode.shape as Record<
  string,
  { safeParse: (v: unknown) => { success: boolean } }
>
const fields = palletRackParametrics.groups.flatMap((group) =>
  group.fields.map((field) => ({ group: group.label, field })),
)

/** A rack with one field replaced, parsed. Throws if the schema refuses. */
const withField = (key: string, value: unknown) =>
  PalletRackNode.parse({ id: 'pallet_rack_param', [key]: value })

describe('every inspector field names a real schema field', () => {
  test('and there are no orphans', () => {
    for (const { group, field } of fields) {
      const key = String(field.key)
      expect({ group, key, exists: key in shape }).toEqual({ group, key, exists: true })
    }
  })
})

describe('number fields', () => {
  const numbers = fields.filter(({ field }) => field.kind === 'number')

  test('accept their own declared min and max', () => {
    for (const { field } of numbers) {
      const key = String(field.key)
      const { min, max } = field as { min?: number; max?: number }
      if (min !== undefined) {
        expect({ key, bound: 'min', ok: shape[key]?.safeParse(min).success }).toEqual({
          key,
          bound: 'min',
          ok: true,
        })
      }
      if (max !== undefined) {
        expect({ key, bound: 'max', ok: shape[key]?.safeParse(max).success }).toEqual({
          key,
          bound: 'max',
          ok: true,
        })
      }
    }
  })

  test("declare the schema's own bounds, not a narrower or wider pair", () => {
    // A slider that stops short of what the schema allows hides settings; one
    // that goes past it produces a value the schema rejects, and the write is
    // simply dropped — the control moves and nothing happens.
    for (const { field } of numbers) {
      const key = String(field.key)
      const { min, max, step } = field as { min?: number; max?: number; step?: number }
      const nudge = (step ?? 0.01) / 2
      if (min !== undefined) {
        expect({ key, belowMin: shape[key]?.safeParse(min - nudge).success }).toEqual({
          key,
          belowMin: false,
        })
      }
      if (max !== undefined) {
        expect({ key, aboveMax: shape[key]?.safeParse(max + nudge).success }).toEqual({
          key,
          aboveMax: false,
        })
      }
    }
  })

  test('are never nullable — the host renders null as 0', () => {
    // `parametric-inspector.tsx` does `typeof value === 'number' ? value : 0`,
    // so a nullable field shows 0 whatever it means, and the first drag writes
    // a real number over the null. For a field where null means "derive it",
    // that silently converts an automatic value into a frozen manual one.
    for (const { field } of numbers) {
      const key = String(field.key)
      expect({ key, nullable: shape[key]?.safeParse(null).success }).toEqual({
        key,
        nullable: false,
      })
    }
  })
})

describe('enum fields', () => {
  const enums = fields.filter(({ field }) => field.kind === 'enum')

  test('offer exactly the options the schema accepts', () => {
    for (const { field } of enums) {
      const key = String(field.key)
      const { options } = field as { options: readonly string[] }
      for (const option of options) {
        expect({ key, option, ok: shape[key]?.safeParse(option).success }).toEqual({
          key,
          option,
          ok: true,
        })
      }
      expect({ key, ok: shape[key]?.safeParse('__not_an_option__').success }).toEqual({
        key,
        ok: false,
      })
    }
  })

  test('and the value they render round-trips', () => {
    for (const { field } of enums) {
      const key = String(field.key)
      const { options } = field as { options: readonly string[] }
      for (const option of options) {
        expect(withField(key, option)[key as keyof PalletRackNode]).toBe(option as never)
      }
    }
  })
})

describe('boolean fields', () => {
  test('are actually booleans in the schema', () => {
    for (const { field } of fields.filter(({ field }) => field.kind === 'boolean')) {
      const key = String(field.key)
      expect({ key, t: shape[key]?.safeParse(true).success }).toEqual({ key, t: true })
      expect({ key, f: shape[key]?.safeParse(false).success }).toEqual({ key, f: true })
    }
  })
})

describe('coverage', () => {
  /**
   * Fields the inspector deliberately does not show, with the reason. Anything
   * else new in the schema must appear in a group — the failure mode otherwise
   * is a setting that exists, is saved, and can only be reached through MCP or
   * by hand-editing the scene.
   */
  const DELIBERATELY_HIDDEN = new Set([
    // `BaseNode` plumbing — identity, tree position, and the two runtime
    // handles the host attaches. None of it is a rack setting.
    'id',
    'type',
    'name',
    'parentId',
    'visible',
    'locked',
    'metadata',
    'slots',
    'material',
    'materialPreset',
    'object',
    'camera',
    // Per-bay departures: edited by clicking a bay, not from a list of every
    // bay in the run.
    'bayOverrides',
    // The escape hatch for a rack that is mixed out of order; `pickingLevels`
    // covers the ordinary case and an array control would be noise.
    'levelTypes',
    // Elected at placement from the slab under the cursor.
    'supportSlabId',
    // Derived-or-declared: rendered by the plugin's own bay panel, because the
    // host's number control cannot express "auto".
    'palletsPerLevel',
    'palletSupportBars',
    'pickingBoxesAcross',
    'pickingBoxesDeep',
  ])

  test('every schema field is either shown or listed as hidden', () => {
    const shown = new Set(fields.map(({ field }) => String(field.key)))
    const missing = Object.keys(shape).filter(
      (key) => !shown.has(key) && !DELIBERATELY_HIDDEN.has(key),
    )
    expect(missing).toEqual([])
  })

  test('and nothing is listed as hidden that is also shown', () => {
    const shown = new Set(fields.map(({ field }) => String(field.key)))
    const contradictory = [...DELIBERATELY_HIDDEN].filter((key) => shown.has(key))
    expect(contradictory).toEqual([])
  })
})
