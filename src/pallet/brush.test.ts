import { beforeEach, describe, expect, test } from 'bun:test'
import { useWarehouseStore } from '../store'
import { CARTON, DRUM, resolveVariant } from './cargo-types'
import { PalletNode } from './schema'

const brush = () => useWarehouseStore.getState().palletBrush
const set = useWarehouseStore.getState().setPalletBrush

beforeEach(() => {
  useWarehouseStore.setState({
    palletBrush: {
      preset: 'epal-1',
      cargo: 'none',
      fillRange: [0.4, 1],
      wrapped: true,
      strapped: true,
      labelled: true,
      cargoColor: 'kraft',
    },
  })
})

describe('choosing a cargo type brings its own practice with it', () => {
  test('drums arrive strapped and unfilmed, cartons arrive filmed', () => {
    // `CargoType.defaults` was declared for this and had no reader at all until
    // the brush asked it: a drum grew a stretch film nobody wraps drums in,
    // because the schema default said true and nothing consulted the type.
    set({ cargo: 'drum' })
    expect(brush().wrapped).toBe(DRUM.defaults.wrap)
    expect(brush().wrapped).toBe(false)
    expect(brush().strapped).toBe(true)

    set({ cargo: 'carton' })
    expect(brush().wrapped).toBe(CARTON.defaults.wrap)
    expect(brush().wrapped).toBe(true)
  })

  test('a flag set in the same breath wins over the type’s default', () => {
    set({ cargo: 'drum', wrapped: true })
    expect(brush().wrapped).toBe(true)
  })

  test('re-picking the type already chosen does not undo the user’s flags', () => {
    // Applying the defaults on every write would make the switches feel like
    // they spring back, which is worse than not defaulting at all.
    set({ cargo: 'carton' })
    set({ wrapped: false })
    set({ cargo: 'carton' })
    expect(brush().wrapped).toBe(false)
  })

  test('emptying the pallet leaves the flags alone', () => {
    set({ cargo: 'carton' })
    set({ wrapped: false })
    set({ cargo: 'none' })
    expect(brush().wrapped).toBe(false)
  })
})

describe('the ghost is the pallet', () => {
  test('a node parsed with an explicit id keeps it', () => {
    // **The mechanism the whole ghost rests on.** The tool shows a preview node,
    // then commits a node carrying that node's id; if `PalletNode.parse` minted
    // a fresh one anyway, the user would be shown one load and given another.
    const ghost = PalletNode.parse({ cargo: 'carton', preset: 'epal-1' })
    const committed = PalletNode.parse({ ...ghost, id: ghost.id, position: [3, 0, 5] })
    expect(committed.id).toBe(ghost.id)
    expect(committed.position).toEqual([3, 0, 5])
  })

  test('the same id resolves to the same fill, a different id usually does not', () => {
    // Why the id has to travel: the fill is a pure function of it. Twenty ids,
    // because two arbitrary ids can legitimately land on the same variant.
    const ghost = PalletNode.parse({ cargo: 'carton' })
    const carried = resolveVariant(CARTON, ghost.id, ghost.fillRange)
    expect(resolveVariant(CARTON, ghost.id, ghost.fillRange)).toBe(carried)

    const others = new Set(
      Array.from({ length: 20 }, () =>
        resolveVariant(CARTON, PalletNode.parse({}).id, ghost.fillRange),
      ),
    )
    expect(others.size).toBeGreaterThan(1)
  })

  test('two pallets placed in a row are two different loads', () => {
    // The counter the tool bumps after each placement exists for this: without
    // it the preview node is memoised and every pallet in a run inherits one id.
    const first = PalletNode.parse({ cargo: 'carton' })
    const second = PalletNode.parse({ cargo: 'carton' })
    expect(first.id).not.toBe(second.id)
  })
})
