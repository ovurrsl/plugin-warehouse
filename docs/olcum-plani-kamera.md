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

---

## Önce: neyi ölçtüğümüzü bozmayalım

Geçen ölçüm tek bir sebeple kirlendi — ölçüm sırasında tarayıcı WebGL2'den
WebGPU'ya geçti ve kazancın dağılımı veriden ayrılamaz hâle geldi. Aynı hata
tekrarlanmasın diye **her testten önce** şu üçü kaydedilir:

1. `chrome://gpu` → en üstteki özet tablosunun ekran görüntüsü
2. Konsolda `[viewer] WebGPU device ready` satırı **var mı, yok mu**
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

Her testte aynı betik kullanılır — `docs/olcum-kat-cogaltma.md` içindeki
betiğin aynısı. Farklı olan tek şey, "HAZIR" yazdıktan sonra **ne yaptığın**.

Kamera hareketi her testte aynı olmalı, yoksa testler karşılaştırılamaz.
Standart hareket:

> Sol tuş basılı, fareyi yavaş ve **kesintisiz** olarak sağa-sola geniş yaylar
> çizerek gezdir. Durma, tıklama, seçme yok. 40 saniye boyunca.

Yavaş ve sürekli olması önemli: hızlı savurmak kareleri atlatır ve ölçüm
iyimser çıkar.

---

## T1 — Performans profili ⭐ EN ÖNEMLİSİ

Diğer beş test birer sayı verir; bu test **cevabı** verir. Sadece bunu
yapabileceksen bunu yap.

1. Projeyi aç, sahne oturana kadar bekle (~30 sn, konsol sussun)
2. DevTools → **Performance** sekmesi
3. Kayıt düğmesine (●) bas
4. Yukarıdaki standart kamera hareketini **8 saniye** yap
5. Kaydı durdur, işlenmesini bekle
6. Sol üstteki **⬇ indirme** simgesi → `.json` olarak kaydet
7. Dosyayı paylaş

> Dosya büyük olur (20–80 MB). Drive'a atıp bağlantı vermen yeterli.

Ayrıca kaydın içinden şu ekran görüntüsü işe yarar: alt panelde
**Bottom-Up** sekmesi → **Self Time** sütununa göre sırala → ilk 15 satır.

Bu, "karenin %85'i nerede" sorusunun doğrudan cevabı. Geçen sefer sinyal
2 saniyelik karelerin altında boğuluyordu; 50 ms'lik karede okunur hâle geldi.

---

## T2 — CPU mu, ekran kartı mı?

Bu ayrım her şeyi değiştirir. CPU'ysa çözüm kodda; ekran kartıysa çözüm
çizilen piksel sayısında (post-processing, kontur, saydamlık) ve tamamen
farklı bir iş.

| Adım | Ne yapılır |
|---|---|
| A | Tarayıcı **tam ekran**. Betiği koştur, 40 sn standart hareket. Tabloyu kaydet. |
| B | Tarayıcı penceresini **ekranın dörtte birine** küçült. Aynı betik, aynı hareket. Tabloyu kaydet. |

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
| A | Toplu çizim **açık**. Betik + 40 sn standart hareket. |
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
| A | Fareye **hiç dokunmadan** 40 sn. Betik koşsun, sahne dursun. |
| B | 40 sn standart hareket. |

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

---

## Ne göndereceksin

Sıralama önem sırasına göre:

1. **T1 profil dosyası** (`.json`) + Bottom-Up ekran görüntüsü
2. T2, T3, T4 tabloları (her biri betiğin bastığı çıktı, kopyala-yapıştır)
3. T0 ortam bilgisi (üç madde)
4. Varsa T5, T6

Her tabloyu **hangi test ve hangi adım olduğunu yazarak** gönder — "T3-B,
toplu çizim kapalı" gibi. Etiketsiz tablolar karşılaştırılamaz.

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
