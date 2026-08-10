import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { PALLET_PRESETS } from '../pallet/presets'
import { lengthLabel, millimetreLabel, publishedMillimetres, unitNow } from '../units'
import {
  LevelsField,
  PalletSupportBarsField,
  PalletsPerLevelField,
  PickingBoxesAcrossField,
  PickingBoxesDeepField,
} from './auto-fields'
import type { PalletRackNode } from './schema'
import {
  autoPalletsPerLevel,
  drawnPickingLevels,
  fittedLevelCount,
  hasUnsupportedPallets,
  levelClearHeight,
  levelClearOpening,
  levelSurfaceY,
  palletSupportBarsPossible,
  storageLevels,
  storageLevelsPresent,
} from './slots'
import { en15620Clearance } from './standards'

const PRESET_KEYS = Object.keys(PALLET_PRESETS) as (keyof typeof PALLET_PRESETS)[]

/**
 * A unit load, pallet included, for the headroom check.
 *
 * A rack does not know what it will hold, and the clearance the standard asks
 * for is measured above the *load*. 1.2 m overall — a 144 mm pallet under about
 * a metre of goods — is the figure bay pitches are planned around, and it is the
 * one that makes the 1.4 m default opening come out comfortable rather than
 * marginal. Stated here rather than buried in the message, so it can be argued
 * with.
 */
const ASSUMED_UNIT_LOAD = 1.2

/**
 * Auto-derived inspector fields rather than a `customPanel`, for the reason the
 * pallet's descriptor gives: the escape hatch short-circuits `groups`,
 * `actions` *and* `trailingSection`, so taking it means owning the
 * Move/Duplicate/Delete buttons too.
 *
 * The invariants are where most of this file's value is. A rack has enough
 * interacting dimensions that a plausible-looking set of numbers can describe
 * something nobody could build, and the failures are quiet: levels that do not
 * fit simply stop being counted, and a rack turned long-side-out without
 * support bars looks completely normal.
 */
export const palletRackParametrics: ParametricDescriptor<PalletRackNode> = {
  /**
   * Six groups in the order a bay is actually specified: how big, how many
   * levels, what goes on it, how it is picked, then the steel and where it
   * stands. The version this replaces had ten groups and showed every field
   * always — including five picking-container dimensions on a rack with no
   * picking levels, and a spine gap on a single run. Half the panel described
   * settings that moved nothing.
   *
   * `visibleIf` does that work, and it reads the *same predicates the geometry
   * cache key reads*. The rule it enforces is that a control can never be
   * visible, adjustable, and inert; "shown exactly when it changes the mesh" is
   * how that rule is spelled for every field here but one. `variant` changes no
   * vertex and is still shown, because it drives the height cap and the tree
   * label — see its own note below.
   *
   * There is no bay or row count here, and that is the shape of the kind rather
   * than an omission: a bay is a node, so "twenty bays" is twenty nodes and the
   * command that lays them down lives in the trailing section, not in a field
   * that would silently reshape one node into a block.
   */
  groups: [
    {
      label: 'Size',
      fields: [
        /**
         * Mesh'i değiştirmeyen tek görünür alan, ve istisnanın gerekçesi
         * yukarıdaki kuralın KENDİSİNDE yazılı: yasak olan "görünür,
         * ayarlanabilir ve ETKİSİZ" kontrol. Bu etkisiz değil — altındaki
         * yükseklik slider'ının tavanını ve ağaçtaki adı o belirliyor.
         * Mesh yüklemi o kuralın vekiliydi, kuralın kendisi değil.
         *
         * Görünür olması ayrıca 3 m tavanını AÇIKLIYOR: tavanın sebebi
         * sliderın hemen üstünde duruyor, yoksa kullanıcı rafı neden
         * yükseltemediğini hiçbir yerde okuyamazdı.
         */
        {
          key: 'variant',
          kind: 'enum',
          options: ['pallet-rack', 'low-rack'],
          display: 'segmented',
        },
        { key: 'bayClearWidth', kind: 'number', unit: 'm', min: 0.6, max: 6, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.4, max: 2.5, step: 0.05 },
        { key: 'uprightHeight', kind: 'number', unit: 'm', min: 1, max: 20, step: 0.1 },
        { key: 'depthPositions', kind: 'number', min: 1, max: 2, step: 1 },
        {
          key: 'depthGap',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.5,
          step: 0.01,
          // Single-deep, there is no second position to separate.
          visibleIf: (node) => node.depthPositions > 1,
        },
      ],
    },
    {
      label: 'Levels',
      fields: [
        { key: 'levels', kind: 'number', min: 0, max: 15, step: 1 },
        /**
         * Kat açıklığının TEK kontrolü.
         *
         * Buraya üç ayrı slider daha geliyordu — `firstLevelClear`,
         * `levelClear` ve (Picking grubunda) `pickingLevelClear` — hepsi aynı
         * sayıyı, `levelClearOpening`'in içindeki bir öncelik zincirine göre
         * yönetiyordu. Dördü artık `LevelsField`'in içinde: üstte varsayılanlar,
         * altta onları yenen kat satırları. Alanların hiçbiri kaldırılmadı,
         * yalnız hangisinin hangisini yendiği artık ekranda görünüyor.
         */
        { key: 'levelClears', kind: 'custom', component: LevelsField },
        {
          key: 'decking',
          kind: 'enum',
          options: ['wire-mesh', 'steel', 'timber', 'open'],
          display: 'select',
        },
        { key: 'groundLevelStorage', kind: 'boolean' },
        { key: 'hasGroundBeam', kind: 'boolean' },
        {
          key: 'tunnelLevels',
          kind: 'number',
          min: 0,
          max: 15,
          step: 1,
          // `storageLevels`, which is the list the tunnel actually filters —
          // **not** `fittedLevelCount`, which was the near-miss. They differ on
          // the ground level: a bay with `levels: 0` and a ground beam has a
          // fitted count of 0 and a storage level all the same, so the control
          // vanished on exactly the bay where a tunnel still deletes the ground
          // beam and takes the bay's only position with it.
          visibleIf: (node) => storageLevels(node).length > 0,
        },
        { key: 'levelCapacity', kind: 'number', unit: 'kg', min: 0, max: 20_000, step: 100 },
      ],
    },
    {
      label: 'Load',
      fields: [
        { key: 'palletPreset', kind: 'enum', options: PRESET_KEYS, display: 'select' },
        {
          key: 'palletOrientation',
          kind: 'enum',
          options: ['short-side-out', 'long-side-out'],
          display: 'select',
        },
        { key: 'clearanceToUpright', kind: 'number', unit: 'm', min: 0, max: 0.4, step: 0.005 },
        {
          key: 'clearanceBetweenPallets',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.4,
          step: 0.005,
        },
        {
          key: 'palletsPerLevel',
          kind: 'custom',
          component: PalletsPerLevelField,
        },
        {
          key: 'palletSupportBars',
          kind: 'custom',
          component: PalletSupportBarsField,
          // Bars only exist where a level has no panel over it. `…Possible`
          // rather than `…Drawn`, because the control is how a zero becomes a
          // three — gating on "is one drawn" would be a locked door. The old
          // `|| requiresPalletSupportBars` disjunct was the reverse mistake: it
          // opened the control on a wire-decked rack where no level can carry a
          // bar at all, so the slider moved and nothing changed.
          visibleIf: (node) => palletSupportBarsPossible(node),
        },
        { key: 'ghostFill', kind: 'number', min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      label: 'Picking',
      fields: [
        { key: 'pickingLevels', kind: 'number', min: 0, max: 15, step: 1 },
        // Everything below describes hand-picked container shelves, and is shown
        // against `drawnPickingLevels` rather than `pickingLevels > 0`. The two
        // differ on the ground level: `pickingLevels: 1` designates the floor,
        // which carries no beam and no shelf, so the profile fields were visible
        // and moved nothing at exactly the setting a user reaches for first.
        //
        // `pickingLevelClear` used to sit here, one group away from the two
        // fields it competes with. It is now the third default inside
        // `LevelsField`, next to them.
        {
          key: 'pickingBeamHeight',
          kind: 'number',
          unit: 'm',
          min: 0.04,
          max: 0.2,
          step: 0.005,
          visibleIf: (node) => drawnPickingLevels(node).length > 0,
        },
        {
          key: 'pickingShelfThickness',
          kind: 'number',
          unit: 'm',
          min: 0.005,
          max: 0.06,
          step: 0.005,
          visibleIf: (node) => drawnPickingLevels(node).length > 0,
        },
        // The container block. These drive the slot enumeration and the capacity
        // readout in the trailing section; nothing draws the boxes yet, which is
        // why they sit behind the levels rather than beside them.
        {
          key: 'pickingBoxWidth',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 1.5,
          step: 0.05,
          visibleIf: (node) => drawnPickingLevels(node).length > 0,
        },
        {
          key: 'pickingBoxDepth',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 1.5,
          step: 0.05,
          visibleIf: (node) => drawnPickingLevels(node).length > 0,
        },
        {
          key: 'pickingBoxHeight',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 1,
          step: 0.02,
          visibleIf: (node) => drawnPickingLevels(node).length > 0,
        },
        {
          key: 'pickingBoxGap',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.2,
          step: 0.005,
          visibleIf: (node) => drawnPickingLevels(node).length > 0,
        },
        {
          key: 'pickingBoxesAcross',
          kind: 'custom',
          component: PickingBoxesAcrossField,
          visibleIf: (node) => drawnPickingLevels(node).length > 0,
        },
        {
          key: 'pickingBoxesDeep',
          kind: 'custom',
          component: PickingBoxesDeepField,
          visibleIf: (node) => drawnPickingLevels(node).length > 0,
        },
      ],
    },
    {
      label: 'Steel',
      fields: [
        { key: 'uprightWidth', kind: 'number', unit: 'm', min: 0.05, max: 0.25, step: 0.001 },
        { key: 'uprightDepth', kind: 'number', unit: 'm', min: 0.05, max: 0.25, step: 0.001 },
        { key: 'beamHeight', kind: 'number', unit: 'm', min: 0.06, max: 0.25, step: 0.01 },
        { key: 'beamThickness', kind: 'number', unit: 'm', min: 0.02, max: 0.15, step: 0.005 },
        {
          key: 'bracing',
          kind: 'enum',
          options: ['z-bracing', 'x-bracing', 'open'],
          display: 'select',
        },
        { key: 'uprightColor', kind: 'color' },
        { key: 'beamColor', kind: 'color' },
      ],
    },
    {
      label: 'Placement',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],

  // Multiply, capacity and the derived "auto" fields, under the bay's own
  // fields rather than instead of them. A `customPanel` would take the
  // auto-derived groups, the actions and the Move/Delete buttons with it.
  trailingSection: () => import('./rack-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const unit = unitNow()

      // Levels silently stop existing when they do not fit the upright, and
      // nothing on screen says so — the rack just has fewer shelves than the
      // number in the field.
      const fitted = fittedLevelCount(node)
      if (fitted < node.levels) {
        issues.push({
          field: 'levels',
          severity: 'warning',
          msg: `Only ${fitted} of ${node.levels} levels fit a ${lengthLabel(node.uprightHeight, unit)} upright. Raise the height or reduce the clear openings.`,
        })
      }

      // Turned long-side-out, a Euro pallet's bottom boards lie along the beams
      // instead of across them, so the middle of the pallet is unsupported.
      if (hasUnsupportedPallets(node)) {
        issues.push({
          field: 'palletSupportBars',
          severity: 'warning',
          msg: 'Pallets are turned long-side-out with no support bars. Their bottom deckboards run along the beams, leaving the middle unsupported.',
        })
      }

      /**
       * Kutu yüksekliği açıklığa sığmıyor.
       *
       * `pickingBoxHeight` denetimde ÖLÜ ALAN olarak bulundu: şemada tanımlı,
       * panelde slider'ı var, ve iki referansı dışında kodun hiçbir yeri onu
       * okumuyordu — "görünür, ayarlanabilir ve etkisiz", yani bu dosyanın
       * kendi yasakladığı şey.
       *
       * Alanı silmek yerine sonuç bağlandı. Kutular henüz çizilmiyor (bu bir
       * özellik, bir kusur değil) ama yükseklik ZATEN bir şey söylüyor:
       * toplama katının açıklığına sığmayan bir kap, o rafa konamaz. Ölçüyü
       * karşılaştıracak veri elde olduğu hâlde karşılaştırmamak, kullanıcının
       * girdiği sayıyı görmezden gelmekti.
       */
      for (const level of drawnPickingLevels(node)) {
        const opening = levelClearOpening(node, level)
        if (node.pickingBoxHeight <= opening) continue
        issues.push({
          field: 'pickingBoxHeight',
          severity: 'warning',
          msg: `${millimetreLabel(node.pickingBoxHeight, unit)} kap, kat ${level}'in ${millimetreLabel(opening, unit)} açıklığına sığmıyor.`,
        })
        // Bir tane yeter: toplama katlarının açıklığı tek varsayılandan
        // geliyor, yani biri darsa hepsi dardır.
        break
      }

      // A declared count above what the bay geometrically holds is legitimate
      // to model but worth naming, because the pallets will visibly touch.
      const auto = autoPalletsPerLevel(node)
      if (node.palletsPerLevel !== null && node.palletsPerLevel > auto) {
        issues.push({
          field: 'palletsPerLevel',
          severity: 'warning',
          msg: `${node.palletsPerLevel} pallets per level exceeds the ${auto} this bay fits at the declared clearances.`,
        })
      }

      // A tunnel taken far enough leaves a pair of frames carrying nothing —
      // legitimate at the ends of a fire route, but silent, because the bay is
      // still there and still selectable with every load field intact.
      if (node.tunnelLevels > 0 && storageLevelsPresent(node).length === 0) {
        issues.push({
          field: 'tunnelLevels',
          severity: 'warning',
          msg: `A ${node.tunnelLevels}-level tunnel clears every level this bay has, so it stores nothing and draws as bare frames.`,
        })
      }

      // EN 15620 asks for a clearance **above the unit load**, and it widens
      // with height. The check has to compare like with like, and it did not:
      // it tested `levelClear` — the whole opening from one load surface to the
      // next beam's underside — against a figure measured above the load. It was
      // also unsatisfiable, since the largest clearance in the table is 175 mm
      // and the schema floors `levelClear` at 200 mm, so the branch could never
      // fire on any node the schema would accept. An unreachable check is worse
      // than none: it reads as coverage.
      //
      // The **top** level is deliberately not tested. What sits above it is the
      // building, not the rack — a 5 m frame whose top beam is at 4.66 m carries
      // loads that stand well above the frame, and that is ordinary. The rack
      // does not know the building, so it does not get to warn about it.
      for (let level = 1; level < fitted; level++) {
        const surface = levelSurfaceY(node, level)
        const required = en15620Clearance(surface, '400')
        if (!required) continue
        const headroom = levelClearHeight(node, level) - ASSUMED_UNIT_LOAD
        if (headroom >= required.y) continue
        issues.push({
          // Reported against `levelClear`, which is the field that fixes it —
          // but only when the inspector is showing it. A single-level rack has
          // no interior opening to be tight, so this cannot fire there.
          field: 'levelClear',
          severity: 'warning',
          msg: `Level ${level} leaves ${millimetreLabel(headroom, unit)} over a ${millimetreLabel(ASSUMED_UNIT_LOAD, unit)} unit load; EN 15620 asks for ${publishedMillimetres(required.y * 1000)} at ${lengthLabel(surface, unit, 1)}.`,
        })
        // One is enough. Every level above a tight one is usually tight too, and
        // a wall of identical warnings buries the rest of the panel.
        break
      }

      const top = levelSurfaceY(node, fitted)
      if (!en15620Clearance(top, '400') && top > 0) {
        issues.push({
          field: 'uprightHeight',
          severity: 'warning',
          msg: `At ${lengthLabel(top, unit, 1)} the top level is above the range EN 15620 rates for forklifts; it needs a turret truck or a crane.`,
        })
      }

      return issues
    },
  ],
}
