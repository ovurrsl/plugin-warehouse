# Araç araştırması — doğru mimari

Bu dosya, depo araçları (iş makineleri) için yapılacak araştırmanın **hangi hedefe göre**
yazılması gerektiğini tanımlar. Elimize ulaşan ilk beş rapor (AM 15l, ERE 225i, EFG 213–220,
ETM/ETV 318–325, EKX 410–516) veri bakımından iyi, hedef bakımından yanlıştı: bağımsız bir
React + three **r128** uygulaması varsayıyorlardı. Bu paket öyle bir uygulama değil.

Bir sonraki araştırma turu bu dosyayı brief olarak alsın.

---

## 0. Hedef nedir

`@ovurrsl/plugin-warehouse` — Pascal editörü için bir **node pack**. Host'un
`NodeDefinition` sözleşmesine bağlanır; kendi canvas'ı, kendi kamerası, kendi render
döngüsü **yoktur**.

Bu, gelen raporların en çok yanıldığı yer. Somut olarak:

| Rapor ne varsayıyor | Gerçek |
|---|---|
| three **r128** (`CapsuleGeometry` yok, `OrbitControls` ayrı yüklenir) | three **0.185** — WebGPU renderer, node materyaller. r128 kısıtları geçersiz. |
| `src/vehicles/ekx/EkxPlan2D.tsx` — serbest SVG bileşeni | Plan `def.floorplan(node, ctx)` → `FloorplanGeometry` döndürür. Serbest SVG mount edilemez. |
| `<Canvas>`, `OrbitControls`, `ambientLight` kurulumu | Sahne, kamera ve ışıklar host'undur. Biz sadece `def.renderer` içinde bir `<group>` mount ederiz. |
| Kendi `useState` durumu, model dropdown'ı | Durum node şemasındadır (Zod). Değiştirme yüzeyi `parametrics`'tir. |
| `localStorage` yasağı (artifact ortamı) | İlgisiz. Sahne host'un store'unda. |
| "60 fps hedefi: tüm geometri `useMemo`" | Yetersiz. Bizde paylaşımlı geometri cache + `retain`/`release` + iki katmanlı LOD zorunlu (§4). |

**Kural:** raporun **verisi** istenir, **uygulama talimatı** istenmez. Rapor "şu bileşeni şöyle
yaz" demesin; "şu ölçü şudur, kaynağı budur, şu değer yayınlanmamıştır" desin.

---

## 1. Birinci kural: her sayının bir *basis*'i vardır

Bu paketin en sıkı disiplini. `handling/metrics.ts`:

```ts
export type AisleBand = {
  min: number; max: number
  basis: 'published' | 'estimate'
  label: string
  /** Carried verbatim to any display. Empty for a published band. */
  note: string
}
```

Bir sayı ya **yayınlanmış**tır (atıf verilebilir kaynak + baskı tarihi) ya da **tahmin**dir
(ve notu kullanıcıya kelimesi kelimesine taşınır). Üçüncü hâl yok. Karıştırmak yasak.

Gelen raporlar bunu zaten işaretlemiş — ama her biri **başka bir sözlükle**:

| Rapor | İşareti | Bizdeki karşılığı |
|---|---|---|
| EKX | `"_assumption": "…VDI sütun dizilişinden atandı"` | `basis: 'estimate'` + note |
| EFG | `"_merged": ["gradeability: 216k/216 birleşik hücre"]` | `basis: 'estimate'` + note |
| ETM/ETV | `[TAHMİN]` / `[EŞLEME-TAHMİN]` | `basis: 'estimate'` + note |
| AM 15l | "Bileşen konum koordinatları **mühendislik tahminidir**" | `basis: 'estimate'` + note |
| ERE 225i | "dikey geometri ±%5–10" | `basis: 'estimate'` + note |

Bir sonraki rapor **tek sözlük** kullansın: her alanın yanında `basis` ve gerekiyorsa `note`.
Marker'ı düşürmek, tahmini yayınlanmış figüre terfi ettirmektir; bu paketin reddettiği tek şey
budur.

### Ve terfi tek yönlü değildir

EKX raporu bunu kanıtladı. Bugün `turret` sınıfı EN 15620'nin yayınlanmış koridor bandını
kullanıyor. EKX'in üretici sayfası **Ast yayınlamıyor** (`"Ast_published": null`, pratik aralık
1600–1900 mm "teyit edin" notuyla). Yani üretici verisi burada elimizdekinden **zayıf**.

Rapor, bir figürün yayınlanmadığını bulduğunda bunu **bulgu olarak** yazsın; boşluğu makul bir
aralıkla doldurup yayınlanmış gibi sunmasın. `TRUCK_EQUIPMENT`'taki `null`'lar da aynı sebeple
var:

> **The nulls are the honest half.** … Filing them under a rated row would hand back a number
> that reads as published and was invented.

---

## 2. Neye ihtiyacımız var, neye yok

Bu paket bir **yerleşim** aracıdır. Araç, kendi başına bir ürün vitrini değil; koridor
genişliğini, dönüş alanını ve raf erişimini doğrulayan bir nesnedir.

### Gerekli (yayınlanmışsa altın değerinde)

| Alan | Neden |
|---|---|
| `Ast` — palet yönelimi başına (800×1200 boylamasına / 1000×1200 enlemesine) | `route` düğümünün koridor okuması. **En değerli tek sayı.** |
| `Wa` — dönüş yarıçapı | Manevra alanı, transfer koridoru |
| `l1`, `l2`, `b1`, `b5`, `e`, `s` | Taban izi + `capabilities.floorPlaced.footprint` + çarpışma |
| `y` (dingil), `x` (yük mesafesi) | Dönüş pivotu, plan sembolü |
| Mast tablosu `h1/h2/h3/h4` (satır satır) | Raf yüksekliği erişim doğrulaması. **Ara değer enterpole edilmez** — yalnız tablo satırları geçerli konfigürasyondur (ETM/ETV raporu bunu doğru söylüyor). |
| Kapasite `Q` + yük merkezi `c` + **rezidüel kapasite eğrisi var mı** | ETM/ETV: eğri yayınlanmamış → yüksek `h3`'te nominal `Q` taahhüt edilemez. Bu bir kısıt, eksik veri değil. |
| Lastik çapları, iz genişlikleri `b10`/`b11` | Plan sembolü, tekerlek yerleşimi |
| Servis ağırlığı + aks yükleri | Zemin taşıma kontrolü (ileride) |
| Hız: sürüş / kaldırma / indirme / itme | Animasyon limitleri |

### Gerekmeyen — istenirse de `estimate` olarak işaretlenmeli

Kabin içi detayı (koltuk/panel ölçüsü), kaput ve yan koruma dikey ölçüleri, bileşen xyz
konumları, ivme, **renkler**. Hiçbiri VDI'da yayınlanmıyor; hepsi fotoğraf kestirimi. Rapor
bunları verecekse net biçimde tahmin olarak versin — AM 15l ve ERE 225i raporları bunu doğru
yaptı, kopyalanmaya değer.

**Renk özel bir durum:** RAL 1028 iddiası yedek boya parça numarasından geliyor, ürün
sayfasından değil; ve markanın kendisi tescilli. Geometri **jenerik** kalır, logo kullanılmaz.
(EFG raporunun yasal notu doğru.)

---

## 3. Tek koordinat konvansiyonu

Beş rapor dört ayrı konvansiyon veriyor:

| Rapor | İleri (çatal) | Origin |
|---|---|---|
| EKX | `+Z` | dingil ortası, zemin |
| EFG | `+X` (`+Z` = sol) | ön aks, zemin |
| ETM/ETV | `+X` (`+Z` = sağ) | arka-orta, zemin |
| AM 15l | `+Z` = tiller (arka), çatal ucu `Z=0` | çatal uçları, zemin |
| ERE 225i | `+Z` = çatal ucu | tahrik aksı, zemin |

Bu paket **tek** konvansiyon kullanır ve palet bunu zaten sabitlemiştir: uzunluk yerel **X**
boyunca, `+Y` yukarı, derinlik `+Z`, origin zeminde ve taban izinin **ortasında**.

Çeyrek tur hatası bu pakette bir kez gerçekten oldu — hayalet paletler 1.2 m'lik yükü 0.875 m
adımlı yuvalara dik yerleştirdi, `orientedPalletFootprint` ile geometri anlaşmazlığa düştü ve
sonuç raftan düşecek bir palet oldu. Sessiz bir hata değil, **görünmez** bir hataydı.

Bu yüzden rapor:
1. Kaynağın konvansiyonunu **açıkça** yazsın (yukarıdaki tablo gibi),
2. Ölçüleri **skaler** versin (l1, b1, y, x…), xyz vektörü olarak değil,
3. Dönüşümü bize bıraksın. Aile başına bir adaptör yazılır; rapor adaptörü yazmaz.

Birim: kaynak **mm**, sahne **m**. Dönüşüm tek sınırda yapılır (`/1000`), veri mm kalır.

---

## 4. Geometri ve LOD gereksinimleri

Rapordan geometri **reçetesi** istemiyoruz; ölçü istiyoruz. Ama raporun ürettiği veri şu iki
kısıtla uyumlu olmak zorunda:

**a) İki LOD katmanı, tek parça listesi.** Rack ve pallet'te olduğu gibi: tek bir
`vehicleParts(spec, detail)` fonksiyonu, `detail: 'full' | 'simple'`. Uzak katman **iskelet
olmamalı** — rafta bunu bir kez yaptık ve kullanıcı "uzaktan çubuk gibi görünüyor" dedi;
düzeltmesi deck panellerini, çaprazları ve taban plakalarını geri koymak oldu. Araçta karşılığı:
gövde kütlesi, çatal ve mast silueti kalır; kabin içi, hidrolik hat, tekerlek segment sayısı
düşer.

**b) İki katman aynı attribute kümesini yazmalı.** `position, normal, uv, color` — dördü de,
her iki katmanda. Sebebi teorik değil: three r185'te render pipeline'ı geometrinin attribute
düzeninden derlenir ama **geçersizleştirme koşulu geometriyi içermez**
(`WebGPUBackend.needsRenderUpdate` yalnız `{object, material}` bakar). Katman değişince
attribute kümesi daralırsa bayat pipeline yeniden kullanılır, bağlanmamış slot kalır, ve
komut tamponunun **tamamı** düşer — tek nesne değil, tüm kare. Palet güvertesinde bu tuzağın
kıyısından döndük (tam katman `color` taşıyor, uzak katman taşımıyor; yalnızca materyalin de
aynı anda değişmesi kurtardı).

**c) Paylaşımlı geometri + `retain`/`release`.** Aynı modelin her örneği tek buffer paylaşır;
cache sınırlıdır ve tahliye ekranda olan bir buffer'ı asla serbest bırakmamalıdır.

**d) Nesne sayısı asıl maliyettir.** Gerçek bir sahnede (5218 node) profil, kare süresinin
~%61'ini nesne-başına draw dispatch'te, ~%25'ini matris matematiğinde buldu; geometri
karmaşıklığı profilde **yok**. Yani üçgen bütçesi cömert olabilir, **düğüm sayısı** olamaz. Bir
araç filosu düşünülüyorsa `InstancedMesh` baştan planlanmalı.

---

## 5. Şema ve panel tarafı

- **Yeni alan = Zod `.default()`.** Bu paket harici; host'un `migrateNodes`'una satır ekleyemez.
  Varsayılansız yeni alan kaydedilmiş her sahneyi kırar.
- **Sınıf adı düğümde, figür katalogda.** `route` düğümü `requiredFor: TruckVariant` tutar,
  `3.2` sayısını **tutmaz** — kopyalandığı an katalog düzeltmesi propagasyonu durur. Araç düğümü
  de aynı: model kimliği tutulur, ölçüler katalogdan çözülür.
- **`parametrics.invariants` tek başına görünmez.** Host bu alanı bildirir ve **hiçbir yerde
  okumaz**; kind kendi `trailingSection` panelini vermezse tüm uyarıları sessizce çöpe gider.
  (`pallet` ve `route` bu yüzden uyarısızdı; `panels/issue-list` ile düzeltildi.)
- **Panel hüküm vermez.** Ölçü ve atıf yazar. Tahmine karşı hesaplanmış bir pay yeşile/kırmızıya
  boyanmaz — bu, tahmini uygunluk beyanına çevirir.

---

## 6. Rapor çıktısı hangi biçimde olmalı

Tek bir serbest JSON değil. Aile başına iki blok:

**A. Yayınlanmış figürler** (`catalog.ts` karşılığı) — her alanda kaynak dokümanın adı ve
baskısı (ör. "EFG 2 specsheet TR 07/2026, VDI satır 4.34"). Atıf verilemeyen sayı buraya girmez.

**B. Tahminler** (`constants.ts` karşılığı) — her alanda kullanıcıya gösterilecek notun tam
metni. Not yoksa alan buraya da girmez.

Ek olarak **C. Boşluk listesi**: yayınlanmamış olduğu *tespit edilen* alanlar, açıkça. EKX'in
`Ast`'ı, ETM/ETV'nin rezidüel kapasite eğrisi ve AM 15l'in VDI 1.8 `x`'i bunun doğru yapılmış
örnekleri — bu üçü raporların en değerli kısmı.

---

## 7. Elimizdeki beşin bağlanacağı yer

`handling/catalog.ts` altı soyut sınıf tanımlıyor ve raporlar bire bir oturuyor:

| Rapor | `TruckVariant` | Bugün | Rapordan sonra |
|---|---|---|---|
| AM 15l | `hand-pallet` | `null` → tahmin | Ast 1584/1784 **yayınlanmış** |
| ERE 225i | `powered-pallet` | `null` → tahmin | Ast 2346/2396 **yayınlanmış** |
| EFG 213–220 | `forklift` | EN 15620 bandı | model bazlı 3112–3469 |
| ETM/ETV 318–325 | `reach` | EN 15620 bandı | model bazlı 2737–2969 |
| EKX 410–516 | `turret` | EN 15620 bandı | **Ast yok** — banda dokunulmaz |
| — | `agv` | `null` → tahmin | rapor yok |

Yani `aisleBandForVariant` iki `null`'ı yayınlanmışa çevirebilir, üç sınıfta modele
inebilir, ve `turret`'te **hiçbir şey değiştirmemelidir**. Bunu bilerek yapmak, raporu
okumadan yapmaktan farklıdır.

---

## 8. Bir sonraki raporun kapsamı

Eksik sınıf: **`agv`** (otonom/AGV-AMR). Ayrıca değerlendirilebilir: sipariş toplayıcı
(order picker), yüksek istifleyici (high-lift stacker), 4 tekerlekli karşı ağırlıklı
(EFG 4/5 serisi — mevcut 3 tekerlekli EFG 2'den farklı taban izi).

Her biri için istenen: §2'deki "gerekli" tablosu, §1'deki basis disiplini, §6'daki üç bloklu
çıktı. İstenmeyen: bileşen hiyerarşisi, r128 uyum notu, `<Canvas>` iskeleti, renk kodu.
