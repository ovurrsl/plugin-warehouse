'use client'

import type { CSSProperties, ReactNode } from 'react'

/**
 * Eklenti panellerinin, host'un bileşen sunmadığı parçaları.
 *
 * ## Neden bu dosya var
 *
 * `parametric-inspector.tsx:173-177` trailing bölümü host'un
 * `<PanelSection>`'larının **çıplak kardeşi** olarak çiziyor:
 *
 * ```tsx
 * {TrailingSection && <Suspense fallback={null}><TrailingSection /></Suspense>}
 * ```
 *
 * Her host grubu `p-3 pt-2` iç boşluk, `h-10` başlık ve `border-b` ayraç
 * alıyor; trailing bölüm hiçbirini almıyor. Bu yüzden eklentinin panelleri,
 * üstlerindeki host gruplarıyla aynı hizada durmuyordu — ve kendi çerçeveli
 * "kart"larını çizdikleri için, zaten çerçeveli bölümlerin içinde ikinci bir
 * çerçeve katmanı olarak okunuyorlardı. Kullanıcının "içi içe giren ayarlar"
 * dediği şeyin görsel yarısı budur.
 *
 * Çözüm iki parçalı: bölümler artık host'un kendi `<PanelSection>`'ı
 * (başlık + iç boşluk + ayraç + katlanma, hepsi bedava), içleri de aşağıdaki
 * ilkellerle doldurulur.
 *
 * ## Neden Tailwind yazılmıyor
 *
 * Tailwind v4'ün tarayıcısı sembolik bağları izlemiyor ve git URL'inden kurulan
 * paket her zaman paket yöneticisinin deposuna sembolik bağ olarak iniyor
 * (`node_modules/@ovurrsl/plugin-warehouse -> .bun/...`). Host'un
 * `globals.css`'inde bu paket için `@source` satırı da yok. Yani bu paketin
 * içine yazılan bir yardımcı sınıf host'un stil dosyasına HİÇ derlenmiyor ve
 * hata da vermiyor — sessizce stilsiz bir panel çıkıyor.
 *
 * Host bileşenleri bu sorundan muaf: sınıfları `packages/editor/src` içinde
 * yaşıyor, orası `@source`'lu. Bu yüzden kural şu: **bir host bileşeni varsa
 * onu kullan; yoksa satır içi stil yaz.** Aşağıdaki ölçüler host'un derlenmiş
 * sınıflarının birebir karşılıklarıdır, öyle kalmalıdır.
 */

const FG = 'var(--foreground)'
const MUTED = 'var(--muted-foreground)'
const BORDER = 'var(--border)'

/** `text-foreground/80` — host'un etiket rengi. */
const FG_80 = `color-mix(in oklab, ${FG} 80%, transparent)`
/** `border-border/50` — host'un kontrol kenarlığı. */
const BORDER_50 = `color-mix(in oklab, ${BORDER} 50%, transparent)`
/** `bg-[#2C2C2E]` — host'un kontrol dolgusu, tema değişkeni değil literal. */
const CONTROL_BG = '#2C2C2E'

const styles = {
  /** Host'un enum satırı: `flex items-center justify-between px-3 py-2`. */
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    padding: '0.125rem 0.5rem',
    fontSize: '0.75rem',
    lineHeight: '1rem',
  },
  rowLabel: { color: FG_80 },
  rowValue: { color: FG, fontVariantNumeric: 'tabular-nums', textAlign: 'right' },

  /** `text-[10px] uppercase tracking-wide text-muted-foreground` + `px-1 pb-1`. */
  caption: {
    padding: '0 0.25rem 0.25rem',
    fontSize: '0.625rem',
    lineHeight: '0.875rem',
    textTransform: 'uppercase',
    letterSpacing: '0.025em',
    color: MUTED,
  },
  captionRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  captionHint: { textTransform: 'none', letterSpacing: 0, opacity: 0.75 },

  field: { display: 'flex', flexDirection: 'column' },

  /** İpucu — `text-[11px]`, gövdeye göre bir kademe küçük. */
  note: {
    margin: 0,
    padding: '0 0.5rem',
    fontSize: '0.6875rem',
    lineHeight: 1.45,
    color: MUTED,
  },

  /** Host'un `<select>`'i, `parametric-inspector.tsx:359` ile birebir. */
  select: {
    minWidth: 0,
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER_50}`,
    background: CONTROL_BG,
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    color: FG,
  },

  /** Metin girişi — `<select>` ile aynı kutu, tek fark hizalama. */
  input: {
    flex: 1,
    minWidth: 0,
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER_50}`,
    background: CONTROL_BG,
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    fontVariantNumeric: 'tabular-nums',
    color: FG,
  },
} satisfies Record<string, CSSProperties>

/**
 * Etiket/değer okuması — panellerin en çok tekrarlanan parçası.
 *
 * Yedi panel bunu kendi `styles.readout` + `styles.label` ikilisiyle elle
 * çiziyordu; hepsi aynı ölçüleri farklı dosyalarda tutuyordu, yani biri
 * değişince diğer altısı sessizce ayrışıyordu.
 *
 * `null` satırlar atlanıyor, böylece çağıran taraf koşullu satırları
 * `...(x ? [row] : [])` gibi bir ifadeyle değil, doğrudan `cond && row` ile
 * yazabiliyor.
 */
export function Figures({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, ReactNode] | null | false | undefined>
}) {
  return (
    <>
      {rows.map((entry) =>
        entry ? (
          <div key={entry[0]} style={styles.row}>
            <span style={styles.rowLabel}>{entry[0]}</span>
            <span style={styles.rowValue}>{entry[1]}</span>
          </div>
        ) : null,
      )}
    </>
  )
}

/** Tek okuma satırı — `Figures` bir dizi kadar satır istemediğinde. */
export function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{children}</span>
    </div>
  )
}

/** Gerekçe metni. Uyarı DEĞİL — `IssueList` uyarıları taşır, bu bağlam taşır. */
export function Note({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  return (
    <p style={tone === 'danger' ? { ...styles.note, color: 'var(--destructive)' } : styles.note}>
      {children}
    </p>
  )
}

/**
 * Bir kontrolün üstündeki mini başlık.
 *
 * Host `SegmentedControl`'ü etiketsiz çiziyor (`parametric-inspector.tsx:348`)
 * çünkü kendi enum alanlarının anahtarı zaten grup içinde tekil. Eklentide bir
 * bölüm birden çok segmentli kontrol taşıyabiliyor, o yüzden host'un kendi
 * panellerinde kullandığı üstten mini başlık deseni geçerli
 * (`nodes/src/cabinet/compartment-card.tsx:316`).
 */
export function Caption({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div style={hint ? { ...styles.caption, ...styles.captionRow } : styles.caption}>
      <span>{children}</span>
      {hint ? <span style={styles.captionHint}>{hint}</span> : null}
    </div>
  )
}

/** Mini başlık + kontrol. Tek satırlık sarmalayıcı ama on iki dosyada tekrar
 *  ediyordu ve her birinde boşluğu biraz farklıydı. */
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div style={styles.field}>
      <Caption hint={hint}>{label}</Caption>
      {children}
    </div>
  )
}

/**
 * Etiket + `<select>` — host'un segmentli olmayan enum alanının aynısı.
 *
 * Segmentli kontrol seçenek sayısı üçü geçince rayı taşırıyor; host bu sınırı
 * `display: 'segmented'` bayrağıyla yazara bırakmış. Uzun listeler (profil
 * kimlikleri, mast satırları, yuva adresleri) buraya düşer.
 */
export function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: ReactNode
  value: T
  options: ReadonlyArray<{ label: ReactNode; value: T }>
  onChange: (value: T) => void
}) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <select
        onChange={(event) => onChange(event.target.value as T)}
        style={styles.select}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Etiket + serbest metin — SKU gibi kapalı listesi olmayan alanlar için. */
export function TextRow({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: ReactNode
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{ ...styles.input, flex: '0 1 9rem', textAlign: 'right' }}
        type="text"
        value={value}
      />
    </label>
  )
}
