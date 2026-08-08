import { useScene } from '@pascal-app/core'
import { create } from 'zustand'
import type { BenchNode } from './bench/schema'
import type { ConveyorTelescopicNode } from './conveyor/telescopic-schema'
import type { DockLevellerNode } from './dockleveller/schema'
import type { DriveInRackNode } from './drivein/schema'
import type { LiveRackingNode } from './live-racking/schema'
import type { LongspanLevel, LongspanNode } from './longspan/schema'
import type { M3Level, M3ShelvingNode } from './m3/schema'
import { emptyAccessories, type MezzanineNode } from './mezzanine/schema'
import { CARGO_TYPES } from './pallet/cargo-types'
import type { PalletNode } from './pallet/schema'
import { DEFAULT_MULTIPLY, type MultiplySpec } from './rack/multiply'
import type { PalletRackNode } from './rack/schema'
import { defaultWidthM } from './route/metrics'
import type { RouteNode } from './route/schema'
import type { ToteCartNode } from './totecart/schema'
import type { TruckNode } from './truck/schema'

/**
 * The plugin's own state. Plugins do not extend `useScene` / `useEditor` /
 * `useViewer`; they keep a module-level store of their own, which is what the
 * plugin-authoring contract prescribes and what the reference plugin does.
 *
 * It holds view state and the placement "brush" — what the next placed item
 * looks like. The panel writes it, the tools read it. Node data lives on the
 * nodes; nothing here is persisted, and losing it on reload costs one click.
 *
 * It deliberately lives outside the panel component: the panel unmounts
 * whenever the user switches rail tabs, and a scope selection that reset every
 * time you glanced at the outliner would be worse than useless.
 */

export type PanelTab = 'catalog' | 'stats'

/** What the statistics readout counts. One selector drives every metric —
 * the fork this replaces scoped its pallet counts to the whole building and
 * its area figure to a single level, in the same card. */
export type StatsScope = 'project' | 'building' | 'level'

type WarehouseStore = {
  tab: PanelTab
  setTab: (tab: PanelTab) => void

  scope: StatsScope
  setScope: (scope: StatsScope) => void

  /**
   * Slab ids the area figures are restricted to, or `null` for "every slab in
   * scope". A distinct flag rather than an empty set doing double duty: the
   * fork overloaded `null` to mean both "all" and "none", and the two are not
   * the same answer.
   */
  slabFilter: ReadonlySet<string> | null
  setSlabFilter: (ids: ReadonlySet<string> | null) => void
  toggleSlab: (id: string, allIds: readonly string[]) => void

  /**
   * Level the readout is pinned to, or `null` to follow the viewer's own.
   *
   * Held as an id rather than an index into the level list: levels are sorted by
   * an ordinal the host types as a plain number — fractional and negative are
   * both legal — so an index would quietly shift the selection onto a different
   * storey the moment a level was added, renamed or renumbered.
   */
  statsLevelId: string | null
  setStatsLevel: (id: string | null) => void

  /**
   * Whether the conveyor flow simulation is running.
   *
   * Off by default: a layout tool that animates the moment it opens is a layout
   * tool nobody can read. It lives here rather than in `useViewer` because a
   * plugin does not extend the host's stores — and it is scene-wide rather than
   * per-node, because a line is not a node either.
   */
  flowRunning: boolean
  setFlowRunning: (running: boolean) => void

  /**
   * Whether the truck fleet is driving. Off by default, `flowRunning`'in
   * gerekçesiyle: açılışta kendiliğinden hareket eden bir yerleşim aracı
   * okunamaz. Sahne-genel, çünkü filo da düğüm değil.
   */
  fleetRunning: boolean
  setFleetRunning: (running: boolean) => void

  /**
   * Kolektif instancing açık mı — VARSAYILAN AÇIK.
   *
   * Ölçüldü: 5300 düğümlük gerçekçi bir sahnede ~10.300 çizim çağrısı ~11'e
   * iniyor. Kapatılabilir olması bir tercih değil, bu değişikliğin render
   * yolunun en kritik parçasına dokunmasının gereği: bozulursa kullanıcı tek
   * düğmeyle eski davranışa döner ve iki hâli yan yana ölçebilir.
   */
  instancingEnabled: boolean
  setInstancingEnabled: (enabled: boolean) => void

  /**
   * Detay mesafesi — LOD bantlarının çarpanı.
   *
   * Raf 70/55 m, palet 25/18 m gibi bantlar sabitti ve tümleşik GPU'da geniş
   * kalıyordu: uzak katmana daha erken düşmek çizim maliyetini doğrudan kısar,
   * güçlü makinede ise bandı genişletmek detayı uzağa taşır. Kol üç konumlu;
   * histerezis mimarisi değişmiyor, yalnız eşikler ölçekleniyor.
   */
  lodQuality: LodQuality
  setLodQuality: (quality: LodQuality) => void

  /**
   * Gölge kısıcı — VARSAYILAN AÇIK, `instancingEnabled` gerekçesiyle.
   *
   * Gölge geçidi ölçülmüş en büyük kalemdi (eski tabanda ~29 ms/kare) ve
   * sahne karelerin çoğunda durağan. Kısıcı haritayı talep üzerine +
   * 4 karelik kalp atışıyla tazeliyor (`instancing/shadow-throttle.ts`).
   * Kapatınca ışıklar three'nin kendi temposuna geri verilir — iki hâl
   * yan yana ölçülebilir.
   */
  shadowThrottleEnabled: boolean
  setShadowThrottleEnabled: (enabled: boolean) => void

  /**
   * Uzak gölge kısma — 85 m ötesindeki örnekler gölgesiz havuza taşınır
   * (`collective.ts`: bayrak havuz anahtarında, canlı mesh'te asla
   * çevrilmez). VARSAYILAN AÇIK, kullanıcı kararı; kapatınca bayraklar
   * ≤8 karede temizlenir ve her örnek yeniden gölgeli havuzda.
   */
  farShadowCullEnabled: boolean
  setFarShadowCullEnabled: (enabled: boolean) => void

  // ── Placement brush ────────────────────────────────────────────────────
  /**
   * Shape of the next placed pallet, held as a partial node for the same reason
   * the rack's is: the tool parses it straight through `PalletNode.parse`, so
   * anything absent takes the schema's own default and there is no second set of
   * defaults to keep in step.
   */
  palletBrush: PalletBrush
  setPalletBrush: (patch: Partial<PalletBrush>) => void

  /**
   * Shape of the next drawn route.
   *
   * Changing the role or the truck class re-derives the width, because a route
   * whose width did not follow its class would silently keep a forklift aisle's
   * 3.2 m after being switched to a walkway — a number that was right once and
   * is now just a leftover.
   */
  routeBrush: RouteBrush
  setRouteBrush: (patch: Partial<RouteBrush>) => void

  /**
   * Shape of the next placed rack.
   *
   * Held as a partial node rather than a handful of loose fields: a rack has
   * enough dimensions that mirroring each one here would be a second schema to
   * keep in step, and the tool parses this straight through
   * `PalletRackNode.parse` so anything missing takes the schema's own default.
   */
  rackBrush: RackBrush
  setRackBrush: (patch: Partial<RackBrush>) => void

  /**
   * What the **Multiply** button in the rack panel will lay down.
   *
   * Not schema fields, and deliberately: a bay is a node, so a bay count that
   * lived on the node would be a number that silently reshapes one object into
   * twenty — which is exactly the model this kind was rebuilt to get away from.
   * It is a command's arguments, so it lives with the other panel state.
   *
   * Outside the panel component because the panel unmounts whenever the user
   * switches rail tabs or reselects, and a count that reset every time you
   * glanced away would be worse than useless.
   */
  multiply: MultiplySpec
  setMultiply: (patch: Partial<MultiplySpec>) => void

  /**
   * Shape of the next placed truck. `model` yamanınca `mastRowId` sıfırlanır —
   * `setRouteBrush`'ın "genişlik sınıfı takip eder" kuralının aynısı: eski
   * satır yeni modelin tablosu olmayabilir ve sessizce taşınmış bir mast,
   * yanlış boyda çizilmiş bir makinedir.
   */
  truckBrush: TruckBrush
  setTruckBrush: (patch: Partial<TruckBrush>) => void

  /**
   * Shape of the next placed telescopic conveyor. `extension` fırçada durur
   * çünkü `[`/`]` ile yerleştirme SIRASINDA ayarlanıyor ve bir sonraki
   * makinenin aynı açıklıkta başlaması beklenen davranış — rampanın önüne
   * arka arkaya iki bom koyan kullanıcı ikisini de aynı boyda ister.
   */
  telescopicBrush: TelescopicBrush
  setTelescopicBrush: (patch: Partial<TelescopicBrush>) => void

  /**
   * Shape of the next placed mezzanine. `grid`/`tiers` fırçada duruyor —
   * katalog fişleri (1 katlı SIGMA / 2 katlı GL2000) farklı `tiers.length`
   * taşır, `rackBrush`'ın kendi ölçülerini taşıması gibi.
   */
  mezzanineBrush: MezzanineBrush
  setMezzanineBrush: (patch: Partial<MezzanineBrush>) => void

  /**
   * Yerleştirmenin hedeflediği mezzanine güvertesi — `null` ise zemin.
   *
   * **Neden açık bir seçim:** host'un imleç-yüzey seçimi ışının kestiği EN
   * YAKIN slab düzlemini alıyor (`getPointedSupportSurface`, en küçük
   * pozitif t). Yukarıdan bakan bir kamerada bu HER ZAMAN en üstteki
   * güverte — üst üste duran mezzanine katlarında alt kata nişan almak
   * fiziksel olarak mümkün değil. Kat bu yüzden nişan alarak değil açıkça
   * seçiliyor; `electSupportSlab` seçimi okuyor ve 11 yerleştirme aracının
   * hepsi tek noktadan düzeliyor.
   */
  activeDeck: { mezzanineId: string; tierIndex: number } | null
  setActiveDeck: (deck: { mezzanineId: string; tierIndex: number } | null) => void

  /**
   * Shape of the next placed live-racking channel. `palletsDeep` fırçada
   * durur çünkü `[`/`]` ile yerleştirme SIRASINDA ayarlanıyor ve arka arkaya
   * iki kanal koyan kullanıcı ikisini de aynı derinlikte ister.
   */
  liveRackingBrush: LiveRackingBrush
  setLiveRackingBrush: (patch: Partial<LiveRackingBrush>) => void

  benchBrush: BenchBrush
  setBenchBrush: (patch: Partial<BenchBrush>) => void

  dockLevellerBrush: DockLevellerBrush
  setDockLevellerBrush: (patch: Partial<DockLevellerBrush>) => void

  toteCartBrush: ToteCartBrush
  setToteCartBrush: (patch: Partial<ToteCartBrush>) => void

  driveInBrush: DriveInBrush
  setDriveInBrush: (patch: Partial<DriveInBrush>) => void

  longspanBrush: LongspanBrush
  setLongspanBrush: (patch: Partial<LongspanBrush>) => void

  m3Brush: M3Brush
  setM3Brush: (patch: Partial<M3Brush>) => void
}

export type PalletBrush = Pick<
  PalletNode,
  'preset' | 'cargo' | 'fillRange' | 'wrapped' | 'strapped' | 'labelled' | 'cargoColor'
>

export type RouteBrush = Pick<
  RouteNode,
  'role' | 'traffic' | 'width' | 'lineWidth' | 'requiredFor' | 'datum'
>

export type TruckBrush = Pick<TruckNode, 'model' | 'mastRowId' | 'referenceLoad' | 'duty'>

export type TelescopicBrush = Pick<ConveyorTelescopicNode, 'model' | 'beltWidth' | 'extension'>

/**
 * Tezgâh yerleştirme fırçası.
 *
 * Varyantla birlikte ÜÇ ölçü de fırçada: ölçüler ayarlanabilir olduğu için
 * arka arkaya beş masa koyan kullanıcı beşini de aynı ölçüde ister, ve
 * varyanta geri dönmek bir alanı temizlemek kadar kolay.
 */
export type BenchBrush = Pick<BenchNode, 'variant' | 'width' | 'height' | 'depth'>

/**
 * Rampa fırçası — `inclination` YOK ve olmaması bilinçli.
 *
 * Fırça "bir sonraki nesne neye benzeyecek" demek, ve rampa her zaman
 * dinlenmede konuyor: kalkmış bir tabla yerleştirilecek izi olduğundan büyük
 * gösterir, ve kullanıcı çukuru koyuyor, makineyi çalıştırmıyor. Eğim
 * yerleştirmeden SONRA panelden ayarlanan bir poz.
 */
/** Araba fırçası — `loadedTiers` YOK: yeni araba dolu konur, kısmen
 *  toplanmış hâli yerleştirmeden SONRA panelden ayarlanan bir durum. */
export type ToteCartBrush = Pick<
  ToteCartNode,
  'toteFootprint' | 'toteHeight' | 'tiers' | 'castorDiameter' | 'tilt' | 'hasHandle'
>

export type DockLevellerBrush = Pick<
  DockLevellerNode,
  'width' | 'length' | 'lip' | 'lipLength' | 'capacity' | 'frameHeight'
>

export type LiveRackingBrush = Pick<
  LiveRackingNode,
  'variant' | 'palletPreset' | 'palletsDeep' | 'levels' | 'withRetainers'
>

/**
 * Drive-in yerleştirme fırçası.
 *
 * Derinlik burada duruyor çünkü köşeli parantez tuşlarıyla yerleştirme
 * SIRASINDA ayarlanıyor ve arka arkaya iki şerit koyan kullanıcı ikisini de
 * aynı derinlikte ister — canlı rafın kanal derinliğiyle aynı gerekçe.
 */
export type DriveInBrush = Pick<
  DriveInRackNode,
  'laneClearWidth' | 'palletsDeep' | 'levels' | 'railType' | 'entryMode' | 'palletPreset'
>

/**
 * M7 Longspan yerleştirme fırçası.
 *
 * Kat SAYISI burada, kat listesi değil: yerleştirme sırasında ayarlanan tek
 * ölçü odur ve araç listeyi çerçeve yüksekliğine göre kendisi yayıyor. Listeyi
 * fırçaya koymak, katalog fişinin dört katlı bir düzeni sabitlemesi demekti.
 */
export type LongspanBrush = {
  bayLength: LongspanNode['bayLength']
  frameDepth: LongspanNode['frameDepth']
  frameHeight: LongspanNode['frameHeight']
  levelCount: number
  structure: LongspanLevel['structure']
  shelfKind: LongspanLevel['shelfKind']
}

/**
 * M3 yerleştirme fırçası.
 *
 * M7'yle aynı gerekçe: kat SAYISI burada, kat listesi değil — yerleştirme
 * sırasında `[`/`]` ile ayarlanan tek ölçü odur ve araç listeyi çerçeve
 * yüksekliğine göre 25 mm ızgarasına kendisi yayıyor.
 *
 * `frameVariant` ve `backPanel` fırçada duruyor çünkü katalog fişleri bunlarla
 * ayrışıyor: ofis dolabı arka panelli, atölye rafı çıplak çerçeve. İkisi de
 * yerleştirmeden ÖNCE seçilen şeyler.
 */
export type M3Brush = {
  shelfLength: M3ShelvingNode['shelfLength']
  shelfDepth: M3ShelvingNode['shelfDepth']
  frameHeight: M3ShelvingNode['frameHeight']
  frameVariant: M3ShelvingNode['frameVariant']
  backPanel: M3ShelvingNode['backPanel']
  door: M3ShelvingNode['door']
  levelCount: number
  structure: M3Level['structure']
  model: M3Level['model']
}

export type MezzanineBrush = Pick<
  MezzanineNode,
  'constructiveSystem' | 'grid' | 'columnType' | 'tiers'
>

export type RackBrush = Pick<
  PalletRackNode,
  | 'bayClearWidth'
  | 'depth'
  | 'uprightHeight'
  | 'levels'
  | 'palletPreset'
  | 'palletOrientation'
  | 'pickingLevels'
  | 'ghostFill'
>

export const useWarehouseStore = create<WarehouseStore>((set, get) => ({
  tab: 'catalog',
  setTab: (tab) => set({ tab }),

  scope: 'building',
  setScope: (scope) => set({ scope, slabFilter: null }),

  // Slab ids belong to a level, so changing the level clears the filter for the
  // same reason changing the scope does.
  statsLevelId: null,
  setStatsLevel: (statsLevelId) => set({ statsLevelId, slabFilter: null }),

  slabFilter: null,
  setSlabFilter: (slabFilter) => set({ slabFilter }),
  toggleSlab: (id, allIds) => {
    const current = get().slabFilter
    const next = new Set(current ?? allIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    // Collapse "everything selected" back to the null sentinel so newly drawn
    // slabs are included by default instead of silently missing from the total.
    set({ slabFilter: next.size === allIds.length ? null : next })
  },

  flowRunning: false,
  setFlowRunning: (flowRunning) => set({ flowRunning }),

  fleetRunning: false,
  setFleetRunning: (fleetRunning) => set({ fleetRunning }),

  instancingEnabled: true,
  setInstancingEnabled: (instancingEnabled) => set({ instancingEnabled }),

  lodQuality: 'balanced',
  setLodQuality: (lodQuality) => set({ lodQuality }),

  shadowThrottleEnabled: true,
  setShadowThrottleEnabled: (shadowThrottleEnabled) => set({ shadowThrottleEnabled }),

  farShadowCullEnabled: true,
  setFarShadowCullEnabled: (farShadowCullEnabled) => set({ farShadowCullEnabled }),

  palletBrush: {
    preset: 'epal-1',
    cargo: 'none',
    fillRange: [0.4, 1],
    wrapped: true,
    strapped: true,
    labelled: true,
    cargoColor: 'kraft',
  },
  setPalletBrush: (patch) =>
    set((state) => {
      const next = { ...state.palletBrush, ...patch }
      // Choosing a cargo type brings that type's own practice with it: cartons
      // are filmed and drums are not. The flags are still the user's to change
      // afterwards — this only decides what they start as, which is the one
      // reader `CargoType.defaults` was declared for.
      if (patch.cargo && patch.cargo !== 'none' && patch.cargo !== state.palletBrush.cargo) {
        const defaults = CARGO_TYPES[patch.cargo].defaults
        next.wrapped = patch.wrapped ?? defaults.wrap
        next.strapped = patch.strapped ?? defaults.strapping
        next.labelled = patch.labelled ?? defaults.label
      }
      return { palletBrush: next }
    }),

  routeBrush: {
    role: 'pedestrian',
    traffic: 'two-way',
    width: defaultWidthM('pedestrian', null),
    lineWidth: 'standard',
    requiredFor: null,
    datum: 'load-face',
  },
  setRouteBrush: (patch) =>
    set((state) => {
      const next = { ...state.routeBrush, ...patch }
      // The width follows the class unless the user is setting it directly.
      if (
        patch.width === undefined &&
        (patch.role !== undefined || patch.requiredFor !== undefined)
      ) {
        next.width = defaultWidthM(next.role, next.requiredFor)
      }
      return { routeBrush: next }
    }),

  rackBrush: {
    bayClearWidth: 2.7,
    depth: 1.1,
    uprightHeight: 5,
    levels: 3,
    palletPreset: 'epal-1',
    palletOrientation: 'short-side-out',
    pickingLevels: 0,
    ghostFill: 0,
  },
  setRackBrush: (patch) => set((state) => ({ rackBrush: { ...state.rackBrush, ...patch } })),

  multiply: DEFAULT_MULTIPLY,
  setMultiply: (patch) => set((state) => ({ multiply: { ...state.multiply, ...patch } })),

  truckBrush: {
    model: 'forklift-1300',
    mastRowId: null,
    referenceLoad: '1000x1200',
    duty: 'parked',
  },
  setTruckBrush: (patch) =>
    set((state) => {
      const next = { ...state.truckBrush, ...patch }
      if (patch.model !== undefined && patch.model !== state.truckBrush.model) {
        next.mastRowId = patch.mastRowId ?? null
      }
      return { truckBrush: next }
    }),

  telescopicBrush: {
    model: 'a4-6+12',
    beltWidth: '800',
    extension: 0,
  },
  setTelescopicBrush: (patch) =>
    set((state) => ({ telescopicBrush: { ...state.telescopicBrush, ...patch } })),

  activeDeck: null,
  setActiveDeck: (activeDeck) => {
    /**
     * İlgili mezzanine'ler kirletiliyor ki 2D plan yeniden çizilsin: plan
     * seçili katı gösteriyor (`buildMezzanineFloorplan` `activeDeck` okuyor)
     * ama yalnız düğüm kirlenince yeniden kuruluyor — store değişimi tek
     * başına onu tetiklemez. Eski VE yeni hedefin sahibi ayrı düğümlerse
     * ikisi de tazelenmeli.
     */
    const previous = get().activeDeck
    set({ activeDeck })
    const scene = useScene.getState()
    for (const id of new Set(
      [previous?.mezzanineId, activeDeck?.mezzanineId].filter((v): v is string => !!v),
    )) {
      scene.markDirty(id as never)
    }
  },

  mezzanineBrush: {
    constructiveSystem: 'SIGMA',
    grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
    columnType: 'single',
    tiers: [
      {
        index: 0,
        elevationM: 'auto',
        clearHeightM: 3,
        loadClass: 500,
        floorType: 'WOOD_CHIPBOARD_30',
        accessories: emptyAccessories(),
      },
    ],
  },
  setMezzanineBrush: (patch) =>
    set((state) => ({ mezzanineBrush: { ...state.mezzanineBrush, ...patch } })),

  liveRackingBrush: {
    variant: 'FIFO',
    palletPreset: 'epal-1',
    palletsDeep: 8,
    levels: 4,
    withRetainers: false,
  },
  setLiveRackingBrush: (patch) =>
    set((state) => ({ liveRackingBrush: { ...state.liveRackingBrush, ...patch } })),

  // Ölçüler BOŞ başlıyor: varyant seçmek zarfı da seçiyor demek. Buraya sayı
  // yazmak, altı varyanttan beşini ilk yerleştirmede yanlış ölçüde koyardı.
  benchBrush: { variant: 'processing' },
  setBenchBrush: (patch) => set((state) => ({ benchBrush: { ...state.benchBrush, ...patch } })),

  // Kataloğun en yaygın satırı: 2500 × 2000 mm, menteşeli dudak (Armo,
  // "ready in stock"). Yerleştirme her zaman DİNLENMEDE — kullanıcı çukuru
  // koyuyor, rampayı çalıştırmıyor.
  dockLevellerBrush: {
    width: '2000',
    length: '2500',
    lip: 'hinged',
    lipLength: '400',
    capacity: '60',
    frameHeight: '585',
  },
  setDockLevellerBrush: (patch) =>
    set((state) => ({ dockLevellerBrush: { ...state.dockLevellerBrush, ...patch } })),

  // Kullanıcının kendi spec'inin arabası: 5 kat x 220 mm kasa, ki toplam
  // yükseklik onun yayımladigi 1,5 m'ye çıksın.
  toteCartBrush: {
    toteFootprint: '600x400',
    toteHeight: '220',
    tiers: 5,
    castorDiameter: '100',
    tilt: false,
    hasHandle: true,
  },
  setToteCartBrush: (patch) =>
    set((state) => ({ toteCartBrush: { ...state.toteCartBrush, ...patch } })),

  driveInBrush: {
    laneClearWidth: 1.35,
    palletsDeep: 4,
    levels: 3,
    railType: 'gp',
    entryMode: 'drive-in',
    palletPreset: 'epal-1',
  },
  setDriveInBrush: (patch) =>
    set((state) => ({ driveInBrush: { ...state.driveInBrush, ...patch } })),

  longspanBrush: {
    bayLength: 1.9,
    frameDepth: 0.6,
    frameHeight: 2.5,
    levelCount: 4,
    structure: 'beam-shelf',
    shelfKind: 'chipboard',
  },
  setLongspanBrush: (patch) =>
    set((state) => ({ longspanBrush: { ...state.longspanBrush, ...patch } })),

  m3Brush: {
    shelfLength: 1,
    shelfDepth: 0.4,
    frameHeight: 2,
    frameVariant: 'basic',
    backPanel: 'none',
    door: 'none',
    levelCount: 4,
    structure: 'shelf',
    model: 'HL',
  },
  setM3Brush: (patch) => set((state) => ({ m3Brush: { ...state.m3Brush, ...patch } })),
}))

/** Detay mesafesi kolunun üç konumu. */
export type LodQuality = 'near' | 'balanced' | 'wide'

/**
 * SEÇİLMİŞ varsayılanlar, ölçüm değil: 'near' bantları %60'a çeker (raf
 * 70 m → 42 m), 'wide' %150'ye. İki uç da histerezis oranını korur; doğru
 * değerler gerçek sahnede ölçülerek ayarlanmalı.
 */
const LOD_QUALITY_SCALE: Record<LodQuality, number> = { near: 0.6, balanced: 1, wide: 1.5 }

/**
 * Mesafe KARESİ ölçeği — bantlar squared karşılaştırıldığı için k².
 * Kare döngülerinden `getState` ile okunur; abonelik gerektirmez.
 */
export function lodScaleSq(): number {
  const k = LOD_QUALITY_SCALE[useWarehouseStore.getState().lodQuality]
  return k * k
}
