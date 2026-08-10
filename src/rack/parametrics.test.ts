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

  test("and together they cover the schema's whole range", () => {
    /**
     * Öteki yön. "Şemanın ötesine taşmasın" yönünü yukarıdaki test zaten
     * kapatıyor: şema kontrolün kendi `max`'ını kabul ediyorsa o `max`
     * şemanınkini aşamaz. Burada tutulan şey ters durum — şemanın izin
     * verdiği bir değere HİÇBİR kontrolden ulaşılamıyorsa o ayar saklanmış
     * olur.
     *
     * Kural anahtar BAŞINA, tek tek kontrol başına değil, ve bu turda öyle
     * oldu: `uprightHeight` artık iki kez yazılı, biri 20 m tavanlı (palet
     * rafı), biri 3 m tavanlı (alçak raf), `visibleIf` ikisini birbirini
     * dışlar kılıyor. Kontrol başına bakan eski hâli alçak raf slider'ını
     * "şemayı daraltıyor" diye düşürüyordu — oysa 4 m'lik bir raf hâlâ
     * erişilebilir, yalnız varyantı değiştirerek.
     */
    const byKey = new Map<string, { min?: number; max?: number; step?: number }[]>()
    for (const { field } of numbers) {
      const key = String(field.key)
      byKey.set(key, [...(byKey.get(key) ?? []), field as { min?: number; max?: number }])
    }

    for (const [key, controls] of byKey) {
      const mins = controls.map((control) => control.min).filter((value) => value !== undefined)
      const maxes = controls.map((control) => control.max).filter((value) => value !== undefined)
      const step = controls[0]?.step ?? 0.01
      if (mins.length === controls.length) {
        const lowest = Math.min(...mins)
        expect({ key, reachesMin: shape[key]?.safeParse(lowest - step / 2).success }).toEqual({
          key,
          reachesMin: false,
        })
      }
      if (maxes.length === controls.length) {
        const highest = Math.max(...maxes)
        expect({ key, reachesMax: shape[key]?.safeParse(highest + step / 2).success }).toEqual({
          key,
          reachesMax: false,
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

describe('alçak raf 3 m tavanı', () => {
  /**
   * Kullanıcının şartı ("lower rack seçtiğimde en fazla 3 metre
   * yapabildiğim ... rack gelmeli"), ve şartın panelde nasıl karşılandığının
   * bekçisi.
   *
   * Tavan ŞEMADA değil PANELDE, bilerek: MCP'den ya da elle düzenlenmiş bir
   * sahneden gelen 3 m üstü bir alçak raf reddedilmiyor, uyarılıyor. İki
   * yön de burada tutuluyor, çünkü ikisinden birini kaybetmek sessiz: tavan
   * kaybolursa slider yine çalışır, uyarı kaybolursa sahne yine açılır.
   */
  const uprightFields = fields
    .filter(({ field }) => field.key === 'uprightHeight')
    .map(({ field }) => field as { max?: number; visibleIf?: (n: PalletRackNode) => boolean })

  const lowRack = (uprightHeight: number) =>
    PalletRackNode.parse({ id: 'pallet_rack_low', variant: 'low-rack', uprightHeight })
  const palletRack = (uprightHeight: number) =>
    PalletRackNode.parse({ id: 'pallet_rack_tall', variant: 'pallet-rack', uprightHeight })

  const visible = (node: PalletRackNode) =>
    uprightFields.filter((field) => field.visibleIf?.(node) ?? true)

  test('her varyantta TEK bir yükseklik kontrolü görünür', () => {
    // İkisi birden görünürse panel aynı sayıyı iki kez, iki farklı tavanla
    // gösterir; hiçbiri görünmezse yükseklik hiç ayarlanamaz. Sessiz olan
    // ikinci hâl, çünkü panel yine dolu görünür.
    expect(visible(lowRack(2.5)).length).toBe(1)
    expect(visible(palletRack(5)).length).toBe(1)
  })

  test('ve tavanı varyantın tavanı', () => {
    expect(visible(lowRack(2.5))[0]?.max).toBe(3)
    expect(visible(palletRack(5))[0]?.max).toBe(20)
  })

  test('şema 3 mʼyi aşan alçak rafı REDDETMİYOR', () => {
    // Kural: sayı reddedilmez, uyarılır. Şema kapansaydı MCP'nin yazdığı
    // sahne hiç açılmazdı.
    expect(lowRack(4.2).uprightHeight).toBe(4.2)
  })

  test('ama panel onu uyarı olarak söylüyor', () => {
    const warn = (node: PalletRackNode) =>
      (palletRackParametrics.invariants ?? [])
        .flatMap((check) => check(node))
        .filter((issue) => issue.field === 'uprightHeight')

    expect(warn(lowRack(4.2)).length).toBe(1)
    expect(warn(lowRack(3)).length).toBe(0)
    // Palet rafı 4.2 m'de tamamen normal — uyarı varyanta bağlı, boya değil.
    expect(warn(palletRack(4.2)).length).toBe(0)
  })
})
