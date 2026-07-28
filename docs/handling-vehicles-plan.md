<!-- 13 ajanlı tasarım+eleştiri turunun çıktısı: altı tasarımcı paralel çalıştı,
     her biri gerçek kod karşısında ayrı bir eleştirmen tarafından denetlendi,
     sonra tek plana sentezlendi. Host reposu salt okunur ele alındı.
     Ölçüler docs/vehicle-data-vdi.md'den; kodda hiçbir ölçü tekrar yazılmaz. -->

# İş makineleri (handling trucks) — birleşik uygulama planı

`@ovurrsl/plugin-warehouse` · plugin API v1 · host salt-okunur

Aşağıdaki her host iddiası dosyadan doğrulandı; doğrulanamayanlar **[doğrulanmadı]** ile işaretli. Ölçüler `docs/vehicle-data-vdi.md`'den, yeniden yazılmadan.

---

## 1. Karar özeti

| # | Karar | Tek cümlelik gerekçe |
|---|---|---|
| 1.1 | **Tek node kind: `warehouse:truck`** | Conveyor'ün 6 kind'a bölünme ölçütü *alan kümesi ayrışması*dır (`conveyor/transfer-schema.ts`: "Four fields the rest of the family has are missing"), araçlarda ise her aile farkı `model` kimliğine ve tek bir nullable `mastRowId` alanına katlanıyor — `warehouse:pallet`'in sekiz preset'i tek kind'da taşımasıyla aynı durum. |
| 1.2 | **Aile (`TruckVariant`) düğümde saklanmaz** | `TRUCK_MODELS[model].variant` ile çözülür; iki kaynak iki cevap demektir ve `route/schema.ts:89`'un `requiredFor` kuralı bunu zaten yasaklıyor. |
| 1.3 | **Hareket `def.system` içinde yaşar** | `registered-systems.tsx:41-63` doğrulandı: host `def.system`'i **kind başına bir kez** mount ediyor ve `sceneApi` geçiyor — tek kind olduğu için `conveyor/definition.ts:149`'un itiraf ettiği "keyfî olarak straight'e astık" sorunu doğmuyor. |
| 1.4 | **Poz kanalı `useLiveTransforms`, özel bir modül-map DEĞİL** | Üç şey bedavaya geliyor ve üçü de aksi hâlde sessizce bozuluyor (§5.1'de dosya kanıtlarıyla): asma kat/slab Y lifti, 2B planın hareketi, ve hareket eden aracın tıklanabilirliği. |
| 1.5 | **Simülasyon sahne grafiğine yazmaz** | `conveyor/flow-simulation.ts`'in yazılı kuralı ("every frame a store write, every write an undo step"); palet alma/bırakma **kullanıcı eylemidir**, kare döngüsü değil. |
| 1.6 | **3B ve 2B sınırı: tek parça listesi, iki tüketici** | `rack/floorplan.ts`'in deseni — `truckParts(spec,'full')` 3B'nin sahibi, plan onu filtreleyip *projekte eder*; iki dosya ayrı hesap yaparsa bir hafta içinde ayrışır. |
| 1.7 | **`aisleBandForVariant` imzası değişmez, `turret` dalı hiç değişmez** | `docs/vehicle-data-vdi.md:216` — EKX `Ast` yayınlamıyor, üretici verisi burada EN 15620'den zayıf. |
| 1.8 | **Katalog metre tutar, mm değil** | CLAUDE.md'nin ilk kuralı, ve `rack/standards.ts:18-24` bunu açıkça reddediyor: tablo `mm(2933)` ile yazılır, PDF'e karşı diff'lenebilirlik korunur, "100 üstü çıplak literal yok" kuralı ihlal edilmez. |
| 1.9 | **İlk dikey dilim: `forklift` / EFG 216, park hâlinde, uçtan uca** | Wa pivotu 7/7 modelde tam kapanıyor, ölçü zinciri kapanıyor, straddle/reach/swivel/man-up yok — yani veri hataları hâlâ ucuzken görünür. |

---

## 2. Veri katmanı — `src/handling/`

### 2.1 Dosya dosya

| Dosya | Durum | İçerik |
|---|---|---|
| `handling/catalog.ts` | **DEĞİŞMEZ** | `TRUCK_VARIANTS` + `TRUCK_EQUIPMENT`. Üç `null` korunur, doküman bloğu korunur. |
| `handling/metrics.ts` | genişletilir | `aisleBandForVariant` / `aisleMarginM` **aynı imzayla** kalır; yanına model bazlı okuma. |
| `handling/constants.ts` | genişletilir | `MANOEUVRING_*` + `Estimate<T>` sarmalayıcı + aile başına gövde tahminleri, her biri notuyla. |
| `handling/models.ts` | **YENİ** | 21 makine / **22 katalog satırı** (ERE'nin kompakt platformu ayrı satır), yayınlanmış figürler, **metre**. |
| `handling/masts.ts` | **YENİ** | Mast satırları ve satır id'leri. |
| `handling/chains.ts` | **YENİ** | VDI ölçü zincirleri, saf fonksiyon — hakem, türetici değil. |
| `handling/gaps.ts` | **YENİ** | Yayınlanmadığı **tespit edilmiş** figürler (brief §6-C), tam metinleriyle. |

Üç yeni dosya (`gaps`, `chains`, `models`) ayrı tutuluyor çünkü üçü farklı sorulara cevap veriyor; `model-estimates.ts` **ayrılmaz** — `handling/constants.ts` bugün 36 satır ve tam olarak bu işi yapıyor.

### 2.2 Birim ve tip

```ts
// models.ts, dosya-yerel — rack/standards.ts:24 ve conveyor/catalog.ts:22 ile aynı desen.
// Paylaşımlı yapılmaz: bu paketin konvansiyonu "her tablo dosyası kendi sınırıdır" (5 kopya).
const mm = (value: number) => value / 1000

/** VDI 2198 4.34. Alanlar YÜK ÖLÇÜSÜYLE adlandırılır, "boyuna/enlemesine" ile değil —
 *  EFG ve ETV tabloları iki sütunu ters sırayla basıyor ve bir tuple bunu sessizce takas ederdi. */
export type AstPair = { load1000x1200: number; load800x1200: number }
```

`AstPair` yerine konumsal tuple **yasak**: doğrulandı ki EFG tablosu `Ast 1000×1200 | Ast 800×1200`, ETV tablosu `Ast 800×1200 | Ast 1000×1200` sırasıyla basılmış. Takas 50–200 mm'lik, hiçbir yerde patlamayan bir koridor hatası verir.

### 2.3 `TruckModel` — hangi alan zorunlu, hangisi `null`

```ts
export type TruckModel = {
  id: TruckModelId              // nötr slug: 'counterbalanced-3w-1600'  (§10 soru 4)
  variant: TruckVariant
  label: string                 // 'EFG 216' — atıf; kind adına, dosya adına, panel etiketine girmez
  source: string                // 'EFG 2 specsheet TR 07/2026, VDI 4.34'
  // Taban izi ve zarf
  l1: number; l2: number; b1: number
  b2: number | null             // kabin genişliği — EKX'te 1.45 > b1 1.21
  b4: number | null             // ayak iç açıklığı — yalnız reach
  b5: number | { min: number; max: number } | null   // ETV'de AYARLANABİLİR, EFG'de yayınlanmamış
  b10: number; b11: number | null
  y: number; x: number | null   // AM 15l'de x yayınlanmamış
  fork: { s: number; e: number; length: number }
  c: number; Q: number
  h6: number | null; h7: number | null; h8: number | null
  h13: number | null; h14: number | readonly [number, number] | null  // ERE'de 1215/1275 ÇİFT
  rearOverhang: number | null   // EFG 0.190 — türetilmiş; ETV/EKX'te farklı kavram
  ast: AstPair | null           // EKX'te null — DOLDURULMAZ
  Wa: number | null
  waPivotFromRear: number | null // §4.2
  travelKmh: { laden: number | null; efficiency: number | null; plus: number | null }
  liftMs: number | null; lowerMs: number | null; reachMs: number | null
  serviceWeightKg: number
  mastTables: readonly MastTableId[]   // KÜME: ETM325 yalnız A, ETV318 A+B, ETV320/325 A+B+C
  residualCapacityPublished: boolean   // reach'te false
  notes: readonly string[]
}
```

Beş sert kural, hepsi veriden doğrulandı:

1. **`h1` yalnız `MastRow`'da durur.** İki yerde saklamak `route/schema.ts:81-89`'un yasakladığı kopyadır.
2. **`travelKmh.efficiency` ETM325 ve ETV325'te `null`** — `docs/vehicle-data-vdi.md:165-166`: *"kaynakta '0 km/h' yazması aracın hareketsiz olduğu anlamına gelmez, sütun boş demektir."* `0` yazılırsa araç asla hareket etmez ve bu bir **simülasyon hatası gibi görünür**.
3. **`b5` reach'te aralık, EFG'de `null`.** EFG verisinde b5 yok (b3=980 ISO taşıyıcı, çatal açıklığı değil). Tek `number` yedi model için sayı uydurtur ve o uydurma geometriye sızar.
4. **`ast: null` EKX'te kalıcıdır** ve `gaps.ts`'te karşılığı vardır — test bunu kilitler.
5. **ERE kompakt platform ayrı bir model satırıdır** (`l1 −103, l2 −103, Ast −108`), şema alanı değil: `−103` ile `−108`'in uyuşmaması `Ast`'ın `l1`'den türetilemeyeceğinin kanıtı ve bu bir test.

### 2.4 `chains.ts` — zincir hakemdir, türetici değil

Doğruladığım kimlikler:

| Aile | Kimlik | Durum |
|---|---|---|
| AM 15l | `l1 = l2 + fork.length` | 4/4 ✓ (380+1150=1530, +950=1330, +795=1175, +1150=1530) |
| ERE 225i | `l1 = l2 + fork.length` | ✓ (989+1150=2139) |
| EFG | `l2 = 190 + y + x`, `l1 = l2 + 1150` | 7/7 ✓ |
| ETM/ETV | `x = (210 + y) − l2`, `l1 = l2 + 1150` | 4/4 ✓ |
| **EKX** | `l1 − l2 = 286` sabit, çatal boyu **1200** | **Jenerik zincir TUTMUYOR — 914 mm** |

EKX satırı bu dosyanın varlık sebebidir. `l1 = l2 + forkLength` yardımcısı beş aileden dördünde doğru, beşincisinde 914 mm'lik bir taban izi hatası üretir ve bu hata 3B'de **görünmez** — yalnız çarpışma kutusunda ve koridor okumasında ortaya çıkar. `CHAIN_EXEMPT` sabiti EKX'i gerekçesiyle dışlar, ve EKX'in `l1`/`l2` çiftinin *aynı niceliği ölçmediği* `gaps.ts`'e yazılır.

Ayrıca **her yayınlanmış satırda `ast.load1000x1200 < ast.load800x1200`** — 13 yayınlanmış çiftin hepsinde doğruladım (AM 1584<1784, ERE 2346<2396, EFG 7/7, ETV 4/4). Palet yönelimi karışmasını yakalayan tek test budur.

### 2.5 `masts.ts`

```ts
export type MastRow = { id: MastRowId; table: MastTableId; type: 'ZT'|'ZZ'|'DZ'
                        h1: number; h2: number; h3: number; h4: number }
```

Türetilmiş sabitler **satırlara yazılmaz, testle iddia edilir**: ETM/ETV `h4 = h3 + 0.746` ve `h2 = h1 − 0.730` (39 satırda doğrulanmış), EKX `h4 = h3 + 2.550` (her zaman), EFG ZT `h2 = 0.150`.

**Ara `h3` enterpole EDİLMEZ.** `mastRowFor(model, id)` yalnız tablo satırı döner; model tabloyu sunmuyorsa `null` — ve panel *"kayıtlı mast satırı bu modelde sunulmuyor"* der, sessizce düzeltmez.

**Elimizde olmayan:** EFG'nin mast tabloları (yalnız 3000 ZT satırı: grup A h1/h4 = 2060/3590, grup B 2067/3612 → `h4−h3` **590 / 612**, yani EFG'de tek bir tepe payı sabiti bile yok). ETM/ETV'nin satır satır tabloları (yalnız grup aralıkları + iki sabit). EKX'in >14500 satırları. **Hepsi `gaps.ts`'e girer; aralıktan satır uydurulmaz.**

### 2.6 `aisleBandForVariant` — ne olur, ne olmaz

```ts
export function aisleBandForVariant(variant: TruckVariant): AisleBand   // İMZA DEĞİŞMEZ
```

- **`forklift` / `reach` / `turret`:** ilk dal, `TRUCK_EQUIPMENT` → `HANDLING_EQUIPMENT`. **Hiçbir satır değişmez.** `turret` iki bağımsız sebeple korunur: (a) `TRUCK_EQUIPMENT.turret` non-null olduğu için ilk dalda kalır, (b) EKX'in `ast`'ı `null` olduğu için ikinci dal zaten `null` dönerdi.
- **`hand-pallet` / `powered-pallet`:** yayınlanmış `Ast` kapsamına terfi *edilebilir* — **§10 soru 1**, çünkü görünür bir davranış değişikliği var (aşağıda).
- **`agv`:** tahmin bandında kalır.

**Terfi seçilirse zorunlu iki eşlikçi düzeltme (ikisi de doğrulandı):**

1. `route/metrics.ts:29` — `defaultWidthM` `aisleBandForVariant(...).min` okuyor. `hand-pallet` 2.10 → **1.584 m**, `powered-pallet` 2.10 → **2.238 m** (kompakt platform dahil kapsam). Kaydedilmiş sahneler etkilenmez (genişlik düğümde saklı), ama **yeni çizim davranışı görünür biçimde değişir**.
2. `route/parametrics.ts:87-104` — yayınlanmış dalda `band.note` **hiç okunmuyor** ve `:94`'te `(Mecalux / EN 15620, yükler arası; yasal bir sınır değil.)` atfı **gömülü**. VDI bandı geldiği an o atıf yanlış olur ve terfi eden bandın notu (hangi palet yönelimi) sessizce düşer. Aynı PR'da düzeltilmeli.

`metrics.test.ts:39-50`'nin `['hand-pallet','powered-pallet','agv']` döngüsü **kasıtlı olarak kırılır ve düzenlenir**. `metrics.test.ts:20`'ye **dokunulmaz** — o döngü `if (!equipmentId) continue` ile yalnız üç rated sınıfı geziyor, onların notu boş kalır.

### 2.7 Model bazlı okuma — sınıf bandına karışmayan ayrı kanal

```ts
export type ModelAisleFigure = {
  requiredM: number
  basis: 'published'
  instrument: 'VDI 2198'
  label: string                // 'EFG 216k · 1000×1200'
  note: string                 // 'VDI 2198 4.34; a = 200 mm güvenlik payı dahil.'
}
export function aisleFigureForModel(model: TruckModelId, load: AstLoad): ModelAisleFigure | null
```

**`AisleBand` tipine `instrument`/`scope` alanı EKLENMEZ.** İki enstrümanın birbirinin yerine geçememesi, iki tipin *hiçbir ilişkisinin olmamasıyla* bedavaya sağlanır; `AisleBand`'e alan eklemek `route`'u ve `metrics.test.ts`'i riske atar, ve TypeScript yapısal olduğu için `scope: 'class'|'model'` alanı zaten yer değiştirmeyi engellemez.

**Ama iki sayı bir ekranda çelişebilir** ve bu `handling/metrics.ts:6-12`'nin açık sözüne ("One function, because there is one number") dokunuyor. Çözüm, tek bir kural olarak yazılır:

> **Bağlayıcı olan sınıf bandıdır. Model figürü yalnız aracın kendi panelinde, "bu makine" ölçüsü olarak görünür ve koridorun genişlik okumasına hiç girmez.**

EFG 213 için EN 15620 3.20 m ile VDI 3.112 m yan yana durur, ikisi de yayınlanmış, ve panel hangisinin hangi enstrümandan geldiğini söyler. Bu bir hüküm değil, iki ölçüdür.

---

## 3. 3B render — `src/truck/`

### 3.1 Parça listesi ve gövdeler

```ts
export type TruckPartRole =
  | 'chassis' | 'counterweight' | 'cowl' | 'mast-rail' | 'carriage' | 'backrest'
  | 'fork' | 'overhead-guard' | 'cab' | 'platform' | 'tiller' | 'straddle-leg'
  | 'wheel' | 'guide-roller'

export type TruckBody =
  | 'chassis'   // + tahrik tekerleri + karşı ağırlık — düğüme göre ASLA hareket etmez
  | 'steer'     // direksiyon tekeri + tiller: Y ekseninde döner
  | 'mast'      // dış mast: ayakta Z ekseninde eğilir VE reach'te +X'e l4 kadar öteler
  | 'stage1' | 'stage2'   // +Y öteler
  | 'carriage'  // taşıyıcı + sırtlık + çatal: +Y öteler, VE Z ekseninde döner (ETV grup B taşıyıcı-eğimi)
  | 'aux'       // EKX h9 yardımcı kaldırma — carriage'ın çocuğu, +Y
  | 'swivel'    // EKX ±90°, carriage'ın çocuğu
  | 'traverse'  // EKX ±650 mm, swivel'ın çocuğu
  | 'cab'       // EKX man-up
```

Renk **total `Record<TruckPartRole, string>`** — ternary zinciri değil; `rack`'te iki değerin tek dala düşüp aynı slab'ı çizdiği hata bu yüzden çıktı.

`truckParts(spec, detail)` tek fonksiyon, `spec.variant` üzerinden `parts-forklift.ts` / `parts-reach.ts` / `parts-pallet-truck.ts` / `parts-turret.ts`'e dağıtır. Paylaşılan alt-emitter'lar (`pushForkPair`, `pushWheel`, `pushMastStage`, `pushOverheadGuard`) **tek yerdedir**: çatal aritmetiği beş ailede aynıdır ve çatal ucu düzlemi palet alma mantığının okuduğu şeydir.

### 3.2 İki LOD katmanı

| parça | `full` | `simple` |
|---|---|---|
| şasi | katlanmış, 4–7 kutu | 1–2 prizma, **aynı dış zarf** |
| karşı ağırlık | ✔ | ✔ — düşürmek EFG'yi "tekerlekli mast" yapar |
| straddle ayaklar | ✔ + b4 iç yüzleri | ✔ — ayaklar taban izinin ta kendisi |
| mast rayları | kademe başına 2 kutu | **kademe başına 1 kutu** — kademeler korunur, tek prizmaya birleştirilmez |
| taşıyıcı + sırtlık | plaka + 5 çubuk | plaka + 1 levha (yük yüzü var olmalı) |
| çatallar | konik, topuk yarıçapı | 2×1 kutu, tam boy ve açıklık |
| koruyucu tavan | 4 direk + ızgara | 4 direk + 1 levha |
| tekerlekler | prizma | **aynı sayı, aynı pozisyon**, daha az segment |
| kabin içi, hidrolik, zincir, ayna, koltuk, direksiyon, kılavuz makara | ✔ | **düşer** |

Mastın `simple`'da tek Y-ölçekli prizmaya **birleştirilmemesi** iki sebeple: (a) teleskopun kademe kayması yok olur — bu "daha az parça" değil, **farklı bir hareket**tir; (b) `simple`'da var olmayan gövde anahtarları üretir ve attribute-parite testi yazılamaz hâle gelir.

### 3.3 Attribute paritesi — yapısal, disiplin değil

Her iki katman `position, normal, uv, color` yazar ve **aynı materyal örneğini** kullanır. Bu hatırlanacak bir kural değil: tek bir `emitTruckPart` (dört sink'e de yazar) ve tek bir `finish(sink)` (dört attribute'u da set eder) vardır, ikinci bir builder yoktur.

**Kopyalanmayacak emsal, dosyayla:** `pallet/geometry-builder.ts:516-525` uzak katmanı düz bir `new THREE.BoxGeometry` (yalnız `position/normal/uv`), `pallet/materials.ts:156-164` `getPalletFarMaterial()` ise `vertexColors` taşımıyor. Yalnız materyalin aynı ifadede takas edilmesi kurtarıyor. Brief §4b'nin "kıyısından döndük" cümlesi tam bunu anlatıyor. **Araçta uzak katman materyali yoktur ve stok `BoxGeometry` yoktur.**

`emitPart` / `finish` / `Sink` / `toLinear` **`conveyor/geometry-builder.ts`'den import edilir** (`:34`, `:131`, `:256` — hepsi export). Kopyalanmaz.

### 3.4 Geometri cache

**Kendi bounded havuzu**, `CACHE_LIMIT = 96` — `rack/geometry-builder.ts:391` ve `conveyor/geometry-builder.ts:356` ile aynı. Conveyor havuzunu paylaşmak iki kind'ı birbirinin tavanına bağlar ve o havuzun limitini değiştirmek conveyor'ü de etkiler. `evict(justBuilt)` semantiği conveyor'den birebir kopyalanır (tahliye, o kare inşa edileni asla serbest bırakmaz).

```ts
export function truckGeometryKey(spec, body: TruckBody, detail: TruckDetail): string {
  return [spec.modelId, spec.mastRowId ?? '-', body, detail,
          spec.forkLength.toFixed(4), spec.forkSpread.toFixed(4), spec.paintColor].join('|')
}
```

**Anahtarda kasten olmayanlar:** id, isim, pozisyon, rotasyon, **çatal yüksekliği, eğim, swivel, reach stroku**. Hepsi matristir, hiçbiri vertex değildir. Tek kural: **poz asla cache anahtarına girmez.**

Retain: mount edilen aracın **her gövdesi × iki katman**. Forklift 5×2=10, reach 6×2=12. 8 farklı model ≈ 88 giriş, 96'nın altında. Aşıldığında tahliye hiçbir şey serbest bırakamaz ve bellek büyür — **yanlış buffer dönmez, araç boşalmaz**; bu, sahip olunması gereken onurlu bozulmadır ve dosyada yazılıdır.

### 3.5 Mast kinematiği

```ts
mastTopY(mainY) = mainY <= h2 ? h1 : h1 + (h4 − h1) * (mainY − h2) / (h3 − h2)
```

Uçlar **yayınlanmış figürlere birebir oturur**: `mainY = 0` → tam `h1`, `mainY = h3` → tam `h4`. Stroğu eşit dağıtmak ETV'de `h1 + h3 − h2 = h3 + 730` verirdi, yayınlanmış `h4 = h3 + 746`'ya karşı **16 mm** hata — ve o 16 mm mast başında sonsuza kadar yaşardı.

**EKX yardımcı kaldırma (`h9 = 1.780`) mast stroğundan DÜŞÜLMEZ.** Elimizdeki veri (`h4 = h3 + 2550` = `h3 + h6`, ve "kabin çatalla birlikte h3'e kadar yükselir") kabin tabanının çatal kotunda olduğunu söylüyor; düşme kuralı `mastTopY(h3) === h4`'ü **ihlal ederdi**. `h9` ayrı bir serbestlik olarak `aux` gövdesiyle modellenir. Düşülüp düşülmediği **`gaps.ts`'e yazılır** — yayınlanmamış.

### 3.6 `isLive` kuralı

> `isLive = live !== undefined || override !== undefined`. **Filo bu bayrağa dokunmaz** — çünkü filo `useLiveTransforms`'a yazıyor, yani `live` zaten tanımlı oluyor.

`static-transform.ts:19-25` doğrulandı: `isLive === true` iken `matrixAutoUpdate` three'ye geri veriliyor ve position **yazılmıyor** — yani JSX `position` prop'u (pallet/renderer.tsx deseniyle `live ?? override ?? node.position`) hareketi sürer. Bu, üç sessiz hata modunu birden kapatır:

- **Donmuş araç:** olmaz, çünkü `live` tanımlıdır → `matrixAutoUpdate = true`.
- **Boşa optimizasyon:** olmaz, çünkü park hâlindeki araçlarda `live` yoktur → matris donar.
- **Snap-back:** filo durunca `useLiveTransforms.clear(id)` çağrılır ve araç **park pozuna animasyonla değil, bir karede döner** — bu bir *restore*, undo değil, çünkü düğüm verisi hiç değişmedi.

Gövde mesh'leri (mast, taşıyıcı, çatal…) `matrixAutoUpdate = false` tutulur ve kare döngüsü **yalnız o kare hareket eden gövdelere** `position/quaternion` yazıp `updateMatrix()` çağırır. Doğrudan `group.matrix`'e yazıp ardından `updateMatrix()` çağırmak **yazdığını siler** (`three/src/core/Object3D.js` `updateMatrix()` matrisi position/quaternion/scale'den yeniden kurar) — bu yorumla birlikte çağrı yerine yazılır.

---

## 4. 2B plan — `src/truck/floorplan.ts` (tek dosya)

Paketteki beş plan sembolünün beşi de tek dosya (rack 133, route 138, conveyor 117, pallet 123 satır). Altıncısı da öyle.

### 4.1 Ne çizilir

Dönüşüm dört mevcut builder'la birebir aynı: `{ kind:'group', transform:{ translate:[pos[0], pos[2]], rotate: -(rot[1] ?? 0) }, children }` — negasyon doğrulandı (`rack/floorplan.ts:130`, `route/floorplan.ts:101`, `pallet/floorplan.ts:90`).

**Seçili değilken (≤14 primitif):**
- Zarf `rect`, `x:-l1/2, y:-bMax/2` — `fill:'transparent'`, **asla `'none'`** (`none` boya değildir, `pointer-events: visiblePainted` onu hit-test etmez ve araç planda seçilemez hâle gelir; pakette dört dosyada aynı not var).
- `PLAN_ROLES = { 'chassis', 'fork', 'wheel' }` — üç rol. `rack/floorplan.ts`'in `{upright, beam}` kararının aynısı: `carriage`/`cab`/`platform` yukarıdan bakınca gövde dikdörtgenini kalınlaştırmaktan başka bir şey yapmaz. Reach eklendiğinde `straddle-leg` dördüncü rol olur, çünkü ayaklar **taban izinin kendisi**dir.
- Yön ok başı: `conveyor/floorplan.ts` ve `route/floorplan.ts` deseni, **kendi çizdiğimiz** — bkz. §4.4.
- `s` (çatal kalınlığı) planda **yoktur**, `e` (çatal genişliği) vardır. Karıştırmak EFG'de 40–60 mm, AM 15l'de 112 mm hata verir ve ekran görüntüsünde doğru görünür.

**Seçiliyken (+overlay):** `move-handle`, `l1` ve genişlik `dimension`'ları, Wa yayı + pivot işareti, `Ast` bandı, reach'te `b4` ölçüsü.

Host geometriyi ikiye bölüyor (`floorplan-registry-layer.tsx:3266` `splitFloorplanOverlay`): `text`, `dimension*`, handle'lar → overlay; gövde/dolgu → base. Yani ölçüler raf dolgularının altında kalmaz.

### 4.2 `Wa` merkezi — aile başına, aritmetikle çözülmüş

`pivotLocalX = rearToPivot − l1/2` (yerel çerçevede ileri = +X, origin zarfın ortası, arka yüz `x = −l1/2`).

| Aile | `rearToPivot` | Doğrulama | basis |
|---|---|---|---|
| **forklift (EFG)** | `y + 0.190` (ön aks) | `Wa − y` = 191/191/191/190/191/190/190 — **7/7**, ve bu 190, `l2 = 190+y+x` zincirinden bağımsız olarak Wa tarafından teyit ediliyor | **published** |
| **reach (ETM/ETV)** | `0.210 + y` (yük tekeri aksı) | `docs/vehicle-data-vdi.md:151` bunu açıkça yazıyor; `Wa` ile arasında 7 mm (318) / 18 mm (diğer üçü) rezidü var → **daire yayınlanmış Wa yarıçapıyla çizilir, pivot kaydırılmaz, rezidü nota yazılır** | published pivot, notlu |
| **turret (EKX)** | `z + y` | 516'da tam (2502 = 282+2220), 516k'da tam **ama Wa'sı ⚠ işaretli**; 514'te 110 mm, 412'de 38 mm, 410'da 5 mm ayrışıyor (514'ün y'si ⚠) | **estimate** + not |
| **hand-pallet (AM 15l)** | `null` | Wa = 1274 **dört varyantta sabit**, oysa y = 1100/900/745/1080 — hiçbir dingil-türevi pivot bunu veremez | — |
| **powered-pallet (ERE)** | `null` | türetilemedi | — |

`waPivotFromRear === null` olan ailelerde **daire çizilmez**; yerine seçiliyken `dimension-label`: *"Wa 1.27 m — dönüş merkezi yayınlanmamış."* Yayınlanmış bir sayıyı uydurulmuş bir merkeze oturtmak, sayıyı olduğundan çok daha fazlasını iddia eden bir şekle çevirir.

Çizim: 90°'lik süpürme yayı, `path` + `d` içinde `A` komutu. **Sweep bayrağı `conveyor/curve-floorplan.ts:42-58`'den kopyalanır**, tahmin edilmez — orada plan negasyonuyla birlikte dönen bir bayrak zaten öğrenilmiş. `pointerEvents:'none'`. **Yalnız seçiliyken** — filoda her aracın altında 3 m'lik bir yay planı okunmaz yapar.

### 4.3 `Ast` bandı ve EKX

Band: aracın boyuna ekseni etrafında simetrik, `Ast` genişliğinde `rect`, `fillOpacity: 0.12`, **`pointerEvents:'none'` pazarlık dışı** (3.3 × 4 m dolgulu bir dikdörtgen altındaki her rafın tıklamasını yutar; `types.ts:245-254` bu senaryoyu birebir anlatıyor). Ölçü metni palet yönelimini **taşımak zorunda**: EFG 213 için 3.112 ↔ 3.235, 123 mm fark.

Güvenlik payı `a` girintisi: **yalnız yayınlandığı yerde.** ETM/ETV `a = 200`, **AM 15l `a = 200`** (`docs/vehicle-data-vdi.md:35` — doğrulandı), EKX formülde `2×90`. EFG ve ERE'de `a` yayınlanmamış → girinti çizgisi çizilmez. Yayınlanmış tek bir `Ast`'ı uydurulmuş bir `a` ile ikiye bölmek, bir yayınlanmış sayıyı iki uydurulmuş sayıya çevirir.

**EKX'te `Ast` yokken:** hesaplanmış `max(1450, 1697) + 180 = 1877` **çizilmez.** Sebep sadelik değil, bilgi: EN 15620'nin yayınlanmış `trilateral-turret` bandı 1.70–1.90 m ve 1877 zaten onun içinde — ikinci bir sayı hiçbir şey eklemez, yalnız çelişme imkânı ekler. Formül, girdiler ve "Jungheinrich'ten teyit edin" notu **panelde metin olarak** durur, `gaps.ts`'ten. Bunun yanında **transfer koridoru ≥ 4000–4500 mm** ayrı bir kavramdır ve `route.width`'e karıştırılmaz.

### 4.4 Host kısıtları (doğrulandı, hepsi)

| Kısıt | Sonuç |
|---|---|
| `facingIndicator` yalnız **±Z** (`types.ts:926`, `registry.ts:228-232`, `use-facing-pose.ts:22-30`) | Aracın ileri yönü **+X** olduğu için `facingIndicator` **bildirilmez**; plan sembolü kendi ok başını çizer. Ara çözüm yok. |
| `dimension` varyantında **`strokeDasharray` YOK**, **`metadata` YOK** (`types.ts:641-668`) | Tahmini bir ölçü çizgisi yayınlanmış olandan görsel olarak ayrılamaz — ayrım yalnız renkte ve **metindedir**, bu yüzden metindeki ibare opsiyonel değil. |
| `filterFloorplanAnnotationGeometry` `dimension`/`dimension-string`/`dimension-label`/`equal-spacing-badge`'i düşürüyor; **`text` düşürmüyor** (`annotation-visibility.ts:69-78`) | Tahmin/boşluk ibaresi **`text` primitifinde** yaşar, `dimension.text` içinde değil — yoksa kullanıcı annotasyonları kapattığında bant kalır, ibare gider. |
| Filtre **split'ten ÖNCE** çalışıyor (`:1967` → `:2224`) ve grup rolü `inheritedRole` ile çocuklara iniyor | Grup seviyesinde `metadata: { 'pascal:editor/floorplan': { annotationRole: … } }` **çalışır**. Anahtar düz bir string; `@pascal-app/editor` importu gerekmez, SSR zinciri etkilenmez. |
| `stripHandleChrome` çoklu seçimde `dimension` ve `dimension-label`'ı siliyor (`:3303-3313`) | İki araç seçiliyken ölçü katmanı kaybolur — kasıtlı host davranışı, bütçe hesabına dahil. |
| `GeometryContext.viewState`'te zoom/ölçek **yok** (`types.ts:64-85`) | **Planda LOD yoktur.** Primitif sayısı sabittir ve her zoom'da ödenir. |
| `floorplanDependencies` (`:2040`) | `(n) => [n.routeId].filter(Boolean)` verilir. `floorplanDependsOnSiblings` **verilmez** — `siblingEpoch`'u deps'e sokar ve her canlı sürükleme her aracın sembolünü yeniden kurar. |

---

## 5. Hareket ve palet elleçleme

### 5.1 Poz kanalı — `useLiveTransforms`, ve neden

Bu planın en yüksek getirili tek kararı. Dört dosyadan doğrulandı:

1. **Y lifti.** `floor-elevation-system.tsx:73`: `if (dirtyNodes.size === 0 && overrides.size === 0 && transforms.size === 0) return`. Yani imperatif olarak sürülen ve *ne dirty ne live* olan bir araç için sistem **hiç koşmaz** → araç park pozunun kotunda donar, slab kenarını geçmesi kotunu değiştirmez. Ama `useLiveTransforms`'a yazan bir araç için sistem **her karede** koşar (`:63-67` yorumu bunu açıkça anlatıyor) ve `getFloorStackedPosition` ile doğru Y'yi yazar.
2. **2B plan.** `floorplan-registry-layer.tsx:1858`: `const live = useLiveTransforms((s) => s.transforms.get(nodeId))`. Plan sembolü canlı transform'u okuyor. Özel bir modül-map bunu beslemez → 3B'de araçlar gider, 2B'de hepsi donar. Kullanıcının "birebir 3d ve 2d" isteği tam orada kırılır.
3. **Tıklanabilirlik.** `pallet/renderer.tsx:183-191` seçim collider'ı registered grubun **dışında**, ama konumunu `position` değişkeninden alıyor — o da `live ?? override ?? node.position`. Yani canlı transform ile collider aracı **takip eder**; imperatif matris yazımıyla park yerinde kalır ve hareket eden araç tıklanamaz.
4. **`isLive`.** `static-transform.ts` `isLive = live !== undefined` ile doğru davranır; ekstra bir bayrak, bir abonelik hatası ve bir snap-back riski gelmez.

**Bedeli, açıkça:** `use-live-transforms.ts:30-35` her `set` çağrısında `new Map(state.transforms)` klonluyor, ve `floorplan-registry-layer.tsx:1555-1557` her transform değişiminde `invalidateLayout()` → `settledLayoutEpoch` → `:1593` sahne çapında `querySelectorAll('[data-floorplan-annotation-label]')` etiket çakışma pass'i. Bu pass `interactionIdle` ile geçitli ve bir **simülasyon interaction değildir**, yani açık kalır.

**Bu yüzden hareket eden araç sayısı sınırlıdır:** `FLEET_LIMIT = 16` (`src/truck/fleet.ts`'te, `conveyor/flow-simulation.ts`'in `MAX_BOXES` deseni gibi — asla bir test dosyasında değil). Limit aşılırsa fazlası park kalır ve panel kaçının koştuğunu söyler. **Bu sayı ölçülmeden yükseltilmez** ve dilim 2'nin çıkış kriteri onu tarayıcıda ölçmektir.

### 5.2 Sistem mimarisi

```
src/truck/fleet-system.tsx    def.system, priority 6 — sahne başına BİR
src/truck/fleet.ts            saf adımlayıcı: three yok, React yok, host importu yok
src/truck/rig-registry.ts     renderer'ın yayımladığı gövde Object3D'leri (modül kapsamı)
```

- `fleetRunning` kapalıyken ağ **kurulmaz** (`useMemo(() => running ? buildFleet(nodes) : EMPTY)`) — `flow-system.tsx:59-62`'nin aynı gerekçesi.
- `dt = Math.min(delta, MAX_STEP_S=0.1)` — arka planda kalmış sekme tuzağı, `flow-system.tsx:47`.
- `isExporting` (`use-viewer.ts:49-55`, doğrulandı): filo donar, her araç park pozuna döner, taşınan palet kaynak yuvasına döner. Export her zaman düğüm verisiyle birebir tutarlı.
- Gövde artikülasyonu `rigOf(nodeId)` üzerinden imperatif; `rigOf` boşsa araç sessizce atlanır (renderer henüz mount olmamıştır).
- Canlı sürükleme her zaman kazanır: `useLiveNodeOverrides` kaydı olan araç atlanır.
- **Poz rota düğümünün yerel çerçevesindedir** ve **araç ile rotası aynı ebeveyne (level) ait olmak zorundadır**; değilse bağlama reddedilir ve panel söyler. Bu kısıt bir `Matrix4` zincirini ve onunla gelen çeyrek-tur hata sınıfını tamamen ortadan kaldırır.

### 5.3 Rota bağlama

```ts
routeId: z.string().nullable().default(null)
routeAnchor: z.number().min(0).max(1).default(0)   // BAŞLANGIÇ parametresi, canlı ilerleme DEĞİL
```

- **En yakın rota değil, atanmış rota.** İki koridor arasına park etmiş bir araç, kullanıcı bir rafı bir santim kaydırdığında sessizce koridor değiştirirdi; atama görünmez ve düzenlenemez olurdu.
- Kurulum: yerleştirme aracı commit'te en yakın `role === 'vehicle'` rotayı `ROUTE_CLAIM_M = 1.5` içinde talep eder (`placement.ts:electSupportSlab` deseni: commit'te bir kez seç, cevabı sakla).
- **Araç yalnız `role === 'vehicle'` bir rotaya bağlanabilir.** 1.27 m genişliğinde bir ETV'yi `PEDESTRIAN_WIDTH_M` genişliğinde bir yaya yolundan sürmek, panel yaya figürünü alıntılarken boyayı kesen bir makine çizerdi. Yaya yolu simülasyona **engel olarak** girer: aracın zarfı bir yaya yolunun temiz genişliğini kesiyorsa bu panelde bir ölçüdür (kesişme mm), hüküm değil.
- **Sarkan referans doğrulanmış bir gerçektir, açık soru değil:** `types.ts:2292-2295` `cloneNodesInto` için *"Does NOT strip or re-derive host references… the caller is responsible"* diyor ve `hostRefFields` (`registry.ts:240-242`) yalnız preset kaydında okunuyor. Plugin kind'ları için referans temizliği **yoktur**. Kural: rotası bulunamayan araç **hareket etmez** ve panel bunu söyler; hiçbir kod yolunda `undefined.points` okunmaz.
- `traffic` kozmetik değildir: `two-way` → uçta geri döner; `one-way` → uçta `DWELL_S` bekler ve başta yeniden belirir (görünmeyen bir dönüş yolu uydurulmaz — kullanıcı onu çizmemiştir).
- **Rota ağı v1'de yok** ve bu adlandırılmış bir boşluktur: bir araç tek rotasını takip eder; kavşak geçişi geldiği gün şablon `conveyor/flow-simulation.ts:buildNetwork`'ün kovalı hash'idir.

### 5.4 Durum makinesi

```
IDLE → TRAVEL → ALIGN → MAST_LIFT → [EXTEND] → ENGAGE → [RETRACT] → MAST_TRAVEL
     → TRAVEL → ALIGN → MAST_LIFT → [EXTEND] → RELEASE → [RETRACT] → MAST_TRAVEL → DWELL
```

Faz betiği **veridir, kod dalı değil** (aile başına bir dizi). Her fazın süresi **yayınlanmış bir orandan ve yayınlanmış bir mesafeden** hesaplanır: `duration = distance / rate`. Sabit süre yoktur.

| Faz | forklift | reach | turret |
|---|---|---|---|
| `EXTEND` | gövdeyle sür | `l4` stroku, 0.18/0.20 m/s | `traverse` 650 mm, 0.4–0.5 m/s |
| `ALIGN` | `Wa` yayı | pivot / geri sür (180°/360°) | **swivel ±90°** — hız *estimate* |
| `MAST_LIFT` | `Δh / liftMs` | aynı | aynı, kabin de yükselir |

**Yayınlanmamış açısal hız asla uydurulmaz.** Dönüş oranı `ω = v / Wa` **türetilmiş bir yaklaşımdır, yayınlanmış değildir** — `Wa` dış dönüş yarıçapıdır, referans noktasının izlediği yayın yarıçapı değil (EFG'de Wa 1440 vs dingil 1249, %15 fark). `motion-rates.ts`'e `estimate` + not olarak girer.

`fleetSpeed` **yoktur** v1'de: `flowRunning`'in tek düğmesi emsaldir. Eklenirse ölçek yalnız `dt`'yi çarpar, yayınlanmış hızları asla — aksi hâlde panelin yazdığı "çevrim 47 s" yalan olur.

### 5.5 `occupancy` / slot bağlantısı

`src/truck/stations.ts`:

1. Rafları **mevcut memoize indeksten** al — `pallet/slot-placement.ts:127`'deki `rackIndex` bugün `export` **değil**; yanına `racksNear(nodes, x, z, radius)` eklenir. İkinci bir indeks kurmak o dosyanın var oluş gerekçesini bozar (`rack/occupancy.ts`'in doküman bloğu: "bin raf × on bin düğüm").
2. Rotanın merkez hattına yakın ve **koridor yüzü rotaya bakan** rafları seç. Koridor yüzü `depthPositionZ` + `rotationY` üzerinden çözülür — dikkat: tek derinlikte D1 **merkezi Z=0**'dır, ön yüz `+rowDepth/2`'dedir.
3. `palletSlotsOf(rack)` → `slot.directAccess` zorunlu (çift derin bir bayın arka pozisyonu önündekini taşımayı gerektirir ve bunu simüle etmiyoruz).
4. `occupiedSlots(nodes, rackId)` ile kaynak (dolu) / hedef (boş) ayır. Bu indeks paletin **kendi** `slotRackId`/`slotAddress`'ini okuduğu için alma sırasında onları null'lamak yuvayı sıfır kod değişikliğiyle boşaltır.
5. Kaynak–hedef eşlemesi araç id'sinden **FNV-1a ile deterministik** — `occupancy.ts:slotDraw` ve `pallet/renderer.tsx:hashPhase` ile aynı hash. Sahne, dosyasının bir fonksiyonudur: yeniden yükleme, export, undo aynı çevrimi üretir.

### 5.6 Undo / history kararı

> **Simülasyon sahneye hiç yazmaz. Stok hareketi ayrı, kullanıcı tetikli ve tek history kaydıdır.**

Taşıma sırasında sistem **kaynak paletin kendi düğümünün** canlı transform'unu yazar (`useLiveTransforms`) — hayalet kopya yok, ikinci geometri yok, preset problemi yok: **taşınan şey paletin ta kendisidir**, kargosu, filmi, etiketi ve LOD'u dahil doğru görünür. Ve `pallet/renderer.tsx` bugün olduğu gibi çalışır, o dosyaya **hiç dokunulmaz**.

Bu sırada `occupiedSlots` paleti hâlâ kaynak yuvasında sayar — ki **doğrudur**, çünkü henüz hiçbir şey taahhüt edilmemiştir.

Taahhüt yolu — `src/truck/commit-move.ts`, tek çağıran panel düğmesi:

```ts
useScene.getState().applyNodeChanges({ /* palet: slotRackId, slotAddress, position, rotation */ })
```

`applyNodeChanges` ve `updateNodes` `use-scene.ts:1202/1209`'da doğrulandı; `conveyor/curve-tool.tsx:192` bu yolu zaten kullanıyor. **`SceneApi`'de toplu yazma yoktur** (`types.ts:2264-2299`: `get/nodes/update/upsert/delete/restore/markDirty/pauseHistory/resumeHistory/getSubtree/cloneNodesInto`) — ve zaten `sceneApi` yalnız `def.system`'e geçiyor, panele geçmiyor. Yazdığımız şekil `findSlotTarget`'ın ürettiğiyle **aynı olmak zorunda** (Y konvansiyonu dahil, bilerek). Hedef bu arada dolmuşsa `occupiedSlots` yeniden sorulur ve reddedilir.

### 5.7 ETV ↔ ETM kuralı (b4)

`docs/vehicle-data-vdi.md:153-156`, birebir:

- **ETV `b4 = 940`** → 800 mm palet ayaklar *arasına* girer, yere kadar iner.
- **ETM `b4 = 790`** → palet ayakların *üzerinden* taşınır, bırakma kotu ≥ `h8 (+30 kapak) + pay`.

```ts
export function strideModeFor(model, faceWidthM): 'straddle' | 'over-leg'
export function minSetDownY(model, mode): number
```

`faceWidthM = orientedPalletFootprint(rack)[0]` — yuvanın koridora sunduğu yüz (`rack/slots.ts:335`, ve `autoPalletsPerLevel`'ın `const [alongRun] = …` okumasıyla tutarlı). 1000 mm enlemesine bir palet **hiçbirinin** ayakları arasına girmez; kural yönelime bağlıdır.

**Ama bu bir `refused` DEĞİL, bir ölçümdür.** `truckSlotReading(truck, rack, slot)` şunu döner:

```ts
{ reachM, requiredM, strideMode, minSetDownY, slotSurfaceY,
  capacityBasis: 'published' | 'unpublished' }
```

Paneli yazan bundan cümle kurar. Gerekçe `handling/metrics.ts:56-66`'nın kendi kuralı: *"a verdict against an ESTIMATE would launder the estimate"* — ve `pay` bizim tahminimizdir. Yayınlanmış veriden çıkan iki olgu (`h3 = 120 mm` bir transpalet raf yuvasına hizmet edemez; `levelSurfaceY > maxLift` erişilemez) sert `refused` olabilir; b4 sınırı bir niteleme olarak kalır. Ve `SlotRefusal` (`pallet/slot-placement.ts:44` — `'occupied'|'footprint'|'clearance'`) **genişletilmez**: o sözlük *yuva* hakkındadır, bu *araç* hakkında.

**Rezidüel kapasite eğrisi yayınlanmamıştır** (ETM/ETV) → `capacityBasis: 'unpublished'` ve panel *"yüksek h3'te nominal Q taahhüt edilemez"* der. Yayınlanmamış eğriden ağırlık kontrolü uydurulmaz.

---

## 6. Node definition ve bütünleşme

### 6.1 Şema — `src/truck/schema.ts`

```ts
export const TruckNode = BaseNode.extend({
  id: objectId('truck'),                 // tek token; mevcut kindler underscore kullanıyor
  type: nodeType('warehouse:truck'),     // ve host lastIndexOf('_') ile onları çözüyor
  position: tuple3.default([0, 0, 0]),
  rotation: tuple3.default([0, 0, 0]),

  model: z.enum(TRUCK_MODEL_IDS).default(DEFAULT_MODEL_ID),
  /** Sipariş edilen mast — SATIR KİMLİĞİ, figür değil. Modelin sunmadığı bir id
   *  şema hatası değil, bir invariant uyarısıdır. */
  mastRowId: z.enum(MAST_ROW_IDS).nullable().default(null),
  /** Ast'ın hangi yük için okunduğu. Yük ÖLÇÜSÜYLE adlandırılır. */
  referenceLoad: z.enum(['1000x1200', '800x1200']).default('1000x1200'),
  /** Park hâlindeki çatal kotu, metre. Simülasyon üzerine yazmaz — canlı poz düğümde yaşamaz. */
  forkHeight: z.number().min(0).max(18).default(0),

  routeId: z.string().nullable().default(null),
  routeAnchor: z.number().min(0).max(1).default(0),
  duty: z.enum(['parked', 'shuttle']).default('parked'),
  pickSlot: SlotRef.nullable().default(null),
  dropSlot: SlotRef.nullable().default(null),
  carryingPalletId: z.string().nullable().default(null),

  supportSlabId: z.string().nullable().default(null),
})
```

**Her alan `.default()` taşır** — harici paket host'un `migrateNodes`'una satır ekleyemez.

**Şemada kasten olmayanlar ve sebepleri (dosyada yorum olarak):** `variant` (modelden çözülür), `l1`/`b1`/`Ast`/`Wa`/`Q` (figür düğümde tutulmaz), `guidance` (ray zemine cıvatalıdır — §10 soru 5), `tilt`/`swivel`/`traverse`/`steerMode` (görevden türeyen animasyon durumu), **canlı poz** (`conveyor/flow-simulation.ts:22-31`'in kuralı).

**Model kimlikleri kalıcı kullanıcı verisidir.** `z.enum` bir id kaldırıldığında/yeniden adlandırıldığında kaydedilmiş sahnenin düğümünü parse edemez ve düğüm düşer. Doğrulamayı korumak için enum tercih edilir, kural yorumla çivilenir: **eklenir, asla yeniden adlandırılmaz.**

### 6.2 `NodeDefinition`

```ts
category: 'furnish', surfaceRole: 'furnishing', snapProfile: 'item',
// facingIndicator YOK — host yalnız ±Z sunuyor, aracın ileri yönü +X (§4.4)
capabilities: {
  selectable: { hitVolume: 'bbox' }, duplicable: { prepareSubtreeClone }, deletable: true,
  groupable: true, movable: { axes: ['x','z'], gridSnap: true },
  rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES }, snappable: {},
  floorPlaced: {
    footprint: (n) => ({ dimensions: [l1, overallHeight, bMax], rotation: n.rotation }),
    applies: () => true,
    collides: false,      // varsayılan zaten false (types.ts:2065) — belge olarak yazılır
  },
  dragBounds: (n) => ({ size: [l1, overallHeight, bMax], centerY: overallHeight / 2 }),
  hostRefFields: ['supportSlabId', 'routeId'],
  presettable: false,
}
```

- **`bMax = b2 ?? b1`** — yalnız yayınlanmış enine ölçü. EKX'te kabin (1.45) gövdeden (1.21) geniş; `b1` kullanmak seçim kutusunu kabinin içinden geçirir. **`b10 + lastik genişliği` asla girmez**: EFG grup A'da `904 + 178 = 1082 > b1 = 1060`, yani bir ⚠-işaretli tahminden yayınlanmış `b1`'i aşan bir zarf üretirdi.
- **`overallHeight`** modelin yayınlanmış dikey satırlarının maksimumudur; EKX'te bu `h12 = 3.930`, `h6 = 2.550` değil.
- **`collides: false` bir tercih değil.** Host'un testi plan dikdörtgenidir, Y'yi görmez: doğru park pozunda bir aracın **çatalları rafın içindedir**. 3B test `clash.ts`'te, konveyörün yaptığının aynısı.
- **Taban izi açısı `node.rotation[1]`'dir, başka bir şey değil** — `clash.ts:182-183` dönen `rotation`'ı destructure etmiyor, açıyı düğümden alıyor.
- `presettable: false` + `prepareSubtreeClone`: duplicate edilen araç `carryingPalletId`/`pickSlot`/`dropSlot`/`routeId` taşırsa iki araç aynı paleti talep eder.

### 6.3 Panel ve `parametrics`

```ts
groups: [
  { label: 'Truck', fields: [ model(custom), mastRowId(custom), referenceLoad(custom), forkHeight(number) ] },
  { label: 'Duty',  fields: [ duty(segmented), routeId(custom) ] },
],
trailingSection: () => import('./truck-panel'),   // ZORUNLU
invariants: [ ... ],
```

**Üç alan `kind: 'custom'` olmak zorunda, ikisi doğrulanmış host kısıtı:**
- `routeId` → `kind: 'ref'` **hiç render edilmiyor**: `parametric-inspector.tsx:441` *"material / ref / unrecognized kinds — not implemented in v1"*, `return null`.
- `mastRowId`, `referenceLoad` → `ParamField` enum seçenekleri **statik** (`types.ts:2206-2212`, `options: readonly string[]`); modele göre daraltılamaz, ve `visibleIf` alanı gizler, seçeneği değil. Emsal paketin kendisinde: `rack/auto-fields.tsx:26-33` — *"`kind: 'custom'` exists… Being wrong about it cost more than the duplicated markup."*

**`trailingSection` olmadan `invariants` çöpe gider** — `panels/issue-list.tsx:9-22` doğrulandı: *"declared on the host's `NodeDefinition` and read by nothing."*

**`invariants` yalnız tek düğümün saf fonksiyonudur** (`types.ts:2107`: `ReadonlyArray<(n: N) => Issue[]>`). Sahneyi okuyan her bulgu — koridor payı, raf erişimi, rota kesişimi — `trailingSection` bileşenine gider; `route-panel`/`rack-panel` zaten öyle yapıyor.

Panelin yazacakları: model figürü + enstrümanı, `gaps.ts` metinleri kelimesi kelimesine, bayat mast satırı uyarısı, sarkan `routeId`, koridor payı. **Hüküm yok** — tek istisna, mevcut emsalin izin verdiği hâl: *yayınlanmış* bir banda karşı negatif pay `severity: 'error'` olabilir (`route/parametrics.ts:90-95` bunu bugün yapıyor, "yasal bir sınır değil" ibaresiyle); *tahmine* karşı asla.

### 6.4 Yerleştirme aracı

`rack/tool.tsx`'in deseni: `subscribeGridMove` + `resolveAlignedPlacement` + `subscribePlacementClicks` + `getFloorStackPreviewPosition` + `electSupportSlab` + `canPlaceOnFloor` + `isClearAt`, Alt ile zorlama. `R`/`T` 45° döndürür. Commit'te `name` modelin etiketiyle yazılır (outliner'da 20 satır "Truck" yerine "EFG 216").

`useFacingPose` **yayımlanmaz** (facingIndicator yok).

**`placement.ts:44-68`'e `'warehouse:truck'` eklenir.** Liste doğrulandı: `warehouse:pallet`, `warehouse:pallet-rack`, `warehouse:conveyor-roller`, `warehouse:route` var; beş conveyor şekli (curve/launcher/booster/transfer/oblique) **eksik** — ayrı bir `fix:` olarak kaydedilir, bu PR'ın işi değil.

### 6.5 Katalog

`catalog.ts`'e **tek tile** (`warehouse:pallet`'in sekiz preset'i tek tile ile taşıması gibi), `brush: { kind: 'truck', model }`. Panelde `handling` bölümü altında `LoadBrush`'ın muadili: aile → model listesi (her satırda `Ast` ve `Wa`; yayınlanmamışsa renksiz bir "Ast yayınlanmamış" rozeti) → mast satırı (model tablo sunmuyorsa **bölüm hiç çizilmez**, gri kontrol değil) → referans yük.

`store.ts`: `truckBrush` (+ `model` yamanınca `mastRowId` sıfırlanır — `setRouteBrush`'ın "genişlik sınıfı takip eder" kuralının aynısı) ve `fleetRunning` (varsayılan **false**, `flowRunning`'in yanına, aynı gerekçeyle). `FleetSwitch` `handling` bölümüne, `FlowSwitch`'in `conveyance`'ta olduğu gibi.

### 6.6 `clash`, `stats`, `route`

| Dosya | v1'de | Sonra |
|---|---|---|
| `clash.ts` | **İş yok.** `footprintBox` (`:174-184`) registry'den okuyor, `envelopeOf` (`:371-385`) ona düşüyor — `floorPlaced.footprint` bildiren araç çarpışmaya bedavaya girer. | Dilim 3: `occupiedVolumes`'e üç kutulu araç dalı (şasi / mast / çatallar), böylece çatalı bay açıklığındaki araç çelikle çakışmaz. |
| `stats.ts` | **Yeni figür yok.** Üç figür (storage/picking/footprint) ve araç üçüne de katkı vermiyor; `placed` chip'i `KIND_PREFIX` taradığı için araçları kendiliğinden sayar. | Dilim 3: `travellingPallets` + `'travelling-pallets'` qualification — ve `stats.ts:440-444`'ün **ertelenmiş `racked[]` desenini** kopyalayarak, tek geçişli `walk` içinde anında değil (aracın hangi paleti taşıdığı o an bilinmiyor olabilir). "Never subtract — disclose". |
| `route/parametrics.ts` | Terfi yapılırsa **zorunlu**: yayınlanmış dalda `band.note` okunmalı, `:94`'teki gömülü atıf veriden gelmeli. | — |
| `route/schema.ts` | **DOKUNULMAZ.** | §10 soru 5. |
| `index.ts` | `truckDefinition` manifest'e; `kinds` listesine `'warehouse:truck'` **ve eksik olan `'warehouse:route'`** (doğrulandı: `:65-74` 8 kind listeliyor, `:36-46` 9 kaydediyor). | — |

---

## 7. Test planı

Değerli test, **makul görünen belirli bir yanlış cevabın üretilmediğini** iddia edendir.

### Ölçü zinciri ve veri (dilim 0–1)

| # | İddia | Yakaladığı sessiz hata |
|---|---|---|
| T1 | AM/ERE/EFG/ETV'de `l1 = l2 + fork.length` | Transkripsiyon |
| T2 | **EKX jenerik zinciri REDDEDER** — `l1 − l2 = 0.286`, çatal 1.200, sapma 914 mm | Yanlış genelleme; 914 mm'lik görünmez taban izi hatası |
| T3 | EFG `l2 = 0.190 + y + x`, 7/7 · ETV `x = (0.210 + y) − l2`, 4/4 | Transkripsiyon (ama `x`/`l2` bu formülden *hesaplanıyorsa* totoloji olur — o hâlde alan `basis: 'estimate'` taşımalı) |
| T4 | ERE kompakt: `l1 −0.103` ama `Ast −0.108` → **`Ast` `l1`'den türetilemez** | Formülle uydurulmuş koridor |
| T5 | Yayınlanmış çift taşıyan **13 satırın hepsinde** `ast.load1000x1200 < ast.load800x1200` | Palet yönelimi karışması |
| T6 | Hiçbir `travelKmh` `0` değil; sunulmayan paket `null` | ETM325/ETV325'in boş sütunu 0 olarak parse edilir, araç asla hareket etmez, simülasyon hatası sanılır |
| T7 | `bMax === b2 ?? b1`; hiçbir taban izi `b10 + lastik`ten türemez | EKX kabin genişliği kaybı (240 mm), tahminden yayınlanmış zarf |
| T8 | ETV `h4 = h3 + 0.746`, `h2 = h1 − 0.730` her satırda; EKX `h4 = h3 + 2.550` | Mistyped satır sessizce mastı büker |
| T9 | Tablo satırları **arasındaki** bir `h3` için `mastRowFor` asla satır dönmez | Enterpolasyonla uydurulmuş konfigürasyon |
| T10 | `TRUCK_MODELS['ekx-*'].ast === null`; her yayınlanmış `null`'ın bir `KNOWN_GAPS` girişi var | "Makul bir aralıkla" doldurma |
| T11 | `TRUCK_EQUIPMENT` referans değerine derin eşit; `aisleBandForVariant('turret')` = 1.7–1.9, `published` | Tek yönlü terfi varsayımı |
| T12 | Her `…M` erişimcisi **< 100**; hiçbir katalog literal'i > 100 | `1530`'un metre alanına yazılması |
| T13 | Her tahmin yaprağının boş olmayan notu var | Basis çamaşırhanesi |
| T14 | Hiçbir kind dizesi / dosya adı / `presentation.label` / `CATALOG_ITEMS[].label` üretici adı içermez; model id'leri nötr slug | İncelemeden geçen marka ihlali (`models.test.ts`'te tek assertion, ayrı dosya değil) |

### Sözleşme ve geometri (dilim 1)

| # | İddia | Yakaladığı |
|---|---|---|
| T15 | `TruckNode.parse({})` başarılı; round-trip kayıpsız | Varsayılansız alan kaydedilmiş sahneyi kırar |
| T16 | Serileştirilmiş düğümde **hiçbir ölçü anahtarı yok** | Katalog düzeltmesinin propagasyonunun durması |
| T17 | `warehousePlugin.nodes` ↔ `warehouseCatalogPanel.kinds` ↔ `CATALOG_ITEMS[].kind` kapalı | Bugünkü `warehouse:route` boşluğunu da yakalar |
| T18 | `truckParametrics.trailingSection` tanımlı; her şema alanı ya bir gruba ya `DELIBERATELY_HIDDEN`'a giriyor (`rack/parametrics.test.ts` coverage bloğunun kopyası) | Uyarıların sessiz kaybı; erişilemez alan |
| T19 | **Her model × her katman × her gövde için `Object.keys(geometry.attributes).sort()` eşit** (`['color','normal','position','uv']`); `getTruckMaterial()` iki katmanda referans-eşit; uzak katman materyali export edilmemiş | Tüm karenin komut tamponunun düşmesi |
| T20 | İki katmanın bounding box genişliği aynı; uzak katman `full`'ün %35–60'ı | LOD geçişinde pop; iskelet uzak katman |
| T21 | Cache anahtarı kapsamı **iki yönlü**; `forkHeight`/`tilt`/`swivel`/`reach` anahtarı **değiştirmez** | Ayarı yok sayan araç / boşa bölünen cache |
| T22 | 0/90/180/270°'de plan zarfı = `floorPlaced.footprint` = 3B bbox, aynı dünya dikdörtgeni; çatal ucu 90°'de `(0, ±l1/2)` | **Çeyrek tur** — bu pakette bir kez gerçekten oldu |
| T23 | `waPivotFromRear` işaretiyle: EFG 213 → `pivotLocalX = 1.439 − 1.4665 = −0.0275` (merkezin **arkasında**) | Ters işaret; 0°'de görünmez, yayı 55 mm yanlış yere oturtur |
| T24 | Plan çıktısındaki hiçbir dolgulu primitif `fill: 'none'` değil; Ast bandı ve Wa yayında `pointerEvents: 'none'` | Seçilemeyen araç; altındaki rafların tıklamasını yutan bant |
| T25 | Seçilmemiş sembol ≤ 14 primitif | Bütçe regresyonu (conveyor'ün 8'lik kuralının araç karşılığı) |
| T26 | Rest pozunda iç içe geçme yok; en alçak vertex `[0, 1 mm]` | Havada duran / zemine gömülü araç |

### Hareket ve elleçleme (dilim 2–3)

| # | İddia | Yakaladığı |
|---|---|---|
| T27 | `step()` `nodes`'u mutasyona uğratmaz ve nesne kimliği 600 adımda değişmez; **`occupiedSlots(nodes, id)` aynı Set nesnesini döndürür** | Store-write treadmill — ve fixture 200 raf + 100 palet içerir, çünkü **boş sahne bunu gizler** |
| T28 | Poz rota düğümünün **yerel** çerçevesinde; farklı ebeveyn bağlanmayı reddeder | Asma kattaki aracın zemin katında sürmesi |
| T29 | Filo durunca her araç ve taşınan palet düğüm pozuna döner; `useLiveTransforms` temizlenir | Kalıcı hayalet poz |
| T30 | Koşarken rota kısaltılınca dizi dışına taşılmaz; silinen rota aracı park ettirir | Çökme / sarkan referans |
| T31 | `matrixAutoUpdate` sürüş adımından sonra doğru; filo `updateMatrix()` çağırdıktan sonra gövde matrisi **rest pozuna dönmemiş** | `.matrix` yazıp `updateMatrix()` çağırmanın yazdığını silmesi |
| T32 | ETM325 + 800 mm yüz → `strideMode: 'over-leg'`, `minSetDownY ≥ h8 + 0.030 + pay`; ETV320 aynı yuvada `'straddle'`, `minSetDownY === 0`; 1000 mm enlemesine palet **her ikisinde** `'over-leg'` | Tek harf farkla anılan iki modelin kopyala-yapıştırla karışması |
| T33 | Bırakma yalnız `palletSlotsOf`'un gerçekten ürettiği bir adrese gider; dolu yuva reddedilir | Hayalet palet |
| T34 | Aynı sahne aynı çevrimi tekrar üretir (deterministik hash) | Yeniden yüklemede sahnenin kullanıcının altından değişmesi |

---

## 8. İş sırası

Her adım `bun run check-types && bunx biome check . && bun test` yeşil biterek.

**S0 — Zincirleri dondur, düğüm yokken.**
`handling/chains.ts` + `chains.test.ts`. Kind yok, şema yok, renderer yok.
*Çıkış:* T1–T4. Özellikle T2: **EKX jenerik zinciri reddediyor.** Bir transkripsiyon hatası burada yakalanmazsa taban izine, floorplan'a, çarpışma kutusuna ve kaydedilmiş sahneye gömülür — ve her aşağı akış figürü kendi içinde tutarlı kalır, yani makul görünür.

**S1 — Model kataloğu ve boşluk kaydı.**
`handling/models.ts` (metre, `mm()` ile), `handling/masts.ts`, `handling/gaps.ts`, `handling/constants.ts` genişletmesi + `models.test.ts`.
*Çıkış:* T5–T14. EFG mast tabloları, ETV mast satırları ve EKX >14500 satırları **`gaps.ts`'e girer** — aralıktan satır uydurulmaz.

**S2 — Model bazlı okuma; sınıf bandı kararı.**
`aisleFigureForModel` + `aisleBandForVariant`'a (terfi seçilirse) ikinci dal + `route/parametrics.ts` düzeltmesi.
*Çıkış:* T11 + `metrics.test.ts:20`'ye dokunulmadan `:39-50`'nin bilinçli düzenlenmesi. **Risk B burada ve daha erken hiçbir yerde görünmez.**

---

### ▶ **DİLİM 1 (ilk dikey dilim) — `forklift` / EFG 216, park hâlinde, uçtan uca**

Kapsam: **tek aile, tek varsayılan model**, hareket yok, palet elleçleme yok.

**S3 — Kind, şema, tanım, katalog.**
`truck/schema.ts`, `truck/definition.ts`, `truck/metrics.ts` (`planLengthM`/`planWidthM`/`overallHeightM`/`forkTipX`/`waPivotLocalX`), `catalog.ts` tile, `store.ts` brush, `placement.ts` satırı, `index.ts` (+ eksik `warehouse:route`).
*Çıkış:* T15–T18, T22, T23.

**S4 — 3B renderer + LOD.**
`truck/parts.ts`, `truck/parts-forklift.ts`, `truck/geometry.ts` (conveyor'ün `emitPart`/`finish`'inden), `truck/materials.ts`, `truck/truck-texture.ts`, `truck/renderer.tsx`, `truck/preview.tsx`, `truck/kinematics.ts`.
*Çıkış:* T19–T21, T26. **Risk C burada, tarayıcıya çıkmadan görünür.**

**S5 — 2B plan + panel + araç.**
`truck/floorplan.ts`, `truck/parametrics.ts`, `truck/truck-panel.tsx`, `truck/tool.tsx`.
*Çıkış:* T24, T25 + panelde `Ast`/`Wa`/mast/boşluk metinlerinin görünmesi.

**→ Dilim 1 tek başına yayınlanabilir ve tek başına faydalıdır:** koridor genişliğini ve raf erişimini doğrulayan bir nesne — brief §2'nin kendi çerçevesi. Yanlış taban izine sahip *hareketli* bir kamyon, hareketli bir yanlış cevaptır.

---

**S6 — Hareket (aynı model).**
`truck/fleet.ts` (saf), `truck/fleet-system.tsx`, `truck/rig-registry.ts`, `truck/route-binding.ts`, `truck/route-index.ts`, `store.ts` `fleetRunning`, `FleetSwitch`.
*Çıkış:* T27–T31. **Fixture 200 raf + 100 palet + 20 araç.** Ayrıca tarayıcıda: 16 araç hareket ederken kare süresi ve 2B plan tepkisi ölçülür; `FLEET_LIMIT` bu ölçümle sabitlenir.

**S7 — Rota takip geometrisi.**
`route/stripes.ts`'in `offsetCentreline`'ı **yeniden kullanılır**; yay-uzunluğu örnekleyicisi oraya yeni bir fonksiyon olarak yazılır (`conveyor/flow-routes.ts:sampleRoute` kopyalanmaz — `routeLengthM` zaten iki yerde ve üçüncüsü yazılmaz).
*Çıkış:* aracın sürdüğü yol, boyayı ve plan sembolünü üreten aynı fonksiyondan türer; `|lateral| + araçYarıGenişliği ≤ width/2` panelde ölçü olarak raporlanır.

**S8 — `reach` ailesi + palet alma/bırakma.**
`truck/parts-reach.ts` (straddle ayaklar, b4 iç yüzleri, reach stroku), `truck/reach-rules.ts`, `truck/stations.ts`, `truck/duty.ts`, `truck/commit-move.ts`, `pallet/slot-placement.ts`'e `racksNear` eklemesi, `stats.ts` `travellingPallets`, `clash.ts` üç kutulu dal.
*Çıkış:* T32–T34.

**S9 — Kalan aileler.**
`hand-pallet` + `powered-pallet` (tek gövde statik; h3 = 120 mm tavanı; AM 15l'de yayınlanmış sürüş hızı **yok** → varsayılan `duty: 'parked'` ve panel bunu söyler) → `turret` (b2 kabin, man-up, swivel/traverse, kılavuz, transfer koridoru; EKX `h1` ve DZ `h2` **yayınlanmamış** olduğu için mast kapalı hâli `estimate` + not, ya da aile buraya kadar bekletilir).

**S10 — `agv`.** Rapor yok. `TRUCK_VARIANTS`'ta kalır (çıkarmak kaydedilmiş `route.requiredFor` değerlerini kırar), ama yerleştirilebilir model **yoktur** ve panel bunu açıkça söyler.

---

## 9. Riskler — ilk üç

### Risk A — Poz kanalının maliyeti (2B layout treadmill). **S6'da görünür.**
`use-live-transforms.ts:30-35` her `set`'te Map klonluyor; `floorplan-registry-layer.tsx:1555-1557` her transform değişiminde `invalidateLayout()` → `:1593` sahne çapında `querySelectorAll` etiket çakışma pass'i, ve bu pass `interactionIdle` ile geçitli — **bir simülasyon interaction değildir**, yani açık kalır. Ayrıca `:1858`'deki per-node abonelik her araç için kare başına bir React render'ı demektir.
*Belirti:* "araçlar yavaş" değil — **"editör yavaşladı, 2B panel takılıyor"**, yani suçlu yanlış modülde aranır.
*Kontrol:* `FLEET_LIMIT = 16` üretim kodunda; T27 (`occupiedSlots` aynı Set); ve S6'nın çıkış kriteri **tarayıcıda ölçmektir**, bun bunu söyleyemez.
*Alternatifin neden daha kötü olduğu:* imperatif matris yazımı bu maliyeti kaldırır ama üç şeyi birden sessizce bozar (Y lifti, 2B, tıklanabilirlik) — üçü de §5.1'de dosyayla gösterildi.

### Risk B — Basis çamaşırhanesi. **S2'de ve daha erken hiçbir yerde görünmez.**
VDI 2198 `Ast` (model bazlı, tek sayı, `a = 200` payı içinde, zemindeki palete dik açı) ile EN 15620 koridor bandı (sınıf bazlı aralık, yükler arası, `handlingClass` + `maxLift` ile paketlenmiş) **iki farklı enstrümandır**, ve sayılar çakışıyor ama örtüşmüyor: EN forklift 3.20–3.50, VDI EFG 3.112–3.469. Birini diğerinin yerine koymak `basis: 'published'` etiketini korurken sayının **anlamını** değiştirir. İkinci yüzü: terfi seçilirse `hand-pallet` için yeni yayınlanmış rakam (1.584) mevcut tahminden (2.1) **dar**, yani `route/metrics.ts:29` üzerinden her yeni transpalet koridoru 1.58 m'de doğar — hiçbir migrasyon, hiçbir mesaj.
*Belirti:* Yok. Sayı makul, tutarlı, ve yanlış enstrümandan.
*Kontrol:* İki ilişkisiz tip (`AisleBand` / `ModelAisleFigure`); T11; `TRUCK_EQUIPMENT` derin eşitlik; ve `route/parametrics.ts`'in aynı PR'da düzeltilmesi.

### Risk C — LOD attribute daralması, artık **hareketli** bir nesnede. **S4'te görünür.**
three r185'te pipeline geometri düzeninden derlenir ama `WebGPUBackend.needsRenderUpdate` yalnız `{object, material}` bakar; katman değişince attribute kümesi daralırsa bayat pipeline yeniden kullanılır ve **tüm komut tamponu** düşer — tek nesne değil, tüm kare. **Tuzak diskte bugün canlı:** `pallet/geometry-builder.ts:521` düz `BoxGeometry` (`color` yok) + `pallet/materials.ts:158` `vertexColors` taşımayan materyal; kurtaran tek şey materyalin aynı ifadede takas edilmesi.
*Neden araçta daha kötü:* Palet bandı bir kez geçer ve durur; araç **sürekli** geçer, her geçiş bir kumar.
*Belirti:* "araç garip göründü" değil — **"kamyon 45 m halkasını geçerken tüm sahne titredi"**, ve kimse bunu kamyona bağlamaz.
*Kontrol:* T19, saf bir assertion ve renderer yazılmadan **önce** var olur.

*(İkincil, hepsi doğrulanmış: `0 km/h` boş-sütun tuzağı; EKX `b2 = 1450 > b1 = 1210`; ETM `b4 = 790`; ETM/ETV rezidüel eğri; `parametrics.invariants` sessiz kaybı; `warehouseCatalogPanel.kinds`'teki mevcut `warehouse:route` boşluğu; çeyrek tur.)*

---

## 10. Kullanıcının karar vermesi gerekenler

1. **`hand-pallet` / `powered-pallet` sınıf bandı terfi etsin mi?**
   (a) Etsin — sınıf bandı yayınlanmışa terfi eder, ama **yeni çizilen transpalet koridorlarının varsayılan genişliği 2.10 → 1.58 m olur** ve `MANOEUVRING_NOTE`'un "no standard rates it" cümlesi yanlış hâle gelir.
   (b) Etmesin — sınıf bandı 2.10'da kalır, VDI figürü yalnız aracın kendi panelinde ikinci bir satır olarak görünür.
   **Önerim: (b) ile başla, (a)'ya bilinçli bir commit ile geç.** Brief §7 terfiyi *izin veriyor*, zorunlu kılmıyor; ve "bilerek yapmak" tam olarak bu sorunun cevaplanması demek.

2. **Filo tavanı 16 kabul edilebilir mi?** Gerçek bir 60.000 m² saha 30–40 araç işletir. 16, `useLiveTransforms` kanalının ölçülmemiş maliyeti yüzünden seçilen muhafazakâr bir başlangıç. Daha yüksek bir sayı gerekiyorsa S6'da ölçüm yapılır ve gerekirse 3B/2B ayrıştırılır (o zaman 2B'nin hareketi kaybolur).

3. **Palet hareketi sahneye taahhüt edilsin mi?** Önerim: simülasyon görsel, taahhüt **kullanıcı tetikli tek bir panel aksiyonu**. Alternatifler: hiç taahhüt yok (filo saf görselleştirme) veya otomatik taahhüt (reddedildi — her bırakma bir undo adımı). Bu karar filonun bir *görselleştirme* mi yoksa *düzenleme aracı* mı olduğunu belirler ve başka hiçbir soru bundan bağımsız cevaplanamaz.

4. **Model kimlikleri nötr slug mı (`counterbalanced-3w-1600`), marka adı mı (`efg-216`)?** Kimlikler **kalıcı kullanıcı verisidir**; hukuki bir sebeple sonradan yeniden adlandırılamaz. Önerim: nötr slug; marka adı yalnız `label` ve `source` atıf dizelerinde. Geri dönüşü yok.

5. **`route`'a `guidance: 'none' | 'rail' | 'wire'` eklensin mi?** EKX koridorda direksiyonu kilitli çalışır ve kılavuz (1103 mm ray dayanağı / endüktif tel) **zemine** aittir. `.default('none')` ile kaydedilmiş sahneler bozulmaz, ama bu mevcut bir kind'ın şemasına alan eklemek demek. Alternatif: hiç eklenmez ve "EKX kılavuzlu koridor ister" yalnız `gaps.ts` notu olarak panelde durur. **Önerim: eklenmesin (dilim 9'a kadar).**

6. **EKX 514'ün `y` değeri.** Yayınlanmış `Wa = 2122`, `y = 1840` gerektiriyor (ki bu tam olarak EKX 412'nin değeri); rapor birleşik sütundan 1950 atamış ve bunu ⚠ ile kendisi işaretlemiş. (a) 1950'yi sakla + çelişkiyi not olarak taşı ve daireyi yayınlanmış `Wa` ile çiz [önerim], (b) 1840'a düzelt, (c) modeli teyide kadar kullanılamaz işaretle.

7. **EKX'in kapalı mast yüksekliği `h1` ve DZ `h2`'si yayınlanmamış.** `turret` ailesi (a) bunlar `estimate` + notla mı gelsin, (b) yoksa veri teyit edilene kadar mı bekletilsin? **Önerim: (b)** — bir Man-Up aracın kapalı mastını uydurmak, brief §1'in reddettiği tek şey.

8. **`referenceLoad` düğümde bir alan mı, yoksa hizmet ettiği raftan mı türetilsin?** Yönelim `Ast`'ı 123 mm'ye kadar değiştiriyor. Önerim: şema alanı (`.default('1000x1200')`), çünkü araç genellikle raftan önce yerleştiriliyor; ama iki yerde durursa ayrışır.

9. **`agv` sınıfı.** Rapor yok. Önerim: `TRUCK_VARIANTS`'ta **kalsın** (çıkarmak `route.requiredFor` enum'unu daraltır ve kaydedilmiş sahneleri kırar), yerleştirilebilir model olmasın, ve panel "modellenmedi" desin. Alternatif — her ölçüsü etiketli tahmin olan jenerik bir AGV — şemanın "her ölçü katalogdan" kuralını ilk günden deler.

---

### Değişecek mevcut dosyalar (tam liste)

`src/index.ts` · `src/catalog.ts` · `src/store.ts` · `src/placement.ts` · `src/panels/catalog-panel.tsx` · `src/handling/metrics.ts` · `src/handling/constants.ts` · `src/handling/metrics.test.ts` · `src/route/parametrics.ts` *(terfi seçilirse)* · `src/pallet/slot-placement.ts` *(dilim 8: `racksNear`)* · `src/clash.ts` *(dilim 8)* · `src/stats.ts` *(dilim 8)*.
**Değişmeyecekler:** `src/handling/catalog.ts`, `src/route/schema.ts`, `src/pallet/renderer.tsx`, `src/compat.ts`, `src/host-adapter.ts`, ve host reposundaki hiçbir dosya.
