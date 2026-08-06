# Üretim ölçümü — v0.1.4 öncesi ve sonrası

Kullanıcının kendi makinesinde (x86 PC, Windows, Chrome), aynı depo projesi,
aynı eylem: proje yüklenir, `docs/olcum-kat-cogaltma.md` betiği koşturulur, kat
çoğaltılır. Kırk saniyelik pencere.

PR'larda "etki kullanıcının makinesinde doğrulanacak" diye bırakılan boşluk bu
dosyayla kapanıyor.

## Sonuç

| | öncesi (`49b2f16`) | sonrası (`fd22b04` = v0.1.4) | |
|---|---|---|---|
| ortalama fps | 0,5 | **14,1** | 28× |
| p50 kare | 2098 ms | **49,4 ms** | 42× |
| p95 kare | 3024 ms | 128 ms | 24× |
| en uzun tek blok | 3362 ms | 1413 ms | 2,4× |
| >1 sn bloklar | 21 | **2** | |
| bloke oranı | %98,9 | %56,7 | |
| toplam kare (40 sn) | 22 | 564 | |

`49b2f16` PR #6 merge'ünün bir altındaki commit — yani **hiçbir düzeltme
içermeyen** taban. O sırada canlıdaki bundle 4 Ağustos'ta o commit'ten
derlenmişti.

## Teşhisi doğrulayan sayı tabloda değil

Konsol `[Violation]` satırları, **kat çoğaltmadan önce**, sahne boş boş
dururken:

| | kare başına |
|---|---|
| öncesi | `rAF handler took 1116…1247ms` |
| sonrası | `rAF handler took 50…70ms` |

Aynı sahne, hiçbir şeye dokunulmadan, **~21×**. Bu, v0.1.3'ün kirli bayrağı
düzeltmesinin doğrudan hedefiydi: bayrak hiç düşmediği için on iki host sistemi
kümenin tamamını her karede geziyordu. Raf başına kare maliyeti ~330 µs'den
~13 µs'ye inmiş görünüyor.

Kalan iki `>1 sn` blok da yerli yerinde: 996 ms ve 1152 ms, ikisi de bir `click`
sonrası — yani kat çoğaltmaların kendisi. Host tarafındaki toplu oluşturma
maliyeti; yaması `docs/upstream-bulk-create.patch`.

## Karışıklık: iki değişken birden değişti

```
öncesi:  No available adapters. → THREE.WebGPURenderer WebGL2 backend'e düştü
sonrası: [viewer] WebGPU device ready
```

Geçen ölçümde bu makinede WebGPU yoktu, bu ölçümde vardı. Yani deney temiz
değil ve kazancın dağılımını **bu veriden ayıramıyorum**.

Duran akıl yürütme: eklenti sahnenin tamamını ~95 çizim çağrısında çiziyor ve
bir çizim çağrısı tek haneli mikrosaniye. Backend farkı kare başına birkaç
milisaniye açıklar, bir saniye açıklamaz — o yüzden 1150 → 55 ms'nin ezici
kısmının kirli bayrağı düzeltmesinden geldiğini düşünüyorum. Ama bu bir
çıkarım, ölçüm değil.

## Kalan: kamera hareketinde takılma

Kullanıcının raporu: kamera artık hareket ediyor, ama hareket sırasında
takılmalar sürüyor. 564 karenin 266'sı 50 ms'nin üstünde, ortalama ~102 ms.
Çoğaltmadan sonra boştaki kare 55 ms'den 60–110 ms'ye çıkıyor, yani maliyet
hâlâ raf sayısıyla ölçekleniyor.

Kullanıcının hipotezi: sebep rafların render'ı, özellikle çoğaltılan
katlardaki birebir aynı raflar. İki somut adayı ölçtüm; **ikisi de yeterince
büyük değil.**

### Aday 1 — katman geçişi havuzları yeniden kuruyor (ölçüldü, yetersiz)

`collective-system.tsx` kamera hareketinde `rebuildPools`'u neredeyse her kare
çağırıyor; dosyanın kendi yorumu bunu söylüyor. Matris yazımı atlanıyor ama
gruplama döngüsü her girdiyi geziyor: ata zinciri görünürlük taraması, iki Map
araması, taze dizi tahsisi.

Kamera hareketi benzetimi, girdi başına beş derinlikli ata zinciri, 60 kare:

| raf | kare p50 | en yüksek | yeniden inşa |
|---|---|---|---|
| 2.708 | 1,16 ms | 3,13 ms | 57/60 |
| 5.416 | 1,88 ms | 5,41 ms | 58/60 |
| 8.124 | **3,03 ms** | 6,16 ms | 58/60 |

Yorumun öngörüsü doğru — 60 karenin 58'inde koşuyor, ve maliyet doğrusal. Ama
üç kat çoğaltılmış bir depoda 3 ms, 50–100 ms'lik karenin %3–6'sı. **Baskın
sebep değil.**

### Aday 2 — sahne grafiği gezintisi (ölçüldü, yetersiz)

Kolektif instancing çizim çağrısını kaldırıyor ama sahne grafiğini değil: her
rafın kayıtlı grubu ve sarmalayıcıları three sahnesinde duruyor ve three her
karede tümünü geziyor.

| raf × düğüm | toplam Object3D | `updateMatrixWorld` p50 |
|---|---|---|
| 2.708 × 4 | 10.833 | 1,11 ms |
| 5.416 × 4 | 21.665 | 2,80 ms |
| 8.124 × 4 | 32.497 | **5,49 ms** |

Yine doğrusal, yine tek haneli. **Baskın sebep değil.**

### Sonuç: kalan ~%85 ölçemediğim yerde

İkisi birlikte 50–100 ms'lik karenin ~9 ms'sini açıklıyor. Geri kalanı bu
başsız ortamda koşturamadığım kodda: gerçek render yolu (WebGPU pipeline,
`outline: true` ile post-processing) ve host'un viewer sistemleri.

Bir sonraki adım tahmin değil **profil**. Planı `docs/olcum-plani-kamera.md`.

## T4 — duran vs hareketli kamera (ölçüldü, cevap verdi)

Kullanıcının makinesi, tek oturum, viewer tek örnek. Pencere 970×945, dpr 1,
WebGPU açık, Chrome 150, 8 çekirdek. İki koşu **arka arkaya**, aralarında
hiçbir şey yapılmadan.

| | A — duran kamera | B — hareketli kamera |
|---|---|---|
| ölçüm süresi | 40,1 sn | **47,6 sn** |
| ortalama fps | 15,3 | 6,4 |
| **p50 kare** | **60,9 ms** | **61,5 ms** |
| p95 kare | 92,4 ms | 675,4 ms |
| en uzun tek blok | 105 ms | 1202 ms |
| >1 sn bloklar | 0 | 2 |
| >100 ms kareler | 5 / 612 | 54 / 302 |
| bloke oranı | %74,5 | %89,3 |
| uzun görev | 610 adet, 39.333 ms | 317 adet, 41.234 ms |

### p50 aynı, ve bütün sonuç bu

60,9 ↔ 61,5. Tipik kare, kamera dursa da hareket etse de **aynı** maliyette.
Aranan ~%85 bir kamera maliyeti değil: girdi yokken, her karede koşan sabit
bir maliyet.

A'da 612 karenin **611'i** takılma. 610 uzun görev — kare başına tam bir tane,
ortalama 64,5 ms. Uzun görevlerin toplamı 39.333 ms, yani 40,1 saniyelik
pencerenin **%98'i**. Hiçbir şey olmuyorken ana iş parçacığı boş kalmıyor.

Bu, planın T4 bölümündeki iki okumadan birincisi: *"A zaten kötüyse maliyet
kameradan bağımsız ve her karede koşan bir şey var."* Kesme (culling), matris
güncelleme, katman geçişi, işaretçi ışın testi — hepsi girdiye bağlı, hiçbiri
fare tuvalin dışında park hâlindeyken koşmaz. Hepsi eleniyor.

### Kamera hareketinin gerçek payı: kuyruk

Hareket p50'yi değiştirmiyor, **kuyruğu** büyütüyor: p95 92 → 675 ms, >100 ms
kareler 5 → 54, ve iki adet >1 sn blok (1202, 1017 ms) — A'da hiç yok.

Yani tek bir "kamera takılması" değil, **iki ayrı iş** var:

1. **16 fps'lik tavan.** Sabit, kameradan bağımsız, her karede. Büyük olan bu.
2. **Hareketin eklediği saniyelik bloklar.** Ayrı ve daha küçük.

İkincisine bakmadan önce birincisi çözülmeli: 61 ms'lik taban dururken
kuyruğu ölçmek, zaten dolu olan bir kabın taşmasını ölçmek olur.

### Bir ayrıntı: B'nin penceresi 47,6 saniye sürdü

Betiğin 40.000 ms'lik `setTimeout`'u 47,6 saniyede ateşledi. Bu bir ölçüm
hatası değil, **bulgunun kendisi**: ana iş parçacığı bir zamanlayıcı geri
çağrısını 7,6 saniye geciktirecek kadar doymuş. Bundan sonraki tablolarda
`ölçüm süresi` 40'ın üstündeyse aynı şekilde okunur.

### Bir ayrıntı daha: bu pencere zaten küçüktü

970×945, dpr 1 — yaklaşık 917 bin piksel, tam ekran değil. T2'nin (CPU mu,
dolgu mu) hipotezi bu sayıyla daha şimdiden zayıflıyor: bu kadar küçük bir
tuvalde kare hâlâ 61 ms. T2-B koşulacaksa pencere gerçekten küçültülmeli
(~480×470), yoksa iki koşu arasında anlamlı bir piksel farkı olmaz.

## Atılan koşu — ve neden atıldığını yazmak gerekiyor

Bu A/B çiftinden **önce** bir çift daha ölçüldü ve kullanılamadı. Konsol
logunda `[viewer] WebGPU device ready` **dört kez** geçiyor, hiç gezinme
olmadan; yanında 13 × `Building pipeline` ve 3 × `scene readiness timed out`.
Viewer oturum içinde kendiliğinden üç kez yeniden kuruldu.

Kare aralıkları, `WebGPU device ready` satırlarıyla bölündüğünde:

| viewer örneği | kare p50 | ortalama | en uzun | BVH hatası |
|---|---|---|---|---|
| #1 — A burada ölçüldü | 75 ms | 99 ms | 2587 ms | 0 |
| #2 | 2796 ms | 2094 ms | 2948 ms | 234 |
| #3 | 2700 ms | 1726 ms | 3260 ms | 233 |
| #4 — B burada ölçüldü | 67 ms | 120 ms | 2848 ms | 231 |

A birinci örnekte, B dördüncüde. Arada üç tam yeniden kurulum. O koşudaki
B'nin 2 fps'i kamera hareketinden mi biriken viewer'lardan mı geliyor, **bu
veriden ayrılamıyor** — geçen ölçümdeki WebGPU karışıklığının aynısı, farklı
kılıkta. Aynı oturumda alınan 51 saniyelik Performance kaydının bomboş
çıkması da açıklandı: #2 veya #3 döneminde alınmış, sahne o sırada gerçekten
çizmiyordu.

Buradan çıkan kural `docs/olcum-plani-kamera.md` hazırlık bölümüne yazıldı:
**ölçüm bitince `WebGPU device ready` tam bir kez geçmiş olmalı.**

## Açık kusur: BVH kurulumu patlıyor (aralıklı)

Atılan koşunun logunda 698 kez:

```
[viewer] Skipping BVH for incompatible mesh geometry.
TypeError: Cannot read properties of undefined (reading 'offset') at nR.init
```

Kaynağı `ovurrsl/editor` →
`packages/viewer/src/components/viewer/scene-bvh.tsx:103`; oradaki `try/catch`
hatayı yutup uyarıya çeviriyor. `:88`'deki `hasBvhCompatibleGeometry` koruması
yalnızca `position` niteliği var mı ve ≥3 köşe mi diye bakıyor — patlayan şeyi
yakalayamıyor.

Dağılım kusurun yerini söylüyor: viewer'ın **ilk** örneğinde sıfır hata, her
yeniden kurulumdan sonra ~233. Yani sorun geometrinin kendisinde değil,
`useEffect` temizliğinin (`:113-117`, `disposeBoundsTree`) paylaşılan ve
tasarım gereği **hiç dispose edilmeyen** eklenti geometrisiyle etkileşiminde.
BVH düşünce ışın testi kaba kuvvete iniyor; yığınlarda `traverse` 4188 kez
görünüyor.

Temiz koşuda hiç görünmedi, yani 61 ms'lik tabanın kritik yolunda değil.
Dosya `packages/viewer` altında, yani upstream'in. **Ölçüm bitince ele
alınacak**, şimdi değil.

## Sahnenin gerçek bileşimi

Kullanıcının proje dosyası okundu. Bu, o ana kadarki bütün "acaba" listesini
kısalttı:

| | |
|---|---|
| toplam düğüm | 3.979 |
| **raf** | **3.582** (%90) |
| **farklı raf şekli** | **6** |
| ortalama paylaşım | 597 raf/şekil |
| `ghostFill > 0` olan raf | **0** |
| kat | 4 |
| duvar / slab / tavan / kapı | 236 / 32 / 32 / 18 |

"Raflar farklı ölçülerde, önbellek bölünüyor olabilir" endişesi **yanlış
çıktı**: 3.582 raf altı şekle çözülüyor, havuz ~12–24 `InstancedMesh`'e iniyor.
Katları çoğaltmak da zarar vermiyor — birebir aynı rafları ürettiği için
paylaşımı artırıyor. Geometri önbelleği tasarlandığı gibi çalışıyor.

## `?disable` merdiveni — gölge geçidi karenin %77'si

Editörün kendi teşhis anahtarları (`post-processing.tsx:62-76`, `lights.tsx:15`)
maliyeti geçit geçit ayırmaya yarıyor. Beş koşu, hepsi duran kamera, her biri
temiz tarayıcı oturumunda:

| koşu | fps | p50 | p95 | uzun görev toplam | bloke |
|---|---|---|---|---|---|
| T temel | 13,2 | 70,4 ms | 105 ms | 39.558 ms | %78,1 |
| A `ao,denoise` kapalı | 12,8 | 72,2 ms | 107,8 ms | 39.577 ms | %78,6 |
| B `outline` kapalı | 13,4 | 68,7 ms | 106,7 ms | 39.508 ms | %77,7 |
| **C `shadows` kapalı** | **21,7** | **41,7 ms** | **73 ms** | **9.040 ms** | **%17,7** |
| **D `postFx` kapalı** | **21,7** | **41,1 ms** | **74,9 ms** | **9.702 ms** | **%19,0** |

**Gölge geçidi kare başına ~29 ms.** Tek bir anahtar ana iş parçacığındaki uzun
görev süresini 40 saniyelik pencerede **39,5 sn'den 9,0 sn'ye** indiriyor — işin
%77'si.

SSGI/AO, denoise ve kontur **masum**: üçü de gürültü seviyesinde, `ao` kapalıyken
sonuç hatta biraz daha kötü. Kontur zaten seçim yokken ilk satırda çıkıyor
(`merged-outline-node.ts:314`), yani duran ölçümde hiç koşmuyordu.

`postFx` kapatmak gölge kapatmakla neredeyse aynı sonucu veriyor (41,1 ↔ 41,7).
İkisi de bir tam sahne geçidi kadar iş siliyor.

### Ve eklentinin CPU tarafı bedava

Bir önceki turda `?disable=draw` koşuldu — sahne kurulur, bütün sistemler koşar,
hiçbir şey çizilmez:

| | temel | `draw` kapalı |
|---|---|---|
| ortalama fps | 20,7 | **60,0** |
| p50 | 47,1 ms | **16,7 ms** |
| kare sayısı | 830 | 2.399 |
| takılma | 172 | **0** |
| uzun görev | 168 adet / 9.089 ms | **0 adet / 0 ms** |

React, bütün `useFrame` sistemleri, kolektif instancing, sahne grafiği
güncellemeleri, kirli bayrak tüketimi — **hepsi birlikte 16,7 ms'nin altında ve
tek bir uzun görev bile üretmiyor.** Maliyetin tamamı `renderer.render()`
içinde.

### Kaydedilen yanlış çıkarım

O koşunun temel tablosunda uzun görev oranı %22,7'ydi ve buradan "ana iş
parçacığı hesaplamıyor, GPU'yu bekliyor" sonucunu çıkardım. **Yanlıştı.** Bu
turun temel koşusunda oran **%98,6** (39.558 / 40.100 ms) — kare başına tam bir
uzun görev, ortalama 75 ms. Maliyet CPU-bağımlı.

İki oturum arasındaki fark muhtemelen pencere boyutu ya da o oturumun daha hızlı
rejimi. Beş koşuluk tur kendi içinde tutarlı olduğu için esas alınan o. Bu satır
burada duruyor çünkü bu dosyanın işi doğrulananlar kadar **yanlış çıkanları** da
tutmak.

### Atılan iki koşu — ve 2,5 saniye bandı

İlk `?disable` turunun 3. ve 4. koşusu kullanılamadı: ikisi de 0,4 fps, ve
p50'leri birbirinin aynı (2479,7 ↔ 2479,0). İki tamamen farklı anahtarın aynı
sayıyı vermesi gerçek bir etkinin davranışı değil — üstelik `?disable=shadows`,
`lights.tsx:111-128`'deki `expandByObject` döngüsünü tümden atladığı için o
koşunun daha **hızlı** olması gerekirdi.

Ortak nokta anahtar değil, oturum: `Preserve log` açıktı, loglar birikimliydi ve
`WebGPU device ready` sayısı koşudan koşuya 2 → 3 → 4 → 5 gidiyordu. Yani o iki
koşu aynı sekmedeki dördüncü ve beşinci WebGPU cihazıyla koştu.

Aynı bozulma daha önce de görüldü — önceki oturumun viewer örneği #2 ve #3'ünde
p50 2796 ve 2700 ms'ydi. **Dört bozuk durumun dördü de 2,5–2,8 sn bandında.**
Sekmede biriken WebGPU cihazlarına bağlı, ölçülen anahtara değil. Kural
buradan çıktı: **koşular arası tarayıcı tamamen kapatılır, Preserve log
kapalıdır.**

### Sıradaki soru

Gölge geçidi ikinci bir tam `renderer.render()` demek, ve her render
`_projectObject` ile bütün sahne grafiğini özyinelemeli geziyor
(`three/Renderer.js:3080`). Kolektif instancing açıkken her rafın alt ağacı
**çizilecek hiçbir şey taşımıyor** — gövde sahne kökündeki havuzdan çiziliyor.
Geriye kalan raf başına ~3 boş Object3D, toplam ~10.700 nesne, ve iki geçitte de
baştan sona geziliyor. 29 ms / 10.700 ≈ 2,7 µs/nesne; büyüklük sırası tutuyor.

**Hipotez, kanıt değil.** Ayıran ölçüm: toplu çizim kapatılıp aynı koşu
tekrarlanır. Çizim çağrısı ~20'den ~3.600'e fırlar, sahne grafiği raf başına bir
nesne büyür. Sonuç ~13 fps'te kalırsa maliyet geziniştedir; 2–5 fps'e düşerse
çizim gönderimidir.

## Düşürülen hipotezler

Bu dosyanın kaydettiği asıl şey, doğrulananlar kadar **elenenler**:

| hipotez | nasıl elendi |
|---|---|
| Host autosave'i yükleme donmasının sebebi | Kullanıcı yalnız dosyayı açıyordu; autosave yalnız yazımda koşuyor. Ayrı bir kusur olarak duruyor. |
| GPU overdraw | "Kamera hiç oynamıyor" ile bağdaşmıyor — overdraw girdiyi kesmez. |
| İşaretçi ışın testi | Mikro-ölçüm: 4.628 rafta 1,6 ms. |
| `cloneLevelSubtree` düğüm başına JSON | 16,3 vs 15,2 ms toplu — 1,1×, kazanç yok. |
| Katman geçişi yeniden inşası (kamera takılması) | Yukarıda ölçüldü: 8.124 rafta 3 ms. |
| Sahne grafiği gezintisi (kamera takılması) | Yukarıda ölçüldü: 32.497 nesnede 5,5 ms. |
| **Taban maliyetin sebebi kamera hareketi** | T4: duran kamerada p50 60,9 ms, hareketlide 61,5 ms. Girdiye bağlı her şey (kesme, matris güncelleme, katman geçişi, ışın testi) bu tek sayıyla eleniyor — fare tuvalin dışındayken hiçbiri koşmuyor ve kare yine 61 ms. |
| **İlk A/B koşusu** | Ölçüm değil, kirlenme: viewer arada üç kez yeniden kuruldu. Yukarıda. |
| **Şekil patlaması** (farklı ölçüdeki raflar önbelleği böler) | Proje dosyası: 3.582 raf → **6 şekil**, 597 raf/şekil. Havuz ~12–24 çizim çağrısı. |
| **`GhostStock`** (kolektif instancing'in kapsamadığı yol) | Projede `ghostFill > 0` olan raf yok; bileşen hiç mount olmuyor. |
| **Görünmez seçim çarpıştırıcısı** | `three/Renderer.js:3082` — WebGPU da `visible === false` alt ağacını eliyor. |
| **SSGI/AO + denoise** | `?disable=ao,denoise`: 12,8 vs 13,2 fps. Gürültü. |
| **Kontur geçidi** | `?disable=outline`: 13,4 vs 13,2 fps. Zaten seçim yokken erken çıkıyor. |
| **Eklentinin bütün CPU tarafı** | `?disable=draw`: 60 fps, 2.399 kare, **sıfır uzun görev**. React, sistemler, kolektif instancing, kirli bayrak — hepsi 16,7 ms'nin altında. |
| **"Ana iş parçacığı GPU'yu bekliyor"** | Benim yanlış çıkarımım. Temel koşuda uzun görev oranı %98,6 — CPU-bağımlı. Yukarıda. |
