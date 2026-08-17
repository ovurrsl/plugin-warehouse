/**
 * The catalog the panel browses: which node kinds exist, how they group, and
 * what each one is for.
 *
 * Kept as plain data separate from the node definitions so the panel can render
 * the full catalog — including sections whose kinds have not landed yet —
 * without importing any renderer or geometry module. Adding a kind means adding
 * its definition to the manifest and one entry here.
 *
 * All dimensions quoted in descriptions are metres, matching the host's
 * convention. Published warehouse specs are millimetres; divide by 1000.
 */

export type CatalogSection = {
  id: string
  label: string
  /** Iconify name, rendered by the panel. */
  icon: string
  blurb: string
}

export type CatalogItem = {
  /** Distinguishes two tiles that arm the same kind. */
  id: string
  /** Node kind to arm for placement. Must match a registered `NodeDefinition.kind`. */
  kind: string
  label: string
  sectionId: string
  description: string
  icon: string
  /**
   * Applied to the pallet brush before the tool is armed.
   *
   * An empty pallet and a loaded one are the same node kind wearing a different
   * `cargo`, but they are two different things to place and a user picks between
   * them before anything else. One tile that silently remembered whichever it
   * was last would make the catalog lie about what the next click puts down.
   */
  brush?:
    | { kind: 'pallet'; cargo: 'none' | 'carton' | 'drum' }
    | { kind: 'route'; role: 'pedestrian' | 'vehicle'; traffic: 'one-way' | 'two-way' }
    | { kind: 'truck'; model: string }
    /**
     * Rafın iki fişi. `variant` DAHİL, ve dahil olması bu turdaki hatanın
     * kendisi: "Pallet Rack" fişinin hiç fırçası yoktu, dolayısıyla alçak
     * raftan sonra basılan palet rafı onun 2.5 m dikmesini ve toplama gözünü
     * giyerek geliyordu. Fırça yapışkan (bkz. `store.ts`, `setRackBrush`), o
     * yüzden bir alanı ailenin fişlerinden yalnız biri yazarsa o alan hangi
     * fişe basıldığına değil en son hangisine basıldığına bağlanır.
     */
    | {
        kind: 'rack'
        patch: {
          variant: 'pallet-rack' | 'low-rack'
          uprightHeight: number
          levels: number
          pickingLevels: number
        }
      }
    | { kind: 'telescopic'; model: string }
    // Sarmalın iki fişi (karton / palet). İkisi de AYNI alan kümesini
    // ({loadClass, outerDiameter, beltWidth}) yazmalı — fırça-yapışkanlık
    // kuralı (`catalog.test.ts`). Literal tipler satır içi, şema import'u yok.
    | {
        kind: 'conveyor-spiral'
        patch: {
          loadClass: 'light' | 'pallet'
          outerDiameter: '1200' | '1500' | '1800' | '2400'
          beltWidth: '400' | '500' | '650' | '800'
        }
      }
    | {
        kind: 'totecart'
        patch: { tiers: number; toteHeight: '170' | '220' | '320'; tilt: boolean }
      }
    | {
        kind: 'dockleveller'
        patch: { length: '2500' | '3000' | '3500'; lip: 'hinged' | 'telescopic' }
      }
    | {
        kind: 'bench'
        patch: {
          variant:
            | 'dispatch-packing'
            | 'mail-order-packing'
            | 'processing'
            | 'weighing-scale'
            | 'mobile-workbench'
            | 'eco'
        }
      }
    | {
        kind: 'longspan'
        patch: {
          bayLength: number
          frameDepth: number
          frameHeight: number
          levelCount: number
          structure: 'beam-shelf' | 'reinforced-hm' | 'beam-only' | 'hanging'
          shelfKind: 'chipboard' | 'mesh' | 'galvanised-picking' | 'hm'
        }
      }
    | {
        kind: 'm3'
        patch: {
          shelfLength: number
          shelfDepth: number
          frameHeight: number
          frameVariant: 'basic' | 'diagonals' | 'central-panel' | 'side-panel' | 'mesh'
          backPanel: 'none' | 'metal' | 'mesh'
          door: 'none' | 'h1000' | 'h2000'
          levelCount: number
          structure: 'shelf' | 'drawers'
          model: 'HL' | 'HM'
        }
      }
    | {
        kind: 'drive-in'
        patch: {
          laneClearWidth: number
          palletsDeep: number
          levels: number
          railType: 'gp' | 'c'
          entryMode: 'drive-in' | 'drive-through'
        }
      }
    | {
        kind: 'live-racking'
        patch: {
          variant: 'FIFO' | 'LIFO'
          palletsDeep: number
          levels: number
          withRetainers: boolean
        }
      }
    // Inlined rather than importing `MezzanineBrush` from the store — the
    // same reason `rack`'s patch shape above is inlined rather than
    // `RackBrush`: this file stays free of any node-schema import.
    | {
        kind: 'mezzanine'
        patch: {
          constructiveSystem: 'SIGMA' | 'GL2000' | 'MIXED'
          columnType: 'single' | 'double'
          grid: { baysX: number; baysY: number; bayWidthM: number; bayDepthM: number }
          tiers: Array<{
            index: number
            elevationM: 'auto' | number
            clearHeightM: number
            loadClass: 250 | 350 | 500 | 750 | 1000
            floorType: string
            /**
             * Fişin sevk ettiği aksesuarlar. Bu dosya düğüm şemasını
             * IMPORT ETMİYOR (yukarıdaki rack fırçasının gerekçesiyle
             * aynı), o yüzden şekil burada tekrar yazılıyor — dar tutuldu,
             * yalnız fişlerin gerçekten kullandığı alanlar.
             */
            accessories?: {
              staircases: Array<{
                id: string
                placement: {
                  mode: 'edge'
                  edge: 'north' | 'south' | 'east' | 'west'
                  offsetM: number
                }
                widthM: 0.8 | 1
                landing: 'continuous' | 'turn90' | 'turn180'
                railings: 1 | 2
                steps: 'auto' | number
              }>
              swingGates: Array<{
                edge: 'north' | 'south' | 'east' | 'west'
                offsetM: number
                widthM: 0.75 | 1.5
              }>
              upAndOverGates: Array<{
                edge: 'north' | 'south' | 'east' | 'west'
                offsetM: number
                widthM: number
              }>
              safetyZones: Array<{
                edge: 'north' | 'south' | 'east' | 'west'
                offsetM: number
                widthM: number
              }>
            }
          }>
        }
      }
}

export const CATALOG_SECTIONS: readonly CatalogSection[] = [
  {
    id: 'unit-loads',
    label: 'Unit loads',
    icon: 'lucide:package',
    blurb: 'Pallets and containers — the footprint every other dimension follows from.',
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: 'lucide:layout-grid',
    blurb: 'Pallet racking and shelving. The source of every capacity figure.',
  },
  {
    id: 'handling',
    label: 'Handling',
    icon: 'lucide:forklift',
    blurb: 'Trucks and carts. Each variant carries the aisle width it needs.',
  },
  {
    id: 'conveyance',
    label: 'Conveyance',
    icon: 'lucide:move-right',
    blurb: 'Conveyors and sortation.',
  },
  /**
   * `stations` bir kez KALDIRILMIŞTI: fişi olmayan bir bölüm, her açılışta
   * başlığını ve "Nothing here yet." kutusunu çiziyor ve var olmayan bir
   * yetenek ilan ediyordu. Kural o zaman yazıldı — bir bölüm ancak içine
   * konacak bir kind'la birlikte gelir — ve `catalog.test.ts` onu kilitledi.
   *
   * Şimdi geri geliyor çünkü kuralı karşılıyor: altı tezgâh fişiyle birlikte.
   */
  {
    id: 'stations',
    label: 'Work stations',
    icon: 'lucide:table',
    blurb: 'Packing, dispatch and processing benches. Every dimension adjustable.',
  },
  /**
   * Kural gereği kind'ıyla BİRLİKTE geliyor (bkz. `stations`): boş bir bölüm
   * var olmayan bir yetenek ilan ediyor. İki fişi de yükleme rampası arıyor
   * — biri menteşeli, biri teleskopik dudak.
   */
  {
    id: 'docks',
    label: 'Loading bay',
    icon: 'lucide:import',
    blurb: 'Door equipment: dock levellers, flush with the floor at rest.',
  },
  {
    id: 'mezzanine',
    label: 'Mezzanine',
    icon: 'lucide:layers-3',
    blurb: 'Multi-tier structural steel platforms — Sigma, GL2000, or Mixed construction.',
  },
  {
    id: 'layout',
    label: 'Layout',
    icon: 'lucide:route',
    blurb: 'Floor markings and aisles.',
  },
] as const

/**
 * Populated one phase at a time. An entry here without a matching registered
 * kind would arm a tool that cannot place anything, so entries land in the same
 * change as their `NodeDefinition`.
 */
export const CATALOG_ITEMS: readonly CatalogItem[] = [
  {
    id: 'pallet-empty',
    kind: 'warehouse:pallet',
    label: 'Empty Pallet',
    sectionId: 'unit-loads',
    description: 'A bare deck. EPAL, GMA and plastic standards.',
    icon: 'lucide:package',
    brush: { kind: 'pallet', cargo: 'none' },
  },
  {
    id: 'pallet-loaded',
    kind: 'warehouse:pallet',
    label: 'Loaded Pallet',
    sectionId: 'unit-loads',
    description:
      'Cartons or drums, wrapped and strapped. The fill is drawn from the range below, and the pallet snaps into a rack position.',
    icon: 'lucide:boxes',
    brush: { kind: 'pallet', cargo: 'carton' },
  },
  {
    id: 'pallet-rack',
    kind: 'warehouse:pallet-rack',
    label: 'Pallet Rack',
    sectionId: 'storage',
    description:
      'One bay of adjustable racking. Multiply it into a run from the panel; bays standing together share a post.',
    icon: 'lucide:rows-3',
    brush: {
      kind: 'rack',
      patch: { variant: 'pallet-rack', uprightHeight: 5, levels: 3, pickingLevels: 0 },
    },
  },
  {
    id: 'pallet-rack-low',
    kind: 'warehouse:pallet-rack',
    label: 'Low Rack',
    sectionId: 'storage',
    description:
      'Alçak raf şablonu: 2.5 m dikme, iki kat, ikisi de kutu raflı toplama gözü. Aynı kind, hazır ölçüler — yerleştirdikten sonra her alanı değiştirilebilir.',
    icon: 'lucide:rows-2',
    /**
     * `pickingLevels` DEPOLAMA konumlarını sayıyor ve sayım ZEMİNDEN başlıyor:
     * `levelTypeOf` `level < pickingLevels` diyor, zemin de 0. `levels: 2` +
     * `groundLevelStorage` üç depolama konumu demek (zemin + iki kiriş katı),
     * dolayısıyla üçünü de toplama gözü yapan değer 3.
     *
     * Burada bir kez `1` yazılmıştı ve sonucu sessizdi: yalnız ZEMİNİ toplama
     * gözü ilan ediyor, `levelHasShelf` ise `level <= 0` için `false` dönüyor —
     * zemin kiriş de raf da taşımaz. Yani fiş "alt kat toplama rafı" diyor,
     * hiçbir kutu rafı çizilmiyor ve alçak raf iki katlı sıradan bir palet rafı
     * olarak iniyordu. Hata vermeyen, yalnız yanlış ürünü teslim eden cinsten.
     */
    brush: {
      kind: 'rack',
      patch: { variant: 'low-rack', uprightHeight: 2.5, levels: 2, pickingLevels: 3 },
    },
  },
  {
    id: 'route-pedestrian',
    kind: 'warehouse:route',
    label: 'Yaya Yolu',
    sectionId: 'layout',
    description:
      'A marked pedestrian way. Two continuous stripes; the width is the clear floor between them.',
    icon: 'lucide:footprints',
    brush: { kind: 'route', role: 'pedestrian', traffic: 'two-way' },
  },
  {
    id: 'route-vehicle',
    kind: 'warehouse:route',
    label: 'Araç Koridoru',
    sectionId: 'layout',
    description:
      'A marked vehicle aisle, sized from the published band for the truck class it names.',
    icon: 'lucide:route',
    brush: { kind: 'route', role: 'vehicle', traffic: 'one-way' },
  },
  // Aile başına bir tile — kullanıcının seçtiği beş makine, İngilizce
  // adlarıyla. Tek tile + panel model listesi (plan §6.5) yerine beş tile:
  // seçim kataloğun kendisinde durur ve panel özel bölüm istemez.
  {
    id: 'truck-hand-pallet',
    kind: 'warehouse:truck',
    label: 'Hand pallet truck',
    sectionId: 'handling',
    description: 'Manual pallet truck, 680×1150 forks, 1.5 t. Carries at floor level.',
    icon: 'lucide:package-open',
    brush: { kind: 'truck', model: 'mpt-680x1150' },
  },
  {
    id: 'truck-powered-pallet',
    kind: 'warehouse:truck',
    label: 'Electric pallet truck',
    sectionId: 'handling',
    description: 'Ride-on electric pallet truck, 2.5 t. Published VDI aisle: 2.35 m.',
    icon: 'lucide:truck',
    brush: { kind: 'truck', model: 'ept-2500' },
  },
  {
    id: 'truck-forklift',
    kind: 'warehouse:truck',
    label: 'Electric forklift',
    sectionId: 'handling',
    description: 'Three-wheel counterbalanced, 1.3 t. Published VDI aisle: 3.11 m.',
    icon: 'lucide:forklift',
    brush: { kind: 'truck', model: 'forklift-1300' },
  },
  {
    id: 'truck-reach',
    kind: 'warehouse:truck',
    label: 'Reach truck',
    sectionId: 'handling',
    description: 'Straddle-leg reach truck, 1.8 t. Published VDI aisle: 2.74 m.',
    icon: 'lucide:container',
    brush: { kind: 'truck', model: 'rt-1800' },
  },
  {
    id: 'truck-turret',
    kind: 'warehouse:truck',
    label: 'Turret truck',
    sectionId: 'handling',
    description:
      'Man-up VNA truck, 1.6 t. Ast unpublished — the class band (EN 15620, 1.7–1.9 m) governs.',
    icon: 'lucide:building-2',
    brush: { kind: 'truck', model: 'tt-1600' },
  },
  {
    id: 'conveyor-roller',
    kind: 'warehouse:conveyor-roller',
    label: 'Roller Conveyor',
    sectionId: 'conveyance',
    description:
      'One module of continuously driven roller conveyor. Lay a run with [ and ]; each module is its own object.',
    icon: 'lucide:move-right',
  },
  {
    id: 'conveyor-curve',
    kind: 'warehouse:conveyor-curve',
    label: 'Curved Conveyor',
    sectionId: 'conveyance',
    description:
      'Turns a line through 45, 90 or 180°, keeping every box facing the way it entered. [ and ] set the angle, H flips the hand.',
    icon: 'lucide:corner-up-left',
  },
  {
    id: 'conveyor-launcher',
    kind: 'warehouse:conveyor-launcher',
    label: 'Launcher Conveyor',
    sectionId: 'conveyance',
    description:
      'Branches a line at ninety degrees without a curve: the main bed runs through and a short arm throws the box off it. H flips the launch side.',
    icon: 'lucide:git-fork',
  },
  {
    id: 'conveyor-booster',
    kind: 'warehouse:conveyor-booster',
    label: 'Booster Conveyor',
    sectionId: 'conveyance',
    description:
      'A short driven section that regulates a load’s passage and tightens the cycle. Its drive sits under the bed, which makes it the tightest frame in the family.',
    icon: 'lucide:chevrons-right',
  },
  {
    id: 'conveyor-transfer',
    kind: 'warehouse:conveyor-transfer',
    label: 'Mixed Transfer',
    sectionId: 'conveyance',
    description:
      'Crosses a line through ninety degrees without turning the box: belt strips rise between the rollers and carry it off sideways. H flips the discharge side.',
    icon: 'lucide:move-diagonal',
  },
  {
    id: 'conveyor-telescopic',
    kind: 'warehouse:conveyor-telescopic',
    label: 'Telescopic Belt Conveyor',
    sectionId: 'conveyance',
    description:
      'Araç/konteyner yükleme bomu: sabit gövdesinden dorsenin içine uzayan bant. On katalog modeli, tam açıkken 14–25 m. [ ve ] ile bomu kısaltıp uzatın.',
    icon: 'lucide:move-horizontal',
    brush: { kind: 'telescopic', model: 'a4-6+12' },
  },
  {
    id: 'conveyor-spiral-carton',
    kind: 'warehouse:conveyor-spiral',
    label: 'Spiral Conveyor (carton)',
    sectionId: 'conveyance',
    description:
      'Merkezi kolon etrafında yükselen helis bant — karton/tote için (≤12,5° eğim). Dar bir taban izinde kot değiştirir. Giriş ve çıkış farklı yükseklikte.',
    icon: 'lucide:tornado',
    brush: {
      kind: 'conveyor-spiral',
      patch: { loadClass: 'light', outerDiameter: '1500', beltWidth: '500' },
    },
  },
  {
    id: 'conveyor-spiral-pallet',
    kind: 'warehouse:conveyor-spiral',
    label: 'Spiral Conveyor (pallet)',
    sectionId: 'conveyance',
    description:
      'Palet sınıfı sarmal: min. 2.400 mm dış çap, ≤13° eğim, 5 m/dak (yayınlanmış). Tekil palet yükünü kat değiştirir.',
    icon: 'lucide:tornado',
    brush: {
      kind: 'conveyor-spiral',
      patch: { loadClass: 'pallet', outerDiameter: '2400', beltWidth: '500' },
    },
  },
  {
    id: 'conveyor-oblique',
    kind: 'warehouse:conveyor-oblique',
    label: 'Oblique Transfer',
    sectionId: 'conveyance',
    description:
      'Branches a line at an angle without stopping it. The branch is a narrower lane than the main bed, so a box that takes it has to fit the branch. H flips the side.',
    icon: 'lucide:split',
  },
  {
    id: 'longspan-picking',
    kind: 'warehouse:longspan-rack',
    label: 'M7 Longspan (Picking)',
    sectionId: 'storage',
    description:
      'Elle toplama gozu: kirisli sunta raflar, 1.9 m goz. Katlar serbestce karisir - kirisli raf, kirissiz HM, yalniz kiris ya da aski. Kose parantezlerle kat sayisini ayarlayin.',
    icon: 'lucide:library',
    brush: {
      kind: 'longspan',
      patch: {
        bayLength: 1.9,
        frameDepth: 0.6,
        frameHeight: 2.5,
        levelCount: 4,
        structure: 'beam-shelf',
        shelfKind: 'chipboard',
      },
    },
  },
  {
    id: 'longspan-bulk',
    kind: 'warehouse:longspan-rack',
    label: 'M7 Longspan (Bulk)',
    sectionId: 'storage',
    description:
      'Hacimli mal gozu: 2.7 m aciklik, 1.0 m derinlik, tel raf. Uzun mal icin katlari yalniz kiris yapabilirsiniz.',
    icon: 'lucide:layout-list',
    brush: {
      kind: 'longspan',
      patch: {
        bayLength: 2.7,
        frameDepth: 1,
        frameHeight: 4,
        levelCount: 3,
        structure: 'beam-shelf',
        shelfKind: 'mesh',
      },
    },
  },
  {
    id: 'm3-picking',
    kind: 'warehouse:m3-rack',
    label: 'M3 Shelving (Picking)',
    sectionId: 'storage',
    description:
      'Elle toplama rafı: kirişsiz, raflar dikmenin yan yuvalarına 25 mm adımla asılır. HL paneli kat başına 150 kg, HM 275 kg — bu paketin YAYIMLANMIŞ tek kapasitesi. [ ve ] ile kat sayısı.',
    icon: 'lucide:layout-grid',
    brush: {
      kind: 'm3',
      patch: {
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
    },
  },
  {
    id: 'm3-drawers',
    kind: 'warehouse:m3-rack',
    label: 'M3 Drawer Unit',
    sectionId: 'storage',
    description:
      'Küçük parça toplama: her kat polipropilen çekmece taşır. Çekmece sayısı elle girilmez — göz boyu ÷ çekmece genişliği, katalogun 1.000 mm için 4/8 ve 1.250 mm için 5/10 satırlarını birebir veren bölme.',
    icon: 'lucide:archive',
    brush: {
      kind: 'm3',
      patch: {
        shelfLength: 1,
        shelfDepth: 0.5,
        frameHeight: 2,
        frameVariant: 'basic',
        backPanel: 'none',
        door: 'none',
        levelCount: 5,
        structure: 'drawers',
        model: 'HM',
      },
    },
  },
  {
    id: 'bench-dispatch',
    kind: 'warehouse:bench',
    label: 'Dispatch Packing Table',
    sectionId: 'stations',
    description:
      'Yoğun sevkiyat istasyonu: 2000 × 900 mm tabla, makaralı yüzey, üst raf ve alt raf. Zarf eski uygulamanın spec dosyasından; iç ölçüler seçilmiş varsayılan. Genişlik, kot ve derinlik panelden ayarlanır.',
    icon: 'lucide:package-open',
    brush: { kind: 'bench', patch: { variant: 'dispatch-packing' } },
  },
  {
    id: 'bench-mail-order',
    kind: 'warehouse:bench',
    label: 'Mail Order Packing Table',
    sectionId: 'stations',
    description:
      'Posta siparişi paketleme: 1830 × 915 mm tabla, ahşap yüzey, sarf malzemesi için üst raf. [ ve ] ile tezgâh tipleri arasında dolaşın.',
    icon: 'lucide:mail',
    brush: { kind: 'bench', patch: { variant: 'mail-order-packing' } },
  },
  {
    id: 'bench-processing',
    kind: 'warehouse:bench',
    label: 'Processing Bench',
    sectionId: 'stations',
    description:
      'Ayırma ve kontrol tezgâhı: 1600 × 750 mm tabla, çekmece bloğu ve alet panosu. Çekmeceler masanın yarısında, öteki yarısı diz boşluğu.',
    icon: 'lucide:wrench',
    brush: { kind: 'bench', patch: { variant: 'processing' } },
  },
  {
    id: 'bench-weighing',
    kind: 'warehouse:bench',
    label: 'Weighing Scale Bench',
    sectionId: 'stations',
    description:
      'Tartılı istasyon: 1400 × 750 mm tabla, gömme platform terazi ve okuma ekranı standı. Platform tablaya sığmazsa panel HATA verir.',
    icon: 'lucide:scale',
    brush: { kind: 'bench', patch: { variant: 'weighing-scale' } },
  },
  {
    id: 'bench-mobile',
    kind: 'warehouse:bench',
    label: 'Mobile Workbench',
    sectionId: 'stations',
    description:
      'Tekerlekli tezgâh: 1220 × 910 mm tabla, çekmeceli. Tekerler tabla kotunu YÜKSELTMEZ — ayaklar kısalır, böylece sabit tezgâhla yan yana hizalanır.',
    icon: 'lucide:truck',
    brush: { kind: 'bench', patch: { variant: 'mobile-workbench' } },
  },
  {
    id: 'bench-eco',
    kind: 'warehouse:bench',
    label: 'Eco Table',
    sectionId: 'stations',
    description:
      'Sade paketleme masası: 1200 × 600 mm tabla, metal çerçeve, donanımsız. Ölçüye yaptırılacak bir masanın başlangıç noktası.',
    icon: 'lucide:table',
    brush: { kind: 'bench', patch: { variant: 'eco' } },
  },
  {
    id: 'tote-cart',
    kind: 'warehouse:tote-cart',
    label: 'Tote Cart',
    sectionId: 'handling',
    description:
      'Sipariş toplama arabası: kat başına bir Euro kasa, 600 × 400 mm taban. Beş kat × 220 mm kasa, toplam boy 1,40 m. Yükseklik ALAN DEĞİL — katlardan hesaplanıyor, yani kasalar birbirinin içine giremiyor. [ ve ] ile kat sayısı.',
    icon: 'lucide:shopping-cart',
    brush: { kind: 'totecart', patch: { tiers: 5, toteHeight: '220', tilt: false } },
  },
  {
    id: 'tote-cart-tilted',
    kind: 'warehouse:tote-cart',
    label: 'Tote Cart (tilted tiers)',
    sectionId: 'handling',
    description:
      'Eğimli tepsili toplama arabası: kasalar operatöre dönük, elle almak kolay. Üç kat × 320 mm kasa. Eğim açısı 15° — gerçek eğimli araba var ama açıyı hiçbir üretici yayımlamıyor, bu değer kullanıcının kendi eski uygulamasından.',
    icon: 'lucide:package-open',
    brush: { kind: 'totecart', patch: { tiers: 3, toteHeight: '320', tilt: true } },
  },
  {
    id: 'dock-leveller-hinged',
    kind: 'warehouse:dock-leveller',
    label: 'Dock Leveller (hinged lip)',
    sectionId: 'docks',
    description:
      'Kapı çukuruna gömülü hidrolik köprü: dinlenmede tablası zeminle aynı kotta, üstünden forklift geçer. 2500 × 2000 mm tabla, 400 mm menteşeli dudak, 60 kN. Ölçüler Stertil S serisinden; eğim sınırı EN 1398 (%12,5).',
    icon: 'lucide:import',
    brush: { kind: 'dockleveller', patch: { length: '2500', lip: 'hinged' } },
  },
  {
    id: 'dock-leveller-telescopic',
    kind: 'warehouse:dock-leveller',
    label: 'Dock Leveller (telescopic lip)',
    sectionId: 'docks',
    description:
      'Dudağı tablanın altındaki cepten kayarak çıkan rampa: dorsenin içine 1000 mman uzanır, yükü kapıya yakın istiflenmiş dorselerde bile alır. 3000 × 2000 mm tabla. KAYNAK: Stertil X serisi.',
    icon: 'lucide:move-horizontal',
    brush: { kind: 'dockleveller', patch: { length: '3000', lip: 'telescopic' } },
  },
  {
    id: 'm3-cabinet',
    kind: 'warehouse:m3-rack',
    label: 'M3 Cabinet (Office)',
    sectionId: 'storage',
    description:
      'Kapalı ofis dolabı: sac arka panel + iki kanatlı kapı. Arka panel çapraz bağın YERİNİ alır (katalog kuralı), kapı yalnız 1.000 mm gözde var. RAL 5014 dikme + RAL 7035 gövde.',
    icon: 'lucide:door-closed',
    brush: {
      kind: 'm3',
      patch: {
        shelfLength: 1,
        shelfDepth: 0.4,
        frameHeight: 2,
        frameVariant: 'basic',
        backPanel: 'metal',
        door: 'h2000',
        levelCount: 4,
        structure: 'shelf',
        model: 'HL',
      },
    },
  },
  {
    id: 'drive-in-rack',
    kind: 'warehouse:drive-in-rack',
    label: 'Drive-in Rack',
    sectionId: 'storage',
    description:
      'Biriktirerek depolama: araç şeridin içine girer, paletler derinlemesine istiflenir. Şerit başına tek SKU, tek koridor yüzünden LIFO. [ ve ] ile derinliği ayarlayın.',
    icon: 'lucide:rows-4',
    brush: {
      kind: 'drive-in',
      patch: {
        laneClearWidth: 1.35,
        palletsDeep: 4,
        levels: 3,
        railType: 'gp',
        entryMode: 'drive-in',
      },
    },
  },
  {
    id: 'drive-through-rack',
    kind: 'warehouse:drive-in-rack',
    label: 'Drive-through Rack',
    sectionId: 'storage',
    description:
      'İki ucu da açık şerit: bir yüzden yükle, öbüründen al — FIFO. Katalog bu düzenle CS3 çaprazlamasını yasaklıyor (s.13).',
    icon: 'lucide:move-horizontal',
    brush: {
      kind: 'drive-in',
      patch: {
        laneClearWidth: 1.35,
        palletsDeep: 6,
        levels: 3,
        railType: 'gp',
        entryMode: 'drive-through',
      },
    },
  },
  {
    id: 'live-racking-fifo',
    kind: 'warehouse:live-rack',
    label: 'Live Racking (FIFO)',
    sectionId: 'storage',
    description:
      'Yerçekimi akışlı kanal: palet yüksek uçtan yüklenir, %4 eğimle çıkışa akar. İki koridor, kanal başına tek SKU. [ ve ] ile derinliği ayarlayın.',
    icon: 'lucide:chevrons-down',
    brush: {
      kind: 'live-racking',
      patch: { variant: 'FIFO', palletsDeep: 8, levels: 4, withRetainers: false },
    },
  },
  {
    id: 'live-racking-lifo',
    kind: 'warehouse:live-rack',
    label: 'Live Racking (LIFO Push-back)',
    sectionId: 'storage',
    description: 'Tek koridorlu push-back: aynı uçtan yükle ve al. Sığ kanallar için, tutuculu.',
    icon: 'lucide:chevrons-up',
    brush: {
      kind: 'live-racking',
      patch: { variant: 'LIFO', palletsDeep: 4, levels: 4, withRetainers: true },
    },
  },
  {
    id: 'mezzanine-sigma',
    kind: 'warehouse:mezzanine',
    label: 'Sigma Mezzanine',
    sectionId: 'mezzanine',
    description:
      'Soğuk şekillendirilmiş Sigma profil, tek kat. 4×3 göz, 3 m tavan boşluğu, 500 kg/m².',
    icon: 'lucide:layers-2',
    brush: {
      kind: 'mezzanine',
      patch: {
        constructiveSystem: 'SIGMA',
        columnType: 'single',
        grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
        tiers: [
          {
            index: 0,
            elevationM: 'auto',
            clearHeightM: 3,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
            /**
             * Merdiven ve palet kapısı fişin PARÇASI.
             *
             * Aksesuarsız bir fiş, kullanıcıya üstüne çıkamayacağı ve yük
             * çıkaramayacağı bir platform veriyordu — katalogdan gelen bir
             * ürünün eksik teslim edilmesi. Basamak sayısı `'auto'`:
             * gerçek kot farkından çıkıyor, sabit bir sayı yazmak fişi
             * kendi uyarısıyla göndermek olurdu.
             */
            accessories: {
              staircases: [
                {
                  id: 'sigma-stair-s',
                  placement: { mode: 'edge', edge: 'south', offsetM: 8 },
                  widthM: 1,
                  landing: 'turn90',
                  railings: 2,
                  steps: 'auto',
                },
              ],
              swingGates: [],
              upAndOverGates: [{ edge: 'north', offsetM: 10, widthM: 1.5 }],
              safetyZones: [],
            },
          },
        ],
      },
    },
  },
  {
    id: 'mezzanine-gl2000',
    kind: 'warehouse:mezzanine',
    label: 'GL2000 Mezzanine (2 Tiers)',
    sectionId: 'mezzanine',
    description:
      'Sıcak haddelenmiş IPE/HEA, ağır yük, iki kat. 5×4 göz, çelik ızgara döşeme, 1000 kg/m².',
    icon: 'lucide:layers-3',
    brush: {
      kind: 'mezzanine',
      patch: {
        constructiveSystem: 'GL2000',
        columnType: 'single',
        grid: { baysX: 5, baysY: 4, bayWidthM: 6, bayDepthM: 6 },
        tiers: [
          {
            index: 0,
            elevationM: 'auto',
            clearHeightM: 3.5,
            loadClass: 1000,
            floorType: 'METAL_GRID',
            accessories: {
              staircases: [
                {
                  id: 'gl2000-stair-w0',
                  placement: { mode: 'edge', edge: 'west', offsetM: 8 },
                  widthM: 1,
                  landing: 'turn180',
                  railings: 2,
                  steps: 'auto',
                },
              ],
              swingGates: [],
              upAndOverGates: [{ edge: 'east', offsetM: 12, widthM: 1.5 }],
              safetyZones: [],
            },
          },
          {
            index: 1,
            elevationM: 'auto',
            clearHeightM: 3.5,
            loadClass: 750,
            floorType: 'METAL_GRID',
            // Üst kata da kendi merdiveni: alt kata çıkıp orada kalmak
            // iki katlı bir yapının yarısını erişilmez bırakırdı.
            accessories: {
              staircases: [
                {
                  id: 'gl2000-stair-w1',
                  placement: { mode: 'edge', edge: 'west', offsetM: 16 },
                  widthM: 1,
                  landing: 'turn180',
                  railings: 2,
                  steps: 'auto',
                },
              ],
              swingGates: [],
              upAndOverGates: [{ edge: 'east', offsetM: 12, widthM: 1.5 }],
              safetyZones: [],
            },
          },
        ],
      },
    },
  },
  {
    id: 'mezzanine-mixed',
    kind: 'warehouse:mezzanine',
    label: 'Mixed Mezzanine (Large Span)',
    sectionId: 'mezzanine',
    description:
      'Sigma dikme + IPE kiriş karması, büyük açıklık. 3×3 göz × 8 m, sunta döşeme, 350 kg/m².',
    icon: 'lucide:layers',
    brush: {
      kind: 'mezzanine',
      patch: {
        // MIXED, katalogdan sahneye giden yolu olmayan tek sistemdi:
        // tanımlıydı ve yerleştirme sonrası seçilebiliyordu ama hiçbir fiş
        // onu üretmiyordu.
        constructiveSystem: 'MIXED',
        columnType: 'double',
        grid: { baysX: 3, baysY: 3, bayWidthM: 8, bayDepthM: 8 },
        tiers: [
          {
            index: 0,
            elevationM: 'auto',
            clearHeightM: 4,
            loadClass: 350,
            floorType: 'WOOD_GALV_SHEET_1_5',
            accessories: {
              staircases: [
                {
                  id: 'mixed-stair-e',
                  placement: { mode: 'edge', edge: 'east', offsetM: 12 },
                  widthM: 1,
                  landing: 'turn180',
                  railings: 2,
                  steps: 'auto',
                },
              ],
              swingGates: [{ edge: 'north', offsetM: 12, widthM: 0.75 }],
              upAndOverGates: [{ edge: 'west', offsetM: 12, widthM: 1.5 }],
              safetyZones: [],
            },
          },
        ],
      },
    },
  },
] as const

export function itemsInSection(sectionId: string): CatalogItem[] {
  return CATALOG_ITEMS.filter((item) => item.sectionId === sectionId)
}

/**
 * Bir fiş yanıyor mu — yani bir sonraki tıklama TAM OLARAK bunu mu koyar.
 *
 * Panelden ayrı bir saf fonksiyon, çünkü asıl değeri test edilebilir olması:
 * önceki hâli JSX'in içinde altı elle yazılmış yüklemdi (`wantsLoad`,
 * `wantsRole`, `wantsModel`, `wantsVariant`, `wantsLip`, `wantsTilt`) ve
 * yüklemi yazılmamış her aile aynı anda birden çok fişi yakıyordu — raf,
 * longspan, m3, drive-in, live-rack, mezzanine. Hiçbir test bunu göremiyordu.
 *
 * Kimlik tek karşılaştırma ve aile başına bakım istemiyor.
 *
 * Katalog dışından silahlanan araç (kısayol, host paleti) kimlik yazmıyor;
 * o hâlde kind eşleşmesine düşülüyor, yoksa araç açıkken hiçbir fiş yanmaz
 * ve panel silahlı aracı hiç göstermez.
 */
export function chipIsArmed(
  item: CatalogItem,
  activeTool: string | null | undefined,
  armedChipId: string | null,
): boolean {
  if (activeTool !== item.kind) return false
  const armed = CATALOG_ITEMS.find((chip) => chip.id === armedChipId)
  return armed?.kind === item.kind ? armed.id === item.id : true
}
