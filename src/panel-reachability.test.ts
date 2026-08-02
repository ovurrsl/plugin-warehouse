import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from './index'

/**
 * BEKÇİ: her kind'ın her şema alanı panelden KULLANILABİLİR olmalı.
 *
 * Kullanıcının şartı bu ("eklediğimiz nesnelerin tüm özelliklerini kendi
 * panellerinden kullanabilmeliyim") ve tek seferlik bir denetim yerine
 * kalıcı bir test: bundan sonra şemaya eklenen her alan ya bir parametrik
 * gruba girer, ya aşağıdaki kayıtlı istisnalardan birine gerekçesiyle
 * yazılır — yoksa bu test onu ERİŞİLEMEZ diye düşürür.
 *
 * ## Neden şema ağacı, ayrıştırılmış nesne değil
 *
 * Test önceden `Object.keys(schema.parse({id}))` geziyordu — yani YALNIZ ÜST
 * SEVİYE anahtarları. `tiers` bir kez CUSTOM muafiyeti alınca içindeki her şey
 * denetim dışı kalıyordu, ve mezzanine'in yedi alanı tam olarak orada
 * saklanıyordu: merdivenin `widthM`/`landing`/`railings`'i, üç kapı türünün
 * `widthM`'i, `tier.elevationM`. Hepsi şemada tanımlı, hepsi geometriyi
 * sürüyor, hiçbirinin kontrolü yoktu.
 *
 * Ayrıştırılmış nesneyi özyinelemeli gezmek de yetmezdi: `accessories`
 * varsayılanı BOŞ dizidir, yani `staircases: []` içinden bir eleman şeması
 * çıkarılamaz. Alanların görünmesinin tek yolu Zod ağacının kendisini
 * yürümek.
 *
 * İstisna türleri:
 *   - SYSTEM  — yerleştirme/sistem yazar, kullanıcı alanı değil
 *   - CUSTOM  — bir `kind: 'custom'` alan bileşeni, trailing panel ya da 3B
 *               araç düzenliyor (generic alan tipi onu ifade edemiyor);
 *               NEREDE düzenlendiği yazılı
 *
 * "Kullanıcıya kapalı" diye bir istisna türü BİLEREK yok.
 */

/** BaseNode'un her kind'da tekrar eden alanları. */
const BASE = new Set([
  'object',
  'id',
  'type',
  'name',
  'parentId',
  'visible',
  'metadata',
  'camera',
  'position',
  'rotation',
])

type Exemption = { field: string; kind: 'SYSTEM' | 'CUSTOM'; where: string }

const EXEMPTIONS: Record<string, Exemption[]> = {
  'warehouse:pallet': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'slotRackId', kind: 'SYSTEM', where: 'raf gözüne oturtmada araç yazar' },
    { field: 'slotAddress', kind: 'SYSTEM', where: 'raf gözüne oturtmada araç yazar' },
    {
      field: 'fillRange',
      kind: 'SYSTEM',
      where: 'göz aralığından araç yazar; kargo varyantını sürer',
    },
  ],
  'warehouse:pallet-rack': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    // Dördü de `Levels` grubundaki `LevelsField`'in içinde — kat açıklığının
    // TEK editörü orası. Üçü ayrı slider olarak iki farklı grupta duruyordu.
    {
      field: 'levelTypes',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, kat satırındaki tip anahtarı',
    },
    {
      field: 'firstLevelClear',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, "Zemin" varsayılanı',
    },
    {
      field: 'levelClear',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, "Üst katlar" varsayılanı',
    },
    {
      field: 'pickingLevelClear',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, "Toplama katı" varsayılanı',
    },
  ],
  'warehouse:drive-in-rack': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    // Kat açıklığının TEK editörü `LevelClearsField`. Seçici rafta üç slider
    // iki farklı gruba dağılmıştı ve bu turda birleştirildi; yeni kind aynı
    // hatayı baştan yapmıyor.
    {
      field: 'levelClear',
      kind: 'CUSTOM',
      where: 'Levels → LevelClearsField, "Kat açıklığı" varsayılanı',
    },
    {
      field: 'topClear',
      kind: 'CUSTOM',
      where: 'Levels → LevelClearsField, "Üst boşluk" varsayılanı',
    },
  ],
  'warehouse:longspan': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    // `levels` bir `custom` alan, yani içindeki her şey ayrıca yazılmalı — bir
    // custom bileşen ne düzenlediğini yalnız kendisi bilir.
    {
      field: 'levels.elevation',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, kat başına "Kot" slider (yuva aralığına yapışır)',
    },
    {
      field: 'levels.structure',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, kat başına "Yapı" seçicisi',
    },
    {
      field: 'levels.shelfKind',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, kirişli katlarda raf tipi segmenti',
    },
    {
      field: 'levels.panels',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, kirişli katlarda "Panel" slider',
    },
  ],
  'warehouse:m3-shelving': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    // `levels` bir `custom` alan, yani içindeki her şey ayrıca yazılmalı — bir
    // custom bileşen ne düzenlediğini yalnız kendisi bilir.
    {
      field: 'levels.elevation',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, kat başına "Kot" slider (adımı 25 mm yuva aralığı)',
    },
    {
      field: 'levels.structure',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, Raf / Çekmeceli segmenti',
    },
    {
      field: 'levels.model',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, "Panel" seçicisi (HL 150 kg / HM 275 kg)',
    },
    {
      field: 'levels.dividers',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, raflı katlarda "Bölücü" slider',
    },
    {
      field: 'levels.drawerModel',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, çekmeceli katlarda "Çekmece" seçicisi (MA/MB)',
    },
    {
      field: 'levels.drawerWidth',
      kind: 'CUSTOM',
      where: 'Levels → LevelsField, çekmeceli katlarda Dar/Geniş segmenti',
    },
  ],
  'warehouse:route': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'points', kind: 'CUSTOM', where: 'çizim aracı; nokta listesi generic alan değil' },
  ],
  'warehouse:truck': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'routeId', kind: 'SYSTEM', where: 'filo sistemi yazar' },
    { field: 'routeAnchor', kind: 'SYSTEM', where: 'filo sistemi yazar' },
    { field: 'carryingPalletId', kind: 'SYSTEM', where: 'palet görev döngüsü yazar' },
    { field: 'pickSlot', kind: 'CUSTOM', where: 'truck paneli kaynak yuva sabitleme seçicisi' },
    { field: 'dropSlot', kind: 'CUSTOM', where: 'truck paneli hedef yuva sabitleme seçicisi' },
  ],
  'warehouse:conveyor-roller': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-booster': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-curve': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-launcher': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-oblique': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-transfer': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-telescopic': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:mezzanine': [
    {
      field: 'supportSlabId',
      kind: 'SYSTEM',
      where: 'yerleştirme/uzlaştırıcı yazar (zemin çivisi)',
    },
    { field: 'polygon', kind: 'CUSTOM', where: 'çizim aracı (D) + seçim tutamakları' },
    { field: 'mainBeamProfile', kind: 'CUSTOM', where: 'trailing panel profil seçicisi' },
    { field: 'secondaryBeamProfile', kind: 'CUSTOM', where: 'trailing panel profil seçicisi' },
    { field: 'columnProfile', kind: 'CUSTOM', where: 'trailing panel profil seçicisi' },

    // ── grid: GridField'in dört slider'ı ────────────────────────────────────
    { field: 'grid.baysX', kind: 'CUSTOM', where: 'auto-fields GridField "Bays X"' },
    { field: 'grid.baysY', kind: 'CUSTOM', where: 'auto-fields GridField "Bays Z"' },
    { field: 'grid.bayWidthM', kind: 'CUSTOM', where: 'auto-fields GridField "Bay width"' },
    { field: 'grid.bayDepthM', kind: 'CUSTOM', where: 'auto-fields GridField "Bay depth"' },

    // ── tiers: TiersField ───────────────────────────────────────────────────
    { field: 'tiers.index', kind: 'SYSTEM', where: 'ekle/sil sırasında yeniden numaralanır' },
    {
      field: 'tiers.elevationM',
      kind: 'CUSTOM',
      where: 'TiersField "Kot: auto / Elle" + kot slider',
    },
    { field: 'tiers.clearHeightM', kind: 'CUSTOM', where: 'TiersField "Net yükseklik" slider' },
    { field: 'tiers.loadClass', kind: 'CUSTOM', where: 'TiersField "Yük sınıfı" seçicisi' },
    { field: 'tiers.floorType', kind: 'CUSTOM', where: 'TiersField "Döşeme" seçicisi' },

    // ── tier aksesuarları: AccessoryEditor ──────────────────────────────────
    {
      field: 'tiers.accessories.staircases.id',
      kind: 'SYSTEM',
      where: '`stair-<tier>-<n>` olarak eklemede üretilir',
    },
    {
      field: 'tiers.accessories.staircases.placement.mode',
      kind: 'CUSTOM',
      where: 'AccessoryEditor ⤢/⊞ kenar↔serbest anahtarı',
    },
    {
      field: 'tiers.accessories.staircases.placement.edge',
      kind: 'CUSTOM',
      where: 'AccessoryEditor kenar seçicisi',
    },
    {
      field: 'tiers.accessories.staircases.placement.offsetM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor ofset girdisi',
    },
    {
      field: 'tiers.accessories.staircases.placement.xM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor serbest yerleşim X',
    },
    {
      field: 'tiers.accessories.staircases.placement.zM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor serbest yerleşim Z',
    },
    {
      field: 'tiers.accessories.staircases.placement.rotationDeg',
      kind: 'CUSTOM',
      where: 'AccessoryEditor serbest yerleşim dönüşü',
    },
    {
      field: 'tiers.accessories.staircases.widthM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor "800 tek / 1000 çok" segmenti',
    },
    {
      field: 'tiers.accessories.staircases.landing',
      kind: 'CUSTOM',
      where: 'AccessoryEditor sahanlık seçicisi',
    },
    {
      field: 'tiers.accessories.staircases.railings',
      kind: 'CUSTOM',
      where: 'AccessoryEditor korkuluk sayısı seçicisi',
    },
    {
      field: 'tiers.accessories.staircases.steps',
      kind: 'CUSTOM',
      where: 'AccessoryEditor basamak seçicisi',
    },
    {
      field: 'tiers.accessories.swingGates.edge',
      kind: 'CUSTOM',
      where: 'AccessoryEditor kapı kenar seçicisi',
    },
    {
      field: 'tiers.accessories.swingGates.offsetM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor kapı ofseti',
    },
    {
      field: 'tiers.accessories.swingGates.widthM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor "750 tek / 1500 çift" segmenti',
    },
    {
      field: 'tiers.accessories.upAndOverGates.edge',
      kind: 'CUSTOM',
      where: 'AccessoryEditor palet kapısı kenar seçicisi',
    },
    {
      field: 'tiers.accessories.upAndOverGates.offsetM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor palet kapısı ofseti',
    },
    {
      field: 'tiers.accessories.upAndOverGates.widthM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor palet kapısı genişlik slider',
    },
    {
      field: 'tiers.accessories.safetyZones.edge',
      kind: 'CUSTOM',
      where: 'AccessoryEditor bölge kenar seçicisi',
    },
    {
      field: 'tiers.accessories.safetyZones.offsetM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor bölge ofseti',
    },
    {
      field: 'tiers.accessories.safetyZones.widthM',
      kind: 'CUSTOM',
      where: 'AccessoryEditor bölge genişlik slider (1.2 m eşiği uyarısıyla)',
    },
  ],
  'warehouse:live-racking': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'skus', kind: 'CUSTOM', where: 'trailing panel kat başına SKU girdileri' },
  ],
}

// ─── Zod ağacı yürüyüşü ──────────────────────────────────────────────────────

/** Zod 4'te tanım `._zod.def` altında; `.def` eski erişim yolu olarak kalıyor. */
function zodDef(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object') return null
  const holder = schema as { _zod?: { def?: unknown }; def?: unknown }
  const def = holder._zod?.def ?? holder.def
  return def && typeof def === 'object' ? (def as Record<string, unknown>) : null
}

/**
 * Bir şemanın yaprak alan yollarını `a.b.c` biçiminde toplar.
 *
 * Sarmalayıcılar (`default` / `optional` / `nullable`) şeffaf geçilir; dizi
 * elemanına inilir, yani `tiers` bir kez yazılır ama `tiers.clearHeightM` ayrı
 * bir yaprak olur. Birleşimlerde HER dalın alanları toplanır: teleskopik
 * merdiven yerleşimi ayrımlı birleşimdir ve iki dalın alanları da gerçek —
 * biri gösterilip diğeri gösterilmezse ikinci mod erişilemez kalır.
 *
 * `tuple` ve `record` yaprak sayılır: konum/dönüş üçlüleri host'un `vec3`
 * alanıdır, `slots` gibi kayıtların anahtarı çalışma anında belirlenir.
 */
function leafPaths(schema: unknown, prefix = '', depth = 0): string[] {
  /**
   * Kaçak özyineleme koruması — ve neden SUSMAK yerine ATIYOR.
   *
   * İlk yazımı `if (depth > 8) return [prefix]` idi ve tam olarak bu testin
   * yakalamak için var olduğu hatayı kendisi yapıyordu: mezzanine'in merdiven
   * `placement`'ı 8. seviyede duruyor, yani koruma birleşimin ÜSTÜNDE kesip
   * `…placement`'ı yaprak gibi gösteriyordu. Altı alan yine görünmez kalmıştı,
   * ve hiçbir şey şikâyet etmiyordu çünkü koruma "geçerli bir cevap" dönüyordu.
   *
   * Sessizce kısaltılmış bir kapsam, kapsam yokluğundan beterdir: yeşil test
   * denetlendiğini söyler. Sınır artık gerçek şemaların iki katı ve aşılırsa
   * test PATLIYOR.
   */
  if (depth > 24) {
    throw new Error(`Şema ağacı beklenmedik derinlikte — ${prefix || '<kök>'} (derinlik ${depth})`)
  }
  const def = zodDef(schema)
  if (!def) return prefix ? [prefix] : []

  switch (def.type) {
    case 'default':
    case 'optional':
    case 'nullable':
    case 'readonly':
    case 'catch':
      return leafPaths(def.innerType, prefix, depth + 1)

    case 'object': {
      const shape = (def.shape ?? {}) as Record<string, unknown>
      return Object.entries(shape).flatMap(([key, child]) =>
        leafPaths(child, prefix ? `${prefix}.${key}` : key, depth + 1),
      )
    }

    case 'array':
      return leafPaths(def.element, prefix, depth + 1)

    default: {
      /**
       * Birleşimler — `type` etiketine DEĞİL, `options` dizisine bakılarak.
       *
       * `z.union` `type: 'union'` diyor ama `z.discriminatedUnion` bu Zod
       * sürümünde başka bir etiket taşıyor, ve ilk yazımda yalnız `'union'`
       * eşleştiği için merdivenin `placement`'ı YAPRAK sayılıyordu: iki
       * yerleşim modunun altı alanı da denetimin dışında kalıyordu — testin
       * kapatmak için yazıldığı deliğin aynısı, bir seviye derinde.
       */
      if (Array.isArray(def.options)) {
        const paths = (def.options as unknown[]).flatMap((option) =>
          leafPaths(option, prefix, depth + 1),
        )
        // Birleşim yalnız ilkellerden oluşuyorsa ("auto" | number) kendisi yaprak.
        return paths.length > 0 ? [...new Set(paths)] : prefix ? [prefix] : []
      }
      return prefix ? [prefix] : []
    }
  }
}

/** `a.b.c` → `['a', 'a.b', 'a.b.c']`; muafiyet bir ALT AĞACI kapatabilsin diye. */
function ancestry(path: string): string[] {
  const parts = path.split('.')
  return parts.map((_, index) => parts.slice(0, index + 1).join('.'))
}

describe('panel erişilebilirliği — her alan ya grupta ya kayıtlı istisnada', () => {
  const defs = warehousePlugin.nodes ?? []
  expect(defs.length).toBeGreaterThan(0)

  for (const def of defs) {
    test(def.kind, () => {
      const covered = new Set(
        (def.parametrics?.groups ?? []).flatMap((group) =>
          group.fields.map((field) => String(field.key)),
        ),
      )
      const exempt = new Map(
        (EXEMPTIONS[def.kind] ?? []).map((entry) => [entry.field, entry] as const),
      )
      /**
       * `custom` alanlar alt ağaçlarını KAPATMAZ.
       *
       * Host'un kendi alan tipleri (`number`, `enum`, `color`, `vec3`,
       * `boolean`) değerin TAMAMINI yazıyor, o yüzden anahtarın grupta olması
       * içindeki her şeyin ulaşılabilir olduğu anlamına geliyor. Bir `custom`
       * bileşen için bu doğru değil: ne yazdığını yalnız kendisi biliyor, ve
       * iç içe bir şemanın bir alanını düzenlemeyi unutması hiçbir yerde
       * görünmüyor.
       *
       * Bu, testin İLK yazımındaki delikti ve mezzanine'de tesadüfen
       * kapanmıştı — `tiers` bir grup alanı değil muafiyet olduğu için
       * özyineleme oraya inmişti ve yedi erişilemez alanı orada bulmuştu. M7'de
       * `levels` bir grup alanı, yani aynı delik açık olsaydı dört iç alan
       * denetimsiz geçecekti.
       */
      const customKeys = new Set(
        (def.parametrics?.groups ?? []).flatMap((group) =>
          group.fields.filter((field) => field.kind === 'custom').map((field) => String(field.key)),
        ),
      )

      const paths = leafPaths(def.schema)
      expect(paths.length).toBeGreaterThan(0)

      for (const path of paths) {
        const head = path.split('.')[0] ?? path
        if (BASE.has(head)) continue
        // Muafiyet alt ağacı kapatır — `pickSlot` muafsa `pickSlot.rackId` de
        // muaftır, çünkü o nesneyi yazan tek kontrol yuva seçicisidir.
        const exemptedHere = ancestry(path).some((ancestor) => exempt.has(ancestor))
        // Bir grup alanı yalnız KENDİ anahtarını kapatır; iç içe yaprakları
        // ancak host'un tam-değer yazan bir alan tipiyse kapatır.
        const coveredHere = covered.has(head) && (path === head || !customKeys.has(head))
        expect(
          coveredHere || exemptedHere,
          `${def.kind}.${path} panelden erişilemez ve istisnada yok`,
        ).toBe(true)
      }

      // Ters yön: istisna listesi şişmesin — şemadan silinen alanın
      // istisnası da silinmeli, yoksa liste yalan söylemeye başlar. Bir
      // muafiyet yaprağın kendisi ya da bir yaprağın atası olabilir.
      const known = new Set(paths.flatMap(ancestry))
      for (const field of exempt.keys()) {
        expect(known.has(field), `${def.kind}.${field} istisnada ama şemada yok`).toBe(true)
      }
    })
  }
})
