'use client'

import { useScene } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { kindOf } from '../host-adapter'
import { KIND_PREFIX } from '../plugin-id'

/**
 * Kademeli mount — büyük bir sahne tek React commit'inde kurulmasın.
 *
 * ## Neden
 *
 * Bir rafın mount'u ucuz değil: kayıt defteri, olay bağlama, kolektif havuza
 * kayıt, iki katman için şekil anahtarı inşası (`rackGeometryKey` dizge kuruyor)
 * ve geometri tutma. Binlerce rafı tek commit'te mount etmek bu işin tamamını
 * tek kareye yığıyor ve sekme o süre boyunca girdiye yanıt vermiyor.
 *
 * Host aynı sorunu duvar, kapı ve pencerede zaten böyle çözüyor
 * (`wall-system.tsx`: kare başına tavan + zaman bütçesi, işlenmeyen sonraki
 * kareye kalır — *"Large imports enter the progressive path so initial load
 * can't lock the tab"*). Bu, aynı sözleşmenin bu paketteki karşılığı.
 *
 * ## Neden kendi rAF döngüsü, kolektif sistemin `useFrame`'i değil
 *
 * Kolektif sistem kapatılabilir (`instancingEnabled`) ve dışa aktarımda erken
 * dönüyor. Mount izni ona bağlansaydı, o kapalıyken hiçbir raf hiç görünmezdi —
 * yani bir performans ayarı, sahneyi tamamen boş bırakan bir hataya dönüşürdü.
 * Kendi döngüsü yalnız kuyruk doluyken koşuyor ve boşalınca kendini durduruyor.
 */

/**
 * Kare başına ayrılan süre, milisaniye.
 *
 * Host'un duvar yolundaki bütçesiyle (`WALL_PROGRESSIVE_TIME_BUDGET_MS = 8`)
 * aynı. Sayı yerine SÜRE tavanı olması bilinçli: mount maliyeti makineye göre
 * değişiyor, sabit bir adet hızlı makinede gereksiz yavaş, yavaş makinede hâlâ
 * kilitleyici olurdu. Süreye bakmak ikisini de kendiliğinden ayarlıyor.
 */
const TIME_BUDGET_MS = 8

/**
 * Bütçeye bakılmaksızın karede en az bu kadar düğüm kabul edilir.
 *
 * Bütçe tek başına bırakılırsa, tek bir mount bütçeyi aşan bir makinede kuyruk
 * kare başına bir düğüm ilerler ve beş bin raf dakikalar sürerdi. Taban, en
 * kötü durumda bile ilerlemeyi garanti ediyor.
 */
const MIN_PER_FRAME = 8

/**
 * Bütçe dolmadıysa karede en fazla bu kadar.
 *
 * İki işi birden görüyor: küçük sahnenin tamamı ilk turda geçsin (elli raflık
 * tesis kademeli yola hiç girmez, tek karede mount olur), BÜYÜK sahne ise
 * GÖRÜNÜR biçimde aksın — kullanıcı isteği (2026-08-07): raflar "tek seferde"
 * değil, göz göz belirsin. Eski 512, 3.582 rafı ~7 karede bitiriyordu ve
 * "hepsi birden" okunuyordu; 64 aynı sahneyi ~56 kareye (≈1,1 sn) yayıyor —
 * akış görünür, toplam süre hâlâ saniye mertebesinde. Süre bütçesi (8 ms)
 * yavaş makinede yine ilk sınır.
 */
const MAX_PER_FRAME = 64

/**
 * ÖNCE HOST, SONRA EKLENTİ — kullanıcı isteğinin ikinci yarısı.
 *
 * Sahne açılırken host kendi kind'larını kuruyor (duvar/kapı/pencere kendi
 * kademeli yollarında) ve `dirtyNodes` o iş bitene kadar host kind'ları
 * taşıyor. Kademeli yola GİRMİŞ bir eklenti kuyruğu, host'un işi sürerken
 * bekletiliyor: bina önce, raflar sonra ve akarak.
 *
 * İki sigorta: (a) yalnız kuyruk gerçekten büyükken (progressive eşiği) —
 * küçük sahne ve tekil eklemeler beklemez; (b) bekleme tavanlı — host'un
 * bayrağı temizlenmeyen bir kind'ı (upstream'de yaşanmış sınıf) kuyruğu
 * sonsuza dek kilitlemesin diye en çok ~3 sn.
 */
const HOST_FIRST_THRESHOLD = MAX_PER_FRAME
const HOST_WAIT_FRAMES_MAX = 150
let hostWaitFrames = 0

/** Host'un HÂLÂ kurduğu bir şey var mı — kirli kümede eklenti-dışı kind.
 *  İlk eklenti-dışı kimlikte döner; yükleme sırasında ilk eleman genelde o. */
function hostStillBuilding(): boolean {
  const state = useScene.getState()
  if (state.dirtyNodes.size === 0) return false
  const nodes = state.nodes as Readonly<Record<string, unknown>>
  for (const id of state.dirtyNodes) {
    if (!kindOf(nodes[id])?.startsWith(KIND_PREFIX)) return true
  }
  return false
}

/** Kabul bekleyenler: düğüm kimliği → bileşeni uyandıran geri çağrı. */
const waiting = new Map<string, () => void>()

/**
 * Bir kez kabul edilmiş düğümler.
 *
 * Yeniden mount kuyruğa GİRMEMELİ: kat görünürlüğü açılıp kapandığında ya da
 * React bir alt ağacı yeniden kurduğunda, zaten görünmüş raflar yeniden
 * sıraya girip bir kare kaybolurdu — kullanıcıya titreme olarak görünür.
 */
const admitted = new Set<string>()

let frame: number | null = null

/** Dışa aktarım: bütçe yok, kuyruk olduğu gibi boşaltılır. */
let draining = false

function pump(): void {
  frame = null

  // Önce host: büyük dalga, host'un kendi kurulumu sürerken bekler (tavanlı).
  // Dışa aktarım boşaltması beklemez — dosyadaki sahne eksiksiz çıkmalı.
  if (!draining && waiting.size > HOST_FIRST_THRESHOLD && hostWaitFrames < HOST_WAIT_FRAMES_MAX) {
    if (hostStillBuilding()) {
      hostWaitFrames++
      schedule()
      return
    }
  }

  const started = performance.now()
  let count = 0
  for (const [id, wake] of waiting) {
    if (!draining && count >= MIN_PER_FRAME) {
      if (count >= MAX_PER_FRAME) break
      if (performance.now() - started >= TIME_BUDGET_MS) break
    }
    waiting.delete(id)
    admitted.add(id)
    count++
    wake()
  }
  if (waiting.size > 0) schedule()
  else hostWaitFrames = 0
}

function schedule(): void {
  if (frame !== null) return
  if (typeof requestAnimationFrame !== 'function') return
  frame = requestAnimationFrame(pump)
}

/**
 * Kuyruğu ŞİMDİ boşalt — dışa aktarımın tek doğru davranışı.
 *
 * Dışa aktarma her zaman dosyadaki sahnedir; kademeli mount'un ortasında
 * aktarılan bir sahne, rafların bir kısmı eksik çıkardı. Senkron, çünkü bir
 * kare beklemek dışa aktarımın aynı tick'te anlık görüntü aldığı hâlde geç
 * kalırdı.
 */
export function admitAllNow(): void {
  draining = true
  const wakes = [...waiting.values()]
  for (const id of waiting.keys()) admitted.add(id)
  waiting.clear()
  for (const wake of wakes) wake()
}

/** Dışa aktarım bitti: bütçe yeniden devrede. */
export function resumeProgressiveAdmission(): void {
  draining = false
}

/** Test kancası. */
export function resetAdmission(): void {
  waiting.clear()
  admitted.clear()
  draining = false
  hostWaitFrames = 0
  if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  frame = null
}

/** Test ve teşhis: kaç düğüm sırada. */
export function pendingAdmissions(): number {
  return waiting.size
}

/**
 * Bu düğüm gövdesini mount edebilir mi.
 *
 * `false` döndüğü sürece çağıran `null` döndürmeli — kancalar kuralı gereği
 * pahalı kancalar koşullu olamayacağı için, kapı gövdeyi AYRI bir bileşende
 * tutmak zorunda. Kapının kendisi tek `useState` + tek `useEffect`, yani
 * beklerken düğüm başına maliyet ihmal edilebilir.
 */
export function useAdmitted(nodeId: string): boolean {
  const [ok, setOk] = useState(() => admitted.has(nodeId))

  useEffect(() => {
    if (admitted.has(nodeId)) {
      // Sıraya girmeden geçen yol: bu düğüm daha önce kabul edilmiş ve
      // yeniden mount olmuş. `setOk` yalnız durum gerçekten yanlışsa yazılır.
      setOk(true)
      return
    }
    let live = true
    waiting.set(nodeId, () => {
      if (live) setOk(true)
    })
    schedule()
    return () => {
      live = false
      waiting.delete(nodeId)
    }
  }, [nodeId])

  return ok
}
