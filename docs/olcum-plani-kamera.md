# Kamera takılması — ölçüm planı

`docs/olcum-sonuclari.md` yükleme donmasını kapattı: 0,5 → 14,1 fps. Kalan
şikâyet **kamera hareketinde takılma**. O dosyanın bıraktığı yer:

> İkisi birlikte 50–100 ms'lik karenin ~9 ms'sini açıklıyor. Geri kalanı bu
> başsız ortamda koşturamadığım kodda: gerçek render yolu ve host'un viewer
> sistemleri.

Yani karenin **~%85'i ölçülmemiş durumda.** Bu plan onu ölçüyor. İki aday
zaten elendi (katman havuzu yeniden inşası: 3 ms; sahne grafiği gezintisi:
5,5 ms) — o ikisini tekrar ölçmeye gerek yok.

Tahmin etmiyoruz. Bu dosyanın amacı, hangi hipotezin **yanlış** olduğunu
söyleyebilecek veriyi toplamak.

**Aceleci okuyucu için:** [T1](#t1--performans-profili--en-önemlisi) — DevTools
→ Performance → 5 sn kamera gezdirerek kayıt → Bottom-Up → Self Time → ilk 15
satır. Diğer beş test birer sayı veriyor; cevabı veren bu.

---

## Hazırlık — ölçümden önce, bir kez

Bunlar olmadan koşulan bir ölçüm sahte sayı üretir ve sahte olduğu belli olmaz.

- **Bilgisayarı prize tak**, Windows güç planını "En iyi performans"a al. Pilde
  Chrome GPU saatini düşürür.
- Diğer sekmeleri ve ağır uygulamaları kapat. Arka planda video/oynatıcı olmasın.
- DevTools'u **projeyi açmadan önce** aç (F12), Console → ⚙ → **Preserve log**
  işaretle. Yükleme sırasındaki `[viewer] WebGPU device ready` satırını
  kaçırmamak için.
- Chrome konsola yapıştırmayı engeller: konsola bir kez `allow pasting` yazıp
  Enter'a bas.
- Performance panelinde ⚙ → **CPU: No throttling**. Açık kalırsa bütün ölçüm
  çöp olur ve bunu tablodan anlayamayız.

---

## T0 — neyi ölçtüğümüzü bozmayalım

Geçen ölçüm tek bir sebeple kirlendi — ölçüm sırasında tarayıcı WebGL2'den
WebGPU'ya geçti ve kazancın dağılımı veriden ayrılamaz hâle geldi. Aynı hata
tekrarlanmasın diye **her testten önce** şu üçü kaydedilir:

1. `chrome://gpu` → en üstteki özet tablosunun ekran görüntüsü
2. Konsolda `[viewer] WebGPU device ready` satırı **var mı, yok mu** (yoksa
   `No available adapters` görünür — o da bilgi)
3. Konsola şunu yapıştır, çıktısını kaydet:

```js
console.log(JSON.stringify({
  dpr: devicePixelRatio,
  w: innerWidth, h: innerHeight,
  ua: navigator.userAgent,
  webgpu: !!navigator.gpu,
  cores: navigator.hardwareConcurrency,
  mem: navigator.deviceMemory ?? null,
}))
```

Bütün testler **aynı oturumda, aynı pencere boyutunda, aynı projeyle** koşulur.
Arada tarayıcı yeniden başlatılırsa bu üçü yeniden kaydedilir.

---

## Ortak ölçüm betiği

`docs/olcum-kat-cogaltma.md` içindeki betiğin aynısı: **bütün hesaplamalar
birebir aynı**, o yüzden önceki tablolarla karşılaştırılabilir. İki ekleme var —
test etiketi (etiketsiz tablolar karşılaştırılamaz, bu onu otomatik yapıyor) ve
sonunda kopyalanabilir düz metin blok, `console.table` çıktısını kopyalamak
zahmetli olduğu için.

Bir kez yapıştır, her testte `olc('etiket')` diye çağır. Sayfayı yenilersen
yeniden yapıştırman gerekir.

```js
window.olc = (label = 'etiketsiz') => {
  const WINDOW_MS = 40_000, tasks = [], frames = []
  let last = performance.now(), stop = false
  const po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) tasks.push({ ms: Math.round(e.duration) })
  })
  try { po.observe({ entryTypes: ['longtask'] }) } catch { console.warn('longtask yok') }
  ;(function tick() {
    const now = performance.now(); frames.push(now - last); last = now
    if (!stop) requestAnimationFrame(tick)
  })()
  const t0 = performance.now()
  console.log(`%cHAZIR — ${label} — 40 sn`, 'font-weight:bold;color:#0a0')
  for (const s of [20, 10, 5]) setTimeout(() => console.log(`… ${s} sn`), (40 - s) * 1000)
  setTimeout(() => {
    stop = true; po.disconnect()
    const dur = (performance.now() - t0) / 1000
    const sorted = [...frames].sort((a, b) => a - b)
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
    // Birincil ölçüm KARE ARALIKLARINDAN türetiliyor, `longtask`'tan değil:
    // longtask her ortamda raporlanmıyor (doğrulandı — 900 ms'lik bilerek
    // eklenmiş bir blok longtask üretmeden kare aralığında görüldü).
    const stalls = frames.filter((f) => f > 50)
    const stalledMs = Math.round(stalls.reduce((s, f) => s + (f - 16.7), 0))
    const r = {
      'ETİKET': label,
      'ölçüm süresi (sn)': +dur.toFixed(1),
      'takılma sayısı (>50ms)': stalls.length,
      'toplam bloke (ms)': stalledMs,
      'bloke oranı (%)': +((stalledMs / (dur * 1000)) * 100).toFixed(1),
      'en uzun tek blok (ms)': Math.round(sorted[sorted.length - 1] ?? 0),
      '>1 sn bloklar': frames.filter((f) => f > 1000).length,
      'kare sayısı': frames.length,
      'ortalama fps': +(frames.length / dur).toFixed(1),
      'p50 (ms)': +q(0.5).toFixed(1),
      'p95 (ms)': +q(0.95).toFixed(1),
      '>100ms kareler': frames.filter((f) => f > 100).length,
      'uzun görev sayısı': tasks.length,
      'uzun görev toplam (ms)': tasks.reduce((s, x) => s + x.ms, 0),
      'en uzun 10 takılma': [...stalls].sort((a, b) => b - a).slice(0, 10).map(Math.round).join(', '),
    }
    console.table(r)
    console.log('%c--- kopyala ---', 'font-weight:bold')
    console.log(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join('\n'))
  }, WINDOW_MS)
}
console.log('hazır: olc("T4-A") gibi çağır')
```

Kamera hareketi her testte aynı olmalı, yoksa testler karşılaştırılamaz.
Standart hareket:

> Sol tuş basılı, fareyi yavaş ve **kesintisiz** olarak sağa-sola geniş yaylar
> çizerek gezdir. Durma, tıklama, seçme yok. 40 saniye boyunca.

Yavaş ve sürekli olması önemli: hızlı savurmak kareleri atlatır ve ölçüm
iyimser çıkar.

Her koşudan önce sahne otursun (~30 sn, konsol sussun). Betiği çağır, "HAZIR"
yazınca başla, "… 5 sn" görününce devam et, tablo çıkınca dur.

---

## Koşu sırası

Altı test var ama dokuz koşu gerekmiyor: **T2-A, T3-A ve T4-B aynı ölçüm** —
tam ekran, toplu çizim açık, 40 sn hareket. Bir kez koşulur, üçüne birden temel
olur. Altı koşu yetiyor, toplam ~35–40 dakika.

| # | Ne | Nasıl |
|---|---|---|
| 1 | **T1 — profil** ⭐ | Aşağıda. En başta, makine tazeyken. |
| 2 | **T4-A** — duran kamera | `olc('T4-A duran kamera')`. Fareyi tuvalin **dışına** park et, 40 sn hiç dokunma. |
| 3 | **TEMEL** = T2-A + T3-A + T4-B | `olc('TEMEL tam ekran, toplu çizim açık')`. Tam ekran, 40 sn standart hareket. |
| 4 | **T3-B** — toplu çizim kapalı | Depo panelinin en altındaki **"Toplu çizim açık"** düğmesi (şimşek simgesi). Tıkla → "kapalı". Sekme birkaç saniye donar; **donma geçtikten sonra** `olc('T3-B toplu çizim kapalı')`. |
| 5 | **T2-B** — küçük pencere | Önce toplu çizimi geri **aç**. Pencereyi ekranın dörtte birine küçült. `olc('T2-B pencere 1/4')`. |
| 6 | T5 / T6 (isteğe bağlı) | Pencereyi tam ekrana al. Aşağıda. |

Toplu çizim anahtarı kaydedilmiyor — sayfa yenilenince kendiliğinden "açık"a
döner. 4. adımdan sonra yenilemeden 5'e geçersen elle açman gerekir.

**Kaçınılacak dört şey:** Performance kaydı ile konsol betiğini aynı anda
koşturmak; koşular arasında pencere boyutunu değiştirmek (T2-B hariç); ölçüm
sırasında tıklamak, seçmek, panel açmak; ve ölçüm bitmeden Pascal'ın
güncellemesini almak (son bölüm).

---

## T1 — performans profili ⭐ EN ÖNEMLİSİ

Diğer beş test birer sayı verir; bu test **cevabı** verir. Sadece bunu
yapabileceksen bunu yap.

1. Projeyi aç, sahne oturana kadar bekle (~30 sn, konsol sussun)
2. DevTools → **Performance** sekmesi. ⚙ → **Screenshots kapalı**, **Memory
   kapalı** (ikisi de kaydın kendisine yük bindirir), **CPU: No throttling**
3. Kayıt düğmesine (●) bas
4. Standart kamera hareketini **5 saniye** yap — takılmayı hissettiğin hareket.
   8 saniyeye kadar sorun değil; daha uzunu dosyayı devleştirir, okunurluğu
   artırmaz
5. Kaydı durdur, işlenmesini bekle (yarım dakika sürebilir)

Sonra kayıttan **üç şey** çıkar. Sırayla:

**a) Bottom-Up → Self Time → ilk 15 satır.** Karenin %85'i sorusunun doğrudan
cevabı, ve önceki turda işi çözen okuma bu oldu.

> Önce üstteki genel görünümde **takılmaların olduğu 2–3 saniyelik bir aralığı
> sürükleyerek seç.** Boşta geçen kısım dışarıda kalsın — yoksa Bottom-Up
> boştaki kareyle sulanır ve sinyal aynı şekilde boğulur. Sonra alt panelde
> **Bottom-Up** sekmesi → **Self Time** sütun başlığına tıklayarak sırala → ilk
> 15 satırın ekran görüntüsü.

**b) Tek bir uzun karenin alev grafiği.** **Main** şeridinde 50–100 ms'lik geniş
bir blok bul, yakınlaş, ekran görüntüsünü al. Çoğu zaman Bottom-Up'tan daha çok
şey söyler: maliyetin `useFrame` zincirinde mi, WebGPU pipeline'ında mı,
post-processing geçişinde mi olduğunu doğrudan gösterir.

**c) `.json` profil dosyası.** Sol üstteki **⬇ indirme** simgesi. Dosya büyük
olur (20–80 MB) — Drive'a atıp bağlantı vermen yeterli.

Ekran görüntüleri **asıl teslim**; `.json` erişilebilirse bonus. Geçen sefer
sinyal 2 saniyelik karelerin altında boğuluyordu; 50 ms'lik karede okunur hâle
geldi.

---

## T2 — CPU mu, ekran kartı mı?

Bu ayrım her şeyi değiştirir. CPU'ysa çözüm kodda; ekran kartıysa çözüm
çizilen piksel sayısında (post-processing, kontur, saydamlık) ve tamamen
farklı bir iş.

| Adım | Ne yapılır |
|---|---|
| A | Tarayıcı **tam ekran**. Betiği koştur, 40 sn standart hareket. (= TEMEL koşusu) |
| B | Tarayıcı penceresini **ekranın dörtte birine** küçült. Aynı betik, aynı hareket. |

**Nasıl okunur:**
- fps belirgin şekilde arttıysa (örn. 14 → 30+) → **ekran kartı sınırı.**
  Sebep raf sayısı değil, çizilen piksel. Kontur/post-processing baş şüpheli.
- fps neredeyse aynı kaldıysa → **CPU sınırı.** Sebep kare başına koşan kod.

---

## T3 — Toplu çizim açık / kapalı

Eklentinin kendi anahtarı: depo panelinde **"Toplu çizim açık"** yazan düğme.
Tıklayınca "kapalı"ya döner.

| Adım | Ne yapılır |
|---|---|
| A | Toplu çizim **açık**. Betik + 40 sn standart hareket. (= TEMEL koşusu) |
| B | Toplu çizim **kapalı**. Betik + 40 sn standart hareket. |

**Nasıl okunur:**
- Kapalıyken çok daha kötü → instancing çalışıyor, darboğaz **başka yerde.**
- İkisi benzer → instancing bir işe yaramıyor; çizim çağrısı zaten sorun değil.
- Kapalıyken **daha iyi** → kolektif sistemin kendisi maliyet ekliyor. Bu
  olursa en değerli sonuç bu olur.

> Not: kapalıyken sekme birkaç saniye donabilir — normal, ~10.000 çizim
> çağrısına dönüyor. Donma geçtikten sonra ölçmeye başla.

---

## T4 — Duran kamera vs hareketli kamera

| Adım | Ne yapılır |
|---|---|
| A | Fareye **hiç dokunmadan** 40 sn. İmleci tuvalin dışına park et, betik koşsun, sahne dursun. |
| B | 40 sn standart hareket. (= TEMEL koşusu) |

**Nasıl okunur:** A zaten kötüyse (örn. 60 ms kareler), maliyet kameradan
bağımsız ve her karede koşan bir şey var. A iyi, B kötüyse maliyeti kamera
tetikliyor — kesme (culling), matris güncelleme, katman geçişi gibi.

Bu, T1'deki profili okurken neye bakacağımı belirler.

---

## T5 — Kat sayısı (isteğe bağlı)

Senin ilk hipotezin çoğaltılan katlardaki birebir aynı raflardı. Doğrudan
ölçelim.

Projenin bir **kopyası** üzerinde (aslına dokunma):

| Adım | Ne yapılır |
|---|---|
| A | Tüm katlar açık. Betik + 40 sn hareket. |
| B | İki katı sil, tek kat kalsın. Betik + 40 sn hareket. |

**Nasıl okunur:** kare süresi kat sayısıyla **doğrusal** düşüyorsa (3 kat →
1 kat = ~3× hızlanma) maliyet raf başına ve toplam sayıda. Doğrusaldan az
düşüyorsa sabit bir maliyet var ve raf sayısını azaltmak çözüm değil.

---

## T6 — Raf sayısı ölçeklemesi (isteğe bağlı)

Yine **kopya** üzerinde: rafların yarısını sil, betiği koştur.

İki nokta (tam sayı, yarı sayı) eğimi verir. T5 ile birlikte, "sorun raf
sayısında mı yoksa sahnenin başka bir özelliğinde mi" sorusunu kapatır.

Kopyalama yoksa T5 ve T6 atlanır — ikisi de isteğe bağlı, ve T1 çıktısı
geldiğinde büyük ihtimalle gereksiz kalırlar.

---

## Ne göndereceksin

Sıralama önem sırasına göre:

1. **T1'in üç çıktısı:** Bottom-Up ekran görüntüsü, tek karenin alev grafiği,
   profil `.json`'u
2. T2, T3, T4 tabloları — betiğin bastığı "--- kopyala ---" bloğu, kopyala-yapıştır
3. T0 ortam bilgisi (üç madde)
4. Varsa T5, T6

Betik etiketi tablonun ilk satırına yazıyor, o yüzden `olc()`'yi doğru etiketle
çağırdığın sürece ayrıca not almana gerek yok. Elle alınan ekran görüntülerine
hangi test ve hangi adım olduğunu yaz — "T3-B, toplu çizim kapalı" gibi.

---

## Bu ölçümden önce yapılmayacak şey

Pascal'ın güncellemesi (`ovurrsl/editor` PR'ı) `cd6db70 perf(core,viewer):
stop rebuilding wall geometry every frame` içeriyor — kalan maliyetin bir
kısmını açıklayabilecek bir düzeltme. **Ama önce ölçüm, sonra güncelleme.**

Sebebi: güncelleme aynı anda 42 commit getiriyor. Önce alırsak, iyileşme
olsa bile hangisinden geldiğini bir daha ayıramayız — geçen ölçümdeki
WebGPU karışıklığının aynısı olur. Profil zaten duvar geometrisinin resimde
olup olmadığını söyleyecek; oradan sonra güncellemenin ne kazandıracağını
**önceden** biliriz.
