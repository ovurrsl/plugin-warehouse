# Kat çoğaltma / sahne yükleme donmasını ölçme

Bu betik **kod erişimi gerektirmez** — senin dağıtımındaki build'de olduğu gibi
çalışır. Ana iş parçacığının ne kadar süre ve kaç parça hâlinde bloke olduğunu
ölçer; bildirilen belirtinin ("kamera bile oynamıyor") doğrudan sayısal
karşılığı budur.

## Neden bu, fonksiyon fonksiyon ölçüm değil

Kat çoğaltmanın maliyeti host içinde dağılmış durumda: düğüm başına JSON
roundtrip, ebeveyn `children` yeniden kurulumu, eklenti düğümleri için başarısız
şema doğrulaması, autosave serileştirmesi, slab tarama ve tek commit'te mount.
Bunları tek tek saymak host'a enstrümantasyon eklemeyi gerektirir; üretim
build'i mağaza handle'ı dışa vermediği için konsoldan erişilemezler.

Uzun görev (`longtask`) ölçümü bu ayrımı yapmaz ama **kullanıcının gerçekte
yaşadığı şeyi** ölçer: arayüz kaç milisaniye yanıt vermedi. Öncesi/sonrası
karşılaştırması için gereken de tam olarak bu.

## Kullanım

1. Editörü aç, projeyi yükle
2. DevTools → Console
3. Aşağıdaki betiği yapıştır ve Enter
4. Betik "HAZIR" yazınca ölçmek istediğin şeyi yap (kat çoğalt, ya da sahneyi
   yükle)
5. 40 saniye sonra tabloyu bas — çıktıyı paylaş

```js
(() => {
  const WINDOW_MS = 40_000;
  const tasks = [];
  const frames = [];
  let last = performance.now();

  const po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) tasks.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) });
  });
  try { po.observe({ entryTypes: ['longtask'] }); }
  catch { console.warn('longtask desteklenmiyor — yalnız kare aralıkları ölçülecek'); }

  let stop = false;
  (function tick() {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (!stop) requestAnimationFrame(tick);
  })();

  const t0 = performance.now();
  console.log('%cHAZIR — şimdi kat çoğaltmayı yap (ya da sahneyi yükle)', 'font-weight:bold;color:#0a0');

  setTimeout(() => {
    stop = true; po.disconnect();
    const dur = (performance.now() - t0) / 1000;
    const blocked = tasks.reduce((s, x) => s + x.ms, 0);
    const sorted = [...frames].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

    // Birincil ölçüm KARE ARALIKLARINDAN türetiliyor, `longtask`'tan değil:
    // longtask her ortamda raporlanmıyor (doğrulandı — 900 ms'lik bilerek
    // eklenmiş bir blok longtask üretmeden kare aralığında görüldü). Kaçırılan
    // kare, kullanıcının gördüğü donmanın ta kendisi.
    const STALL = 50;
    const stalls = frames.filter((f) => f > STALL);
    const stalledMs = Math.round(stalls.reduce((s, f) => s + (f - 16.7), 0));

    console.log('%c=== ANA İŞ PARÇACIĞI (kare aralıklarından) ===', 'font-weight:bold');
    console.table({
      'ölçüm süresi (sn)':        +dur.toFixed(1),
      'takılma sayısı (>50ms)':   stalls.length,
      'toplam bloke (ms)':        stalledMs,
      'bloke oranı (%)':          +((stalledMs / (dur * 1000)) * 100).toFixed(1),
      'en uzun tek blok (ms)':    Math.round(sorted[sorted.length - 1] ?? 0),
      '>1 sn bloklar':            frames.filter((f) => f > 1000).length,
    });

    console.log('%c=== KARE DAĞILIMI ===', 'font-weight:bold');
    console.table({
      'kare sayısı':      frames.length,
      'ortalama fps':     +(frames.length / dur).toFixed(1),
      'p50 (ms)':         +q(0.5).toFixed(1),
      'p95 (ms)':         +q(0.95).toFixed(1),
      '>100ms kareler':   frames.filter((f) => f > 100).length,
    });

    // longtask varsa ek bilgi — yoksa yukarıdaki tablo zaten yeterli.
    if (tasks.length) {
      console.log('%c=== longtask (varsa; ek doğrulama) ===', 'font-weight:bold');
      console.table({
        'uzun görev sayısı':     tasks.length,
        'toplam (ms)':           blocked,
        'en uzun (ms)':          Math.max(...tasks.map((x) => x.ms)),
      });
    }

    if (stalls.length) {
      console.log('%c=== EN UZUN 10 TAKILMA ===', 'font-weight:bold');
      console.table([...stalls].sort((a, b) => b - a).slice(0, 10)
        .map((f, i) => ({ '#': i + 1, 'süre (ms)': Math.round(f) })));
    }
  }, WINDOW_MS);
})();
```

## Nasıl okunur

**"Toplam bloke"** senin hiçbir şey yapamadığın süre. **"En uzun tek blok"**
kilitlenme hissinin kaynağı: tek bir 8 saniyelik blok, seksen tane 100 ms'lik
bloktan çok daha kötü hissettirir, ikisi de aynı toplamı verse bile.

**">1 sn bloklar"** sıfırdan büyükse arayüz gerçekten donmuş demektir —
tarayıcı o süre boyunca tıklama, tuş ve kamera hareketini hiç işleyemez.

## Karşılaştırma için

Aynı ölçümü **iki kez** koş:

| koşu | ne zaman |
|---|---|
| **önce** | mevcut dağıtım (eklenti `9e1b525`) |
| **sonra** | pin `v0.1.3`'e bump'landıktan sonra |

Aynı projede, aynı eylemle. İki tabloyu yan yana koyunca düzeltmelerin gerçek
etkisi çıkar — buradaki başsız ortamda render bozuk olduğu için o rakamı ben
üretemiyorum.

## Ölçülemeyenler

Bu betik **neyin** pahalı olduğunu söylemez, yalnız **ne kadar**. Adım adım
dağılım için host'a enstrümantasyon gerekiyor; hangi adımların baskın olduğu ve
neden `docs/DUZELTME-kirli-bayragi.md` ile `docs/upstream-*.md` içinde kaynak
okumasıyla çıkarılmış durumda.
