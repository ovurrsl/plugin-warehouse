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

Bir sonraki adım tahmin değil **profil**: DevTools → Performance, 5 saniye
kamera gezdirerek kayıt, Bottom-Up → Self Time. Önceki ölçümde sinyal 2
saniyelik karelerin altında boğuluyordu; 50 ms'lik karede okunur.

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
