# pascalorg/editor'a gönderilecek konu metni

Aşağıdaki metin olduğu gibi kopyalanıp <https://github.com/pascalorg/editor/issues/new>
adresine yapıştırılacak. Başlık ayrı alanda.

Neden konu (issue), PR değil: bu oturumun `pascalorg/editor`'a yazma izni yok.
Depo `CONTRIBUTING.md`'de PR'ları da kabul ediyor; ekip isterse yamalar
`docs/upstream-autosave.patch` ve `docs/upstream-bulk-create.patch` olarak hazır.

**Başlık:**

```
perf: two per-edit costs that scale with total scene size (autosave change detection, bulk node create)
```

**Gövde:**

---

Hi — while tracking down a freeze in a large warehouse scene (~2,700 racking bays from a third-party plugin, three levels) I profiled the editor and found three costs that grow with total scene size. **One of them you have already fixed** — `getLevelElevations` is memoised on `nodes` identity on `main`, and independently arriving at the same fix was a good sanity check on the diagnosis. The other two are still present, so I'm writing them up here in case they're useful.

Both come with a patch and a measurement. Happy to open PRs instead if you'd prefer that.

---

## 1. Autosave serialises the whole scene on every store write

`packages/editor/src/hooks/use-auto-save.ts`

`useAutoSave` answers "did the scene change?" by stringifying the entire node map **synchronously inside the store subscription**:

```ts
const currentNodesSnapshot = JSON.stringify(state.nodes)
const changed = currentNodesSnapshot !== lastNodesSnapshot || …
```

The debounce below only delays the *save*; this compare runs immediately, on every write, and costs O(total scene JSON). On a 3 MB scene that is ~15 ms per edit on a fast desktop — a visible hitch on every wall move, slider tick and undo. Continuous writers (dragging a door in the 2D plan, a door animation writing per frame) turn it into a sustained stall.

**Fix:** compare by reference. The store hands out a fresh `nodes` object on every write that touches nodes, so a reference compare catches every real change:

```ts
let lastNodesRef = useScene.getState().nodes
…
const changed =
  state.nodes !== lastNodesRef ||
  state.collections !== lastCollectionsRef || …
```

The stringify bought one thing: suppressing a save when a write produced a new object with identical content. That false positive costs at most one debounced save, and remote persistence already dedupes content-identical saves before POSTing.

| per store write | before | after |
|---|---|---|
| change detection | 15.2 ms (2,708-bay scene, 3.4 MB) | one pointer compare |

## 2. Bulk node creation has a quadratic append and a guaranteed-miss validation

`packages/core/src/store/actions/node-actions.ts`

Two independent costs, both worst in exactly the shape a level duplicate produces — **many nodes, one parent**.

**(a) The parent is rewritten on every op.** Each op spreads the parent's `children` and rebuilds a `Set` from it, so appending K children to one parent copies ~K²/2 elements:

```ts
nextNodes[effectiveParentId] = {
  ...parent,
  children: Array.from(new Set([...children, newNode.id])) as any,
}
```

Collecting into a `Map<parentId, ids[]>` and applying one rewrite per parent after the loop makes it linear, keeping the same de-duplication against existing children.

**(b) Every node whose kind is not in `AnyNodeSchema` pays a parse that cannot succeed.** `AnyNodeSchema` is `z.discriminatedUnion('type', …)` over the core kinds; a plugin kind is not in it. `parseCreatedNode` still runs `safeParse` (guaranteed miss), then `getNodeSchemaForType` — a linear scan over every union option, introspecting each one's shape — which returns `null` and is recomputed identically for every node of that kind.

Memoising the resolver per type (**caching the misses too** — "this type has no core schema" is the answer that costs most and is asked most often) and skipping the parse when the resolver already said there is no schema. That skip is behaviour-preserving rather than a trade: the resolver returns `null` exactly when no option's discriminator accepts the value, which is the same condition that makes `safeParse` fail.

**One caveat worth stating**, because my first attempt got it wrong: the numeric sanitise pass must still run for schema-less kinds. With a null schema it has no limits to apply, but it does drop non-finite numbers — and a `NaN` reaching a renderer's matrix blanks an entire `InstancedMesh` with no error and no clue which node did it. An early `return candidate` loses that silently.

900 nodes created under one parent in a single `createNodes` call; min of 15 rounds after 5 warm-ups, Bun 1.3, Linux x64. "plugin kind" is a type absent from the union, "core kind" is `wall`:

| variant | plugin kind | core kind |
|---|---|---|
| today | 64.8 ms | 33.3 ms |
| + batched children append | 29.1 ms | 2.8 ms |
| + memoised schema resolution | 20.5 ms | 2.8 ms |
| + skip the guaranteed-miss parse | **4.6 ms** | **3.1 ms** |

Attribution for the plugin kind: 35.7 ms was the quadratic append, 8.6 ms the repeated union scans, 15.9 ms the parse that could not succeed. For core kinds the two validation changes are inert by construction, which the table shows. A level duplicate is two store writes (`updateNodes` for the shifted ordinals, then `createNodes`), so the per-duplicate saving is roughly double the `createNodes` row.

---

## Measured and dropped

Recording this so nobody re-derives it: `cloneLevelSubtree` does a `JSON.parse(JSON.stringify(node))` **per node** (`clone-scene-graph.ts:235`), which reads like an obvious batching candidate. Measured on the same 900-node subtree it is 16.3 ms per-node vs 15.2 ms batched — 1.1×. The per-node form also isolates a node that fails to serialise, which the batched form would not. Not worth changing.

## Verification

Both changes were developed and verified against `1.0.0-beta.1`, where the touched lines are character-identical to `main`:

- `packages/editor`: `tsc --noEmit` clean, 576 tests pass
- `packages/core`: `tsc --noEmit` clean, 919 tests pass — including two new guards in `node-mutation-sanitize.test.ts`, each verified to **fail** against the wrong implementation and pass against this one: non-finite numbers are still dropped on a kind the union does not carry (fails against an early `return candidate`), and bulk append keeps op order while de-duplicating against existing children (fails against a plain `[...children, ...additions]`)

I could not run the suite against `main` in my environment (the monorepo needs a real `bun install` I couldn't complete there), so treat the numbers as unverified-on-`main` — the code paths are identical, but you'd want your own CI to confirm.

One of those guards also pins a pre-existing gap rather than hiding it: with a null schema the sanitiser cannot tell an array from an opaque value, so it does not descend, and a `NaN` inside `position` survives. That is true today with or without the patch — pinned so a future fix is a deliberate change.
