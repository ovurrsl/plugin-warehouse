'use client'

import { Icon } from '@iconify/react'
import { useScene } from '@pascal-app/core'
import { SegmentedControl, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import {
  CATALOG_ITEMS,
  CATALOG_SECTIONS,
  type CatalogItem,
  chipIsArmed,
  itemsInSection,
} from '../catalog'
import { reportHostCompatibility } from '../compat'
import { CARGO_COLOR_IDS, CARGO_COLORS } from '../pallet/cargo-constants'
import {
  type Qualification,
  resolveStatsScope,
  type SlabFigure,
  type StatsReport,
  sceneStats,
  statsReport,
} from '../stats'
import { type PanelTab, useWarehouseStore } from '../store'
import { buildFleet, EMPTY_FLEET } from '../truck/fleet'
import { areaLabel, type LinearUnit, lengthLabel } from '../units'
import { categoryChip, checkbox, listRow, tile, tokens } from './styles'

/**
 * The plugin's left-rail panel. Two tabs share one rail slot: browse-and-place,
 * and the capacity readout. The host mounts this lazily inside an error
 * boundary and passes no props.
 *
 * A rail panel is a plain scroll container — the rail owns the chrome. Host
 * controls are composed where one exists (`SegmentedControl` here, the slider
 * and toggle controls once racking lands); everything else is styled from
 * `./styles`, which resolves host CSS variables at runtime so it tracks the
 * theme without depending on the host's Tailwind build.
 */
export default function WarehousePanel() {
  const tab = useWarehouseStore((s) => s.tab)
  const setTab = useWarehouseStore((s) => s.setTab)

  // One console block naming which optional host reads are live. Runs here
  // rather than in the manifest barrel so it stays off the SSR path.
  useEffect(() => {
    reportHostCompatibility()
  }, [])

  // Read off the memoised index rather than filtering the node map inside the
  // selector. The old form ran an O(nodes) filter and allocated an array on
  // every store write -- every tick of every unrelated drag -- to return a
  // number. `sceneStats` returns the same object until `nodes` changes.
  const placed = useScene((s) => sceneStats(s.nodes as Record<string, unknown>).placed)

  return (
    <div style={tokens.root}>
      <header style={tokens.header}>
        <div style={tokens.titleRow}>
          <h2 style={tokens.title}>Asset</h2>
          <span style={tokens.countChip}>{placed} placed</span>
        </div>
        <SegmentedControl
          onChange={(value: PanelTab) => setTab(value)}
          options={[
            { label: 'Catalog', value: 'catalog' },
            { label: 'Stats', value: 'stats' },
          ]}
          value={tab}
        />
      </header>

      {tab === 'catalog' ? <CatalogTab /> : <StatsTab />}
    </div>
  )
}

function CatalogTab() {
  /**
   * `null` means no category filter — every item shows.
   *
   * That is the default on purpose: opening the panel to a pre-selected first
   * category hides most of the catalog behind a tab the user did not choose,
   * and "what can I place?" is the question the panel opens on.
   */
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')
  const activeTool = useEditor((s) => s.tool)
  const armedChipId = useWarehouseStore((s) => s.armedChipId)
  const setBrush = useWarehouseStore((s) => s.setPalletBrush)
  const setRouteBrush = useWarehouseStore((s) => s.setRouteBrush)

  const activeSection = useMemo(
    () => (activeSectionId ? CATALOG_SECTIONS.find((s) => s.id === activeSectionId) : undefined),
    [activeSectionId],
  )

  /**
   * The grid's contents: category filter first, then the search text.
   *
   * Search deliberately ignores the category — someone typing a name wants it
   * found wherever it lives, not "no results" because the wrong tab is open.
   */
  const visibleItems = useMemo(() => {
    const base = activeSectionId ? itemsInSection(activeSectionId) : [...CATALOG_ITEMS]
    const query = search.trim().toLowerCase()
    if (!query) return base
    const pool = search ? [...CATALOG_ITEMS] : base
    return pool.filter((item) =>
      `${item.label} ${item.description} ${item.kind}`.toLowerCase().includes(query),
    )
  }, [activeSectionId, search])

  const arm = (item: CatalogItem) => {
    useWarehouseStore.getState().setArmedChipId(item.id)
    if (item.brush?.kind === 'pallet') setBrush({ cargo: item.brush.cargo })
    if (item.brush?.kind === 'route') {
      setRouteBrush({ role: item.brush.role, traffic: item.brush.traffic })
    }
    // Beş makine tile'ı beş ayrı model — fırçaya yazılmazsa hepsi
    // varsayılan forklift'i yerleştirir ve katalog yalan söyler.
    if (item.brush?.kind === 'truck') {
      useWarehouseStore.getState().setTruckBrush({ model: item.brush.model as never })
    }
    if (item.brush?.kind === 'rack') {
      useWarehouseStore.getState().setRackBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'telescopic') {
      useWarehouseStore.getState().setTelescopicBrush({ model: item.brush.model as never })
    }
    if (item.brush?.kind === 'conveyor-spiral') {
      useWarehouseStore.getState().setSpiralBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'mezzanine') {
      useWarehouseStore.getState().setMezzanineBrush(item.brush.patch as never)
    }
    if (item.brush?.kind === 'longspan') {
      useWarehouseStore.getState().setLongspanBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'm3') {
      useWarehouseStore.getState().setM3Brush(item.brush.patch)
    }
    if (item.brush?.kind === 'drive-in') {
      useWarehouseStore.getState().setDriveInBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'live-racking') {
      useWarehouseStore.getState().setLiveRackingBrush(item.brush.patch)
    }
    // Tezgâhın altı fişi de varyantını buradan yazıyor. YAZILMADIĞI sürece
    // altısı da fırçadaki varsayılanı (`processing`) koyuyordu: katalog altı
    // farklı masa gösterip tek masa yerleştiriyordu, ve fark yalnız gözle
    // görülüyordu. `catalog.test.ts` artık her fırça kolunun bir uygulayıcısı
    // olduğunu kilitliyor.
    if (item.brush?.kind === 'bench') {
      useWarehouseStore.getState().setBenchBrush({
        ...item.brush.patch,
        // Varyantla birlikte elle girilmiş ölçüler de temizleniyor —
        // aracın `[`/`]` davranışının aynısı, aynı gerekçeyle.
        width: undefined,
        height: undefined,
        depth: undefined,
      })
    }
    if (item.brush?.kind === 'dockleveller') {
      useWarehouseStore.getState().setDockLevellerBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'pallet-lift') {
      useWarehouseStore.getState().setPalletLiftBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'totecart') {
      useWarehouseStore.getState().setToteCartBrush(item.brush.patch)
    }
    // The host types `tool` as its own built-in union, which by construction
    // cannot know about plugin-contributed kinds. Arming by kind string is the
    // path a catalog panel is expected to use.
    const editor = useEditor.getState() as unknown as {
      setTool: (value: string) => void
      setMode: (value: string) => void
    }
    editor.setTool(item.kind)
    editor.setMode('build')
  }

  return (
    <div style={tokens.sections}>
      {/*
        Categories read as names, not pictures. A warehouse catalog splits on
        words a user already knows ("Racking", "Conveyance"); an icon per
        category asks them to learn a second vocabulary to reach the same
        shelf. The tiles below still carry icons — there the picture IS the
        distinguishing information.

        Inline styles rather than utility classes throughout this file: this
        package is installed from a git URL, so it lands as a symlink, and
        Tailwind v4's scanner does not follow symlinks. A class written here is
        never compiled and the failure is silent. See `styles.ts`.
      */}
      <div style={tokens.chipRow}>
        <button
          onClick={() => {
            setActiveSectionId(null)
            setSearch('')
          }}
          style={categoryChip(activeSectionId === null)}
          type="button"
        >
          All
        </button>
        {CATALOG_SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => {
              setActiveSectionId(section.id)
              setSearch('')
            }}
            style={categoryChip(activeSectionId === section.id)}
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>

      <input
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search..."
        style={tokens.searchInput}
        type="text"
        value={search}
      />

      {/* Category description and contextual controls */}
      {!search && activeSection && (
        <div style={tokens.section}>
          <p style={tokens.blurb}>{activeSection.blurb}</p>
          {activeSection.id === 'unit-loads' && <LoadBrush />}
          {activeSection.id === 'conveyance' && <FlowSwitch />}
          {activeSection.id === 'handling' && <FleetSwitch />}
        </div>
      )}

      {/*
        The plugin draws its own grid rather than composing the host's
        `ItemCatalog`.

        Not a style preference: `ItemCatalog` is exported only from the fork's
        `integration` branch and has never been published, so importing it made
        this package impossible to type-check against any release of
        `@pascal-app/editor` — `bun run check-types` failed on `main` with
        "has no exported member 'ItemCatalog'", and CI has been red on it.
        Verified against the newest published build, 1.0.0-beta.5: the barrel
        exports `FloatingLevelSelector` and not `ItemCatalog`.

        Drawing it here also gets the layout this panel wants — four to a row
        against the host grid's `auto-fill, minmax(90px, …)`, which yields two
        in a 256 px rail.
      */}
      {visibleItems.length > 0 ? (
        <div style={tokens.tileGrid}>
          {visibleItems.map((item) => (
            <CatalogTile
              armed={chipIsArmed(item, activeTool, armedChipId)}
              item={item}
              key={item.id}
              onArm={arm}
            />
          ))}
        </div>
      ) : (
        <div style={tokens.empty}>
          {search ? `No items matching "${search}"` : 'Nothing here yet.'}
        </div>
      )}

      <InstancingSwitch />
      <DetailRangeSwitch />
    </div>
  )
}

/**
 * Detay mesafesi kolu — LOD bantlarının çarpanı (`store.lodQuality`).
 *
 * Toplu çizim anahtarının hemen altında, aynı gerekçeyle: bakışın bir
 * özelliği, herhangi bir düğümün değil. "Yakın" tümleşik GPU'da uzak katmana
 * erken düşerek çizim maliyetini kısar; "Geniş" güçlü makinede tam detayı
 * uzağa taşır. Değerler seçilmiş varsayılanlar — bkz. `store.ts`.
 */
/**
 * One catalog tile: icon over label, five to a row.
 *
 * Stateless by design — arming lives in `CatalogTab.arm`, which is the only
 * place that knows the brush-per-family rules. A tile that armed itself would
 * put that switch behind every kind added later.
 */
function CatalogTile({
  item,
  armed,
  onArm,
}: {
  item: CatalogItem
  armed: boolean
  onArm: (item: CatalogItem) => void
}) {
  const isRaster =
    item.icon.startsWith('/') || item.icon.endsWith('.webp') || item.icon.endsWith('.png')
  return (
    <button onClick={() => onArm(item)} style={tile(armed)} title={item.description} type="button">
      {isRaster ? (
        <img
          alt={item.label}
          src={item.icon}
          style={{ width: 18, height: 18, objectFit: 'contain' }}
        />
      ) : (
        <Icon height={18} icon={item.icon} style={tokens.tileIcon} width={18} />
      )}
      <span style={tokens.tileLabel}>{item.label}</span>
    </button>
  )
}

function DetailRangeSwitch() {
  const quality = useWarehouseStore((s) => s.lodQuality)
  const setQuality = useWarehouseStore((s) => s.setLodQuality)
  const options = [
    ['near', 'Yakın'],
    ['balanced', 'Denge'],
    ['wide', 'Geniş'],
  ] as const

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.25rem',
        width: '100%',
        marginTop: '0.25rem',
      }}
      title="Uzak katmana geçiş mesafesi. Yakın: daha hızlı, detay daha erken düşer. Geniş: tam detay daha uzağa taşınır."
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          onClick={() => setQuality(value)}
          style={{
            flex: 1,
            borderRadius: '0.375rem',
            border:
              quality === value
                ? '1px solid color-mix(in oklab, var(--foreground) 35%, transparent)'
                : '1px solid var(--border)',
            background:
              quality === value
                ? 'color-mix(in oklab, var(--foreground) 8%, transparent)'
                : 'transparent',
            padding: '0.3125rem 0',
            fontSize: '0.6875rem',
            color: quality === value ? 'var(--foreground)' : 'var(--muted-foreground)',
            cursor: 'pointer',
          }}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * Kolektif instancing anahtarı.
 *
 * Ölçüm: 5300 düğümlük gerçekçi bir sahnede ~10.300 çizim çağrısı ~11'e
 * iniyor. Kapatılabilir, çünkü bu değişiklik render yolunun en kritik
 * parçasına dokunuyor — bozulursa tek tıkla eski davranış geri gelir ve iki
 * hâl yan yana ölçülebilir.
 */
function InstancingSwitch() {
  const enabled = useWarehouseStore((s) => s.instancingEnabled)
  const setEnabled = useWarehouseStore((s) => s.setInstancingEnabled)

  return (
    <button
      onClick={() => setEnabled(!enabled)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        width: '100%',
        marginTop: '0.25rem',
        borderRadius: '0.375rem',
        border: '1px solid var(--border)',
        background: 'transparent',
        padding: '0.375rem 0.5rem',
        fontSize: '0.6875rem',
        color: 'var(--muted-foreground)',
        cursor: 'pointer',
      }}
      title="Aynı şekildeki rafları ve paletleri tek çizim çağrısında toplar. Kapatmak eski davranışa döner."
      type="button"
    >
      <Icon height={13} icon={enabled ? 'lucide:zap' : 'lucide:zap-off'} width={13} />
      <span>Toplu çizim {enabled ? 'açık' : 'kapalı'}</span>
      <span style={{ marginLeft: 'auto' }}>{enabled ? 'hızlı' : 'nesne başına'}</span>
    </button>
  )
}

/**
 * Runs the boxes.
 *
 * Scene-wide rather than per-node, and in the catalog rather than in an
 * inspector, because it is a property of *looking* at the layout rather than of
 * any one module — six conveyor panels each carrying the same switch would be
 * six ways to set one thing.
 *
 * Off by default: a layout tool that animates the moment it opens is a layout
 * tool nobody can read.
 */
function FlowSwitch() {
  const running = useWarehouseStore((s) => s.flowRunning)
  const setRunning = useWarehouseStore((s) => s.setFlowRunning)

  return (
    <button
      onClick={() => setRunning(!running)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        width: '100%',
        marginBottom: '0.5rem',
        borderRadius: '0.375rem',
        border: `1px solid ${running ? 'color-mix(in oklab, #e87722 55%, transparent)' : 'var(--border)'}`,
        background: running ? 'color-mix(in oklab, #e87722 12%, transparent)' : 'transparent',
        padding: '0.375rem 0.5rem',
        fontSize: '0.6875rem',
        color: 'var(--foreground)',
        cursor: 'pointer',
      }}
      type="button"
    >
      <Icon height={13} icon={running ? 'lucide:pause' : 'lucide:play'} width={13} />
      <span>{running ? 'Stop the boxes' : 'Run the boxes'}</span>
      <span style={{ marginLeft: 'auto', color: 'var(--muted-foreground)' }}>
        every line at its own speed
      </span>
    </button>
  )
}

/**
 * Runs the fleet. FlowSwitch'in araç karşılığı: sahne-genel, katalogda,
 * varsayılan kapalı. Yalnız `duty: shuttle` + rotası atanmış araçlar sürer;
 * tavan 16 — fazlası park kalır ve araç paneli kaçının koştuğunu söyler.
 */
function FleetSwitch() {
  const running = useWarehouseStore((s) => s.fleetRunning)
  const setRunning = useWarehouseStore((s) => s.setFleetRunning)
  // Tavan aşımı sessiz kalamaz: hesap zaten fleet kuruluşunun kendisi ve
  // panel yalnız koşarken sayar — kapalıyken sahne taranmaz.
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)
  const fleet = useMemo(() => (running ? buildFleet(nodes) : EMPTY_FLEET), [nodes, running])

  return (
    <button
      onClick={() => setRunning(!running)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        width: '100%',
        marginBottom: '0.5rem',
        borderRadius: '0.375rem',
        border: `1px solid ${running ? 'color-mix(in oklab, #e87722 55%, transparent)' : 'var(--border)'}`,
        background: running ? 'color-mix(in oklab, #e87722 12%, transparent)' : 'transparent',
        padding: '0.375rem 0.5rem',
        fontSize: '0.6875rem',
        color: 'var(--foreground)',
        cursor: 'pointer',
      }}
      type="button"
    >
      <Icon height={13} icon={running ? 'lucide:pause' : 'lucide:play'} width={13} />
      <span>{running ? 'Stop the fleet' : 'Run the fleet'}</span>
      <span style={{ marginLeft: 'auto', color: 'var(--muted-foreground)' }}>
        {running
          ? fleet.skipped > 0
            ? `${fleet.trucks.length} sürüyor · ${fleet.skipped} tavan yüzünden park`
            : `${fleet.trucks.length} sürüyor`
          : 'shuttle trucks follow their aisles'}
      </span>
    </button>
  )
}

/**
 * What the loaded pallet is carrying.
 *
 * In the catalog beside the tile that places it, not in the inspector, because
 * it describes the pallet you are about to make rather than one you have
 * selected — the same reason the conveyor's flow switch lives here.
 *
 * Absent entirely while the empty pallet is armed. The two are separate tiles,
 * so this is a statement about which one is chosen rather than a panel of
 * controls greying itself out.
 *
 * The fill is offered as three named ranges rather than as a slider. The
 * variants are quantised to begin with, so a continuous control would promise a
 * precision the geometry does not have, and a 256 px rail has no room for a
 * two-handled range anyway.
 */
function LoadBrush() {
  const brush = useWarehouseStore((s) => s.palletBrush)
  const setBrush = useWarehouseStore((s) => s.setPalletBrush)

  const types = [
    { value: 'carton', label: 'Cartons' },
    { value: 'drum', label: 'Drums' },
  ] as const

  const ranges = [
    { label: 'Mixed', range: [0.4, 1] as [number, number], hint: '40–100%' },
    { label: 'Light', range: [0.2, 0.6] as [number, number], hint: '20–60%' },
    { label: 'Full', range: [1, 1] as [number, number], hint: '100%' },
  ]

  const sameRange = (a: readonly [number, number], b: readonly [number, number]) =>
    a[0] === b[0] && a[1] === b[1]

  if (brush.cargo === 'none') return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {types.map((type) => (
          <button
            key={type.value}
            onClick={() => setBrush({ cargo: type.value })}
            style={{ ...listRow(brush.cargo === type.value), justifyContent: 'center' }}
            type="button"
          >
            {type.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {ranges.map((entry) => (
          <button
            key={entry.label}
            onClick={() => setBrush({ fillRange: entry.range })}
            style={{
              ...listRow(sameRange(brush.fillRange, entry.range)),
              justifyContent: 'center',
            }}
            title={entry.hint}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {CARGO_COLOR_IDS.map((id) => (
          <button
            aria-label={id}
            key={id}
            onClick={() => setBrush({ cargoColor: id })}
            style={{
              flex: 1,
              height: '1.125rem',
              borderRadius: '0.25rem',
              border:
                brush.cargoColor === id
                  ? '2px solid var(--sidebar-ring)'
                  : '1px solid var(--sidebar-border)',
              background: CARGO_COLORS[id],
              cursor: 'pointer',
            }}
            title={id}
            type="button"
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {(
          [
            ['wrapped', 'Film'],
            ['strapped', 'Straps'],
            ['labelled', 'Label'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setBrush({ [key]: !brush[key] })}
            style={{ ...listRow(brush[key]), justifyContent: 'center' }}
            type="button"
          >
            <span style={checkbox(brush[key])}>{brush[key] ? '✓' : ''}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * What the warehouse holds.
 *
 * Three figures and two pickers, which is the whole screen. The arithmetic is
 * `../stats`; nothing is derived here beyond formatting, and every subscription
 * returns a scalar or the store's own object so the tab does not re-render on
 * unrelated scene writes.
 */
export function StatsTab() {
  const stats = useScene((s) => sceneStats(s.nodes as Record<string, unknown>))
  const unit = useViewer((s) => s.unit)
  const viewerBuildingId = useViewer((s) => s.selection.buildingId)
  const viewerLevelId = useViewer((s) => s.selection.levelId)

  const scope = useWarehouseStore((s) => s.scope)
  const setScope = useWarehouseStore((s) => s.setScope)
  const statsLevelId = useWarehouseStore((s) => s.statsLevelId)
  const setStatsLevel = useWarehouseStore((s) => s.setStatsLevel)
  const slabFilter = useWarehouseStore((s) => s.slabFilter)
  const toggleSlab = useWarehouseStore((s) => s.toggleSlab)
  const setSlabFilter = useWarehouseStore((s) => s.setSlabFilter)

  const [openList, setOpenList] = useState<'none' | 'level' | 'slab'>('none')

  const resolution = useMemo(
    () =>
      resolveStatsScope(stats, {
        scope,
        buildingId: (viewerBuildingId as string | null) ?? null,
        // The pinned level wins; without one the readout follows the viewer.
        levelId: statsLevelId ?? (viewerLevelId as string | null) ?? null,
      }),
    [stats, scope, viewerBuildingId, statsLevelId, viewerLevelId],
  )

  const report = useMemo(
    () => statsReport(stats, resolution.levelIds, slabFilter),
    [stats, resolution.levelIds, slabFilter],
  )

  const slabIds = useMemo(() => report.slabs.map((slab) => slab.id), [report.slabs])
  const allSlabs = slabFilter === null

  return (
    <div style={tokens.sections}>
      <section style={tokens.section}>
        <div style={tokens.sectionHeader}>
          <Icon height={14} icon="lucide:bar-chart-3" style={tokens.sectionIcon} width={14} />
          <h3 style={tokens.sectionTitle}>
            {resolution.resolved === 'project' ? 'Project statistics' : 'Building statistics'}
          </h3>
        </div>
        <p style={tokens.blurb}>{resolution.label}</p>

        <div style={tokens.figures}>
          <Figure
            icon="lucide:box"
            label="Storage"
            note={storageNote(report)}
            unavailable={report.status.storage === 'unavailable'}
            unit="pallet positions"
            value={report.palletPositions}
          />
          <Figure
            icon="lucide:shopping-cart"
            label="Picking"
            unavailable={report.status.picking === 'unavailable'}
            unit="container positions"
            value={report.containerPositions}
          />
          <Figure
            areaUnit={unit}
            icon="lucide:maximize"
            label="Footprint"
            note={
              allSlabs
                ? undefined
                : `of ${formatArea(report.areaAllSlabs, unit, 0)} across every slab`
            }
            unavailable={report.status.footprint === 'unavailable'}
            value={report.area}
          />
        </div>
        {/* Always true, so it is a blurb rather than a warning: the stored
            outline is the wall centreline, which is also what the host's own
            slab inspector prints -- the comparison a user actually makes. */}
        <p style={tokens.blurb}>Gross to wall centrelines, holes deducted.</p>
      </section>

      <section style={tokens.section}>
        <button
          onClick={() => setOpenList(openList === 'level' ? 'none' : 'level')}
          style={tokens.disclosure}
          type="button"
        >
          <Icon
            height={12}
            icon={openList === 'level' ? 'lucide:chevron-down' : 'lucide:chevron-right'}
            width={12}
          />
          <span>Level</span>
          <span style={tokens.rowArea}>
            {resolution.resolved === 'level' ? resolution.label : 'All in scope'}
          </span>
        </button>
        {openList === 'level' && (
          <div style={tokens.list}>
            <button
              onClick={() => {
                setStatsLevel(null)
                setScope(resolution.buildingId ? 'building' : 'project')
              }}
              style={listRow(resolution.resolved !== 'level')}
              type="button"
            >
              <span style={checkbox(resolution.resolved !== 'level')}>
                {resolution.resolved !== 'level' ? '✓' : ''}
              </span>
              <span>All levels in scope</span>
            </button>
            {resolution.levelChoices.map((choice) => {
              const selected = resolution.levelId === choice.id
              return (
                <button
                  key={choice.id}
                  onClick={() => {
                    setStatsLevel(choice.id)
                    setScope('level')
                  }}
                  style={listRow(selected)}
                  type="button"
                >
                  <span style={checkbox(selected)}>{selected ? '✓' : ''}</span>
                  <span>{choice.label}</span>
                </button>
              )
            })}
          </div>
        )}

        <button
          onClick={() => setOpenList(openList === 'slab' ? 'none' : 'slab')}
          style={tokens.disclosure}
          type="button"
        >
          <Icon
            height={12}
            icon={openList === 'slab' ? 'lucide:chevron-down' : 'lucide:chevron-right'}
            width={12}
          />
          <span>Slabs</span>
          <span style={tokens.rowArea}>
            {allSlabs
              ? `All · ${report.slabs.length}`
              : `${report.countedSlabs} / ${report.slabs.length}`}
          </span>
        </button>
        {openList === 'slab' && (
          <div style={tokens.list}>
            <button
              // `null` means ALL and an empty Set means NONE. Collapsing a full
              // selection back to `null` is what makes a newly drawn slab join
              // the total instead of being silently missing from it.
              onClick={() => setSlabFilter(allSlabs ? new Set<string>() : null)}
              style={listRow(allSlabs)}
              type="button"
            >
              <span style={checkbox(allSlabs)}>{allSlabs ? '✓' : ''}</span>
              <span>All slabs</span>
              <span style={tokens.rowArea}>{formatArea(report.areaAllSlabs, unit, 0)}</span>
            </button>
            {report.slabs.map((slab) => (
              <SlabRow
                checked={allSlabs || slabFilter.has(slab.id)}
                key={slab.id}
                onToggle={() => toggleSlab(slab.id, slabIds)}
                slab={slab}
                unit={unit}
              />
            ))}
          </div>
        )}
      </section>

      {(resolution.widenedNote || report.qualifications.length > 0) && (
        <section style={tokens.section}>
          {resolution.widenedNote && <div style={tokens.advisory}>{resolution.widenedNote}</div>}
          {report.qualifications.map((entry) => (
            <div
              key={entry.code}
              style={entry.severity === 'note' ? tokens.blurb : tokens.advisory}
            >
              {qualificationText(entry, unit)}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function Figure({
  icon,
  label,
  value,
  unit,
  areaUnit,
  note,
  unavailable,
}: {
  icon: string
  label: string
  value: number
  unit?: string
  areaUnit?: 'metric' | 'imperial'
  note?: string
  unavailable: boolean
}) {
  return (
    <>
      <div style={tokens.figureRow}>
        <span style={tokens.figureLabel}>
          <Icon height={12} icon={icon} width={12} />
          {label}
        </span>
        <span style={tokens.figureValue}>
          {unavailable ? '––' : areaUnit ? formatArea(value, areaUnit, 1) : value.toLocaleString()}
          {!unavailable && unit && <span style={tokens.figureUnit}>{unit}</span>}
        </span>
      </div>
      {note && !unavailable && <p style={tokens.figureNote}>{note}</p>}
    </>
  )
}

function SlabRow({
  slab,
  checked,
  onToggle,
  unit,
}: {
  slab: SlabFigure
  checked: boolean
  onToggle: () => void
  unit: 'metric' | 'imperial'
}) {
  if (slab.selfIntersecting) {
    // Withheld rather than disclosed: a crossing outline has no area at all, so
    // there is no number to qualify. It is also not checkable -- ticking it
    // would offer to add nothing to the total.
    return (
      <div style={{ ...listRow(false), cursor: 'default' }}>
        <span style={checkbox(false)} />
        <span>{slab.label}</span>
        <span style={tokens.rowArea}>{'––'}</span>
      </div>
    )
  }
  return (
    <button onClick={onToggle} style={listRow(checked)} type="button">
      <span style={checkbox(checked)}>{checked ? '✓' : ''}</span>
      <span>{slab.label}</span>
      {slab.elevation !== undefined && slab.elevation !== 0 && (
        /* Kot da çevriliyor. Aynı satırın alanı `formatArea` ile çevriliyordu
           ama kot ham metre yazıyordu: Imperial'a geçen kullanıcı tek bir
           satırda bir sayıyı feet, yanındakini metre okuyordu. */
        <span style={tokens.figureUnit}>{`+${lengthLabel(slab.elevation, unit)}`}</span>
      )}
      <span style={tokens.rowArea}>{formatArea(slab.area, unit, 0)}</span>
    </button>
  )
}

/**
 * The two things worth saying about a storage figure beyond its total.
 *
 * Occupancy first, because that is the question a warehouse designer is actually
 * asking — and it is reportable at all only because the placement chain writes a
 * slot address down. Nothing here infers it from where a pallet happens to sit.
 * Reach second, and only when a bay is deep enough for the two to differ.
 */
function storageNote(report: StatsReport): string | undefined {
  const parts: string[] = []
  if (report.palletPositions > 0) {
    const share = Math.round((report.occupiedPositions / report.palletPositions) * 100)
    parts.push(`${report.occupiedPositions.toLocaleString()} occupied · ${share}%`)
  }
  if (report.directPositions !== report.palletPositions) {
    parts.push(`${report.directPositions.toLocaleString()} reachable without moving another`)
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * Alan biçimlendirmesi host'un çevirisine devredildi.
 *
 * Burada `SQUARE_FEET_PER_SQUARE_METRE = 10.7639` yazıyordu. Host aynı sayıyı
 * `1 / 0.3048`ten türetiyor (`measurements.ts`), yani ikisi altıncı anlamlı
 * basamakta ayrılıyordu: aynı ekranda, aynı slab için, host'un panelinin
 * yazdığından farklı bir alan. Sayının kendisi görünür biçimde yanlış değildi —
 * sessizce farklıydı, ki fark edilmesi daha zor olanı budur.
 */
function formatArea(area: number, unit: LinearUnit, digits: number): string {
  return areaLabel(area, unit, digits)
}

function qualificationText(entry: Qualification, unit: 'metric' | 'imperial'): string {
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`
  switch (entry.code) {
    case 'racks-unreadable':
      return `${plural(entry.count, 'rack', 'racks')} could not be read — host schema changed, or the scene was hand-edited. They count as nothing.`
    case 'slabs-unreadable':
      return `${plural(entry.count, 'slab', 'slabs')} could not be read and are excluded from the area.`
    case 'slab-self-intersecting':
      return `${plural(entry.count, 'slab outline crosses', 'slab outlines cross')} itself. An area cannot be computed for it, so it is left out entirely.`
    case 'elevation-bands':
      return `Slabs sit at ${entry.count} different heights — ${formatArea(entry.amount ?? 0, unit, 0)} of this is a deck above the lowest floor, counted on top of it. Untick it above to see one floor alone.`
    case 'tunnelled-bay':
      return `${plural(entry.count, 'bay has', 'bays have')} a tunnel through the bottom, which removes ${plural(entry.amount ?? 0, 'pallet position', 'pallet positions')}.`
    case 'ghost-fill':
      return `${plural(entry.count, 'bay shows', 'bays show')} ghost stock. Those pallets are scenery and are not counted.`
    case 'floor-pallets':
      return `${plural(entry.count, 'pallet is', 'pallets are')} placed as goods. Goods are not locations, so they change no figure here.`
    case 'hidden-nodes':
      return `${plural(entry.count, 'hidden node is', 'hidden nodes are')} still counted — hiding is a view setting, not a change to the warehouse.`
    case 'nodes-outside-levels':
      return `${plural(entry.count, 'object sits', 'objects sit')} under no level and is counted nowhere.`
  }
}
