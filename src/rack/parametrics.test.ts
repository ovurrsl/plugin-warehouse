import { describe, expect, test } from 'bun:test'
import {
  BOXES_ACROSS_BOUNDS,
  BOXES_DEEP_BOUNDS,
  PALLETS_PER_LEVEL_BOUNDS,
  SUPPORT_BARS_BOUNDS,
} from './auto-fields'
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
  /**
   * Rack ayarı OLMAYAN alanlar. Kullanıcı bunları düzenlemez, hiçbir yerde.
   */
  const NOT_A_SETTING = new Set([
    // `BaseNode` plumbing — identity, tree position, and the runtime handles the
    // host attaches. None of it is a rack setting.
    'object',
    'id',
    'type',
    'name',
    'parentId',
    'visible',
    'metadata',
    'camera',
    // Elected at placement from the slab under the cursor.
    'supportSlabId',
  ])

  /**
   * Kendi grup alanı olmayan ama `Levels` grubundaki `LevelsField`'in İÇİNDE
   * düzenlenen alanlar. "Gizli" değiller — kontrolleri var, yalnız kontrol
   * kendi anahtarlarıyla değil `levelClears` anahtarıyla kayıtlı.
   *
   * Ayrı bir küme, çünkü eski tek küme ikisini karıştırıyordu ve gerekçesi
   * yanlıştı: `levelTypes` için "bir dizi kontrolü gürültü olurdu" yazıyordu,
   * oysa dizi kontrolü kat satırlarında ZATEN vardı. Yanlış gerekçe, doğru
   * sonucu koruduğu için hiçbir testi düşürmemişti — ama bir sonraki okuyucuya
   * var olan bir kontrolün var olmadığını söylüyordu.
   */
  const EDITED_BY_LEVELS_FIELD = new Set([
    // Kat satırındaki Palet/Toplama anahtarı; türetilmiş desene dönerse dizi
    // `null`'a düşer ve raf komşularıyla mesh paylaşımına geri döner.
    'levelTypes',
    // Kat açıklığının üç varsayılanı. Üçü de ayrı slider'dı ve ikisi `Levels`,
    // biri `Picking` grubundaydı — aynı sayıyı yöneten kontroller iki bölüme
    // dağılmıştı. Artık üçü `LevelsField`'in başındaki "Varsayılan açıklıklar".
    'firstLevelClear',
    'levelClear',
    'pickingLevelClear',
  ])

  const DELIBERATELY_HIDDEN = new Set([...NOT_A_SETTING, ...EDITED_BY_LEVELS_FIELD])

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

  test('and nothing is listed as hidden that the schema no longer has', () => {
    // The third direction, and the one that was missing. Without it the set only
    // ever grows: `bayOverrides` sat here for a whole refactor after the field
    // was deleted, along with four `BaseNode` keys that never existed, and both
    // coverage assertions stayed green — a stale excuse silently excuses nothing
    // and looks exactly like a live one.
    const stale = [...DELIBERATELY_HIDDEN].filter((key) => !(key in shape))
    expect(stale).toEqual([])
  })
})

describe('the invariants are reachable, and each one can actually fire', () => {
  /**
   * None of this was tested, and one of them could not fire at all.
   *
   * `invariants` has no consumer in the host — it is declared in the registry's
   * types and read by nothing — so five warnings a rack computes about itself
   * were produced and dropped. The plugin's own trailing section renders them
   * now, which makes them worth pinning: an unsatisfiable check is worse than no
   * check, because it reads as coverage.
   */
  const issuesFor = (overrides: Record<string, unknown>) =>
    (palletRackParametrics.invariants ?? []).flatMap((check) =>
      check(PalletRackNode.parse({ id: 'pallet_rack_inv', ...overrides })),
    )

  const fieldsOf = (overrides: Record<string, unknown>) =>
    issuesFor(overrides).map((issue) => issue.field)

  test('a default bay is clean', () => {
    expect(issuesFor({})).toEqual([])
  })

  test('levels that do not fit the upright are reported', () => {
    expect(fieldsOf({ levels: 10, uprightHeight: 5 })).toContain('levels')
  })

  test('pallets turned long-side-out with nothing under them are reported', () => {
    // `decking: 'open'` is load-bearing here, not incidental: a decked level
    // carries the pallet whichever way round it sits, so a wire-decked rack
    // turned long-side-out is *not* unsupported and must not be warned about.
    expect(
      fieldsOf({ palletOrientation: 'long-side-out', palletSupportBars: 0, decking: 'open' }),
    ).toContain('palletSupportBars')
    expect(
      fieldsOf({ palletOrientation: 'long-side-out', palletSupportBars: 0, decking: 'wire-mesh' }),
    ).not.toContain('palletSupportBars')
  })

  test('a declared count above what the bay fits is reported', () => {
    expect(fieldsOf({ palletsPerLevel: 9 })).toContain('palletsPerLevel')
  })

  test('a tunnel that empties the bay is reported', () => {
    expect(fieldsOf({ levels: 2, tunnelLevels: 15 })).toContain('tunnelLevels')
  })

  test('the EN 15620 headroom check can fire at all', () => {
    // It could not. It compared `levelClear` — the whole opening — against a
    // clearance measured *above the load*, and the largest value in the table is
    // 175 mm while the schema floors `levelClear` at 200 mm. The branch was
    // unreachable for every node the schema would accept.
    expect(fieldsOf({ levels: 3, uprightHeight: 8, levelClear: 1.25 })).toContain('levelClear')
    // And it holds its tongue when there is genuinely room — including on the
    // defaults, which is the bar an always-on warning has to clear.
    expect(fieldsOf({ levels: 3, uprightHeight: 8, levelClear: 1.4 })).not.toContain('levelClear')
    expect(fieldsOf({})).not.toContain('levelClear')
  })

  test('the top level is never the one reported', () => {
    // What is above the top level is the building, not the rack. A 5 m frame
    // with its top beam at 4.66 m carries loads that stand above the frame, and
    // that is ordinary racking — the earlier version warned about every default
    // rack in existence because it treated the frame top as a ceiling.
    const tall = fieldsOf({ levels: 3, uprightHeight: 5, levelClear: 1.4 })
    expect(tall).not.toContain('levelClear')
    expect(tall).toEqual([])
  })

  test('a rack too tall for any forklift is reported', () => {
    // The clearance table stops at 15 m; above it no forklift is rated and the
    // answer is a turret truck or a crane.
    expect(fieldsOf({ levels: 11, uprightHeight: 20, levelClear: 1.4 })).toContain('uprightHeight')
  })

  test('every issue names a field the schema has', () => {
    // The field key is what orders the list and what a future host would anchor
    // the message to. One naming a deleted field is a silent mis-anchor.
    const shapeKeys = new Set(Object.keys(shape))
    for (const overrides of [
      { levels: 10, uprightHeight: 5 },
      { palletOrientation: 'long-side-out', palletSupportBars: 0 },
      { palletsPerLevel: 9 },
      { levels: 2, tunnelLevels: 15 },
      { levels: 3, uprightHeight: 8, levelClear: 1.25 },
    ]) {
      for (const issue of issuesFor(overrides)) {
        expect({ overrides, field: issue.field, known: shapeKeys.has(issue.field ?? '') }).toEqual({
          overrides,
          field: issue.field,
          known: true,
        })
        expect(issue.msg.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('the derived fields are reachable and correctly bounded', () => {
  /**
   * The four `number | null` fields, where null means "work it out from the
   * geometry". They cannot be plain number controls — the host renders a null as
   * 0 and the first drag freezes a value that was tracking the bay's width — so
   * they are `kind: 'custom'`.
   *
   * They used to live in the plugin's own trailing section, which put them
   * outside the coverage assertions above entirely: exempted as "deliberately
   * hidden" while actually being rendered, so nothing checked either that they
   * were still reachable or that the bounds passed to them matched the schema.
   */
  const DERIVED = [
    ['palletsPerLevel', PALLETS_PER_LEVEL_BOUNDS],
    ['palletSupportBars', SUPPORT_BARS_BOUNDS],
    ['pickingBoxesAcross', BOXES_ACROSS_BOUNDS],
    ['pickingBoxesDeep', BOXES_DEEP_BOUNDS],
  ] as const

  test('each is a custom field with a component', () => {
    for (const [key] of DERIVED) {
      const entry = fields.find(({ field }) => field.key === key)
      expect({ key, kind: entry?.field.kind }).toEqual({ key, kind: 'custom' })
      expect({
        key,
        component: typeof (entry?.field as { component?: unknown })?.component,
      }).toEqual({ key, component: 'function' })
    }
  })

  test('each accepts null, which is what makes it derived at all', () => {
    for (const [key] of DERIVED) {
      expect({ key, null: shape[key]?.safeParse(null).success }).toEqual({ key, null: true })
    }
  })

  test('the bounds it offers are the schema bounds', () => {
    // They matched by inspection before, which is the kind of agreement that
    // holds right up until someone widens a range.
    for (const [key, bounds] of DERIVED) {
      const field = shape[key]
      expect({ key, min: field?.safeParse(bounds.min).success }).toEqual({ key, min: true })
      expect({ key, max: field?.safeParse(bounds.max).success }).toEqual({ key, max: true })
      expect({ key, under: field?.safeParse(bounds.min - 1).success }).toEqual({
        key,
        under: false,
      })
      expect({ key, over: field?.safeParse(bounds.max + 1).success }).toEqual({ key, over: false })
    }
  })
})
