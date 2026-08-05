# perf(core): make bulk node creation linear, and stop validating kinds the union cannot carry

## Symptom

Duplicating a level in a large scene locks the editor. Not "hitches" — the
camera stops responding, nodes cannot be selected, nothing can be deleted,
for seconds. The scene that produced this is a warehouse: one level, ~900
nodes, most of them racking bays from a plugin. Duplicating it twice is enough
to make the app unusable.

Two independent costs in `createNodesAction` account for most of it, and both
are worst exactly in the shape a level duplicate produces: **many nodes, one
parent**.

## Cause 1 — appending children is quadratic

`createNodesAction` rewrites the parent node on **every op**:

```ts
const existing = (parent as { children?: unknown }).children
const children = Array.isArray(existing) ? (existing as AnyNodeId[]) : []
nextNodes[effectiveParentId] = {
  ...parent,
  children: Array.from(new Set([...children, newNode.id])) as any,
}
```

Each op spreads the parent's `children` and rebuilds a `Set` from it. Appending
K children to one parent therefore copies ~K²/2 elements. A bulk create is the
one call where all K land under the *same* parent, so it is the case that makes
this quadratic rather than the case that avoids it.

## Cause 2 — every plugin node pays a validation round that is guaranteed to fail

`AnyNodeSchema` is `z.discriminatedUnion('type', […])` over the core kinds. A
plugin kind is not in it. `parseCreatedNode` nonetheless runs, per node:

1. `AnyNodeSchema.safeParse(candidate)` — a discriminated-union parse whose
   discriminator has no matching option. It cannot succeed.
2. `getNodeSchemaForType(candidate.type)` — a linear scan over every union
   option, introspecting each one's shape. It returns `null`.
3. `sanitizeNumericValue(null, …)` — a walk of the node with a null schema.

Step 1's result is discarded. Step 2 recomputes the same `null` for the same
type on every node — 900 identical scans for 900 racks.

## Fix

Three changes, all in `packages/core/src/store/actions/node-actions.ts`:

1. **Collect child ids and rewrite each parent once**, after the op loop, with
   the same de-duplication against existing children the per-op version had.
2. **Memoise `getNodeSchemaForType` per type, caching the misses too.** "This
   type has no core schema" is the answer that costs the most to compute and is
   asked most often.
3. **Skip the parse when the resolver already said there is no schema.** This
   is not a trade-off: the resolver returns `null` exactly when no option's
   discriminator accepts the value, which is the same condition that makes
   `safeParse` fail. Skipping a guaranteed miss is behaviour-preserving.

The numeric sanitise pass still runs for schema-less kinds. With a null schema
it has no limits to apply, but it does drop non-finite numbers, and plugin
nodes need that as much as core ones — a `NaN` reaching a renderer's matrix
blanks an entire `InstancedMesh` with no error and no clue which node did it.
A fast path that returns the candidate straight back loses that, silently;
`node-mutation-sanitize.test.ts` now fails if anyone reintroduces it.

## Measurements

900 nodes created under one parent in a single `createNodes` call. Min of 15
rounds after 5 warm-up rounds, Bun 1.3, Linux x64. "plugin kind" is a type
absent from the union; "core kind" is `wall`.

| variant | plugin kind | core kind |
|---|---|---|
| today | 64.8 ms | 33.3 ms |
| + batched children append | 29.1 ms | 2.8 ms |
| + memoised schema resolution | 20.5 ms | 2.8 ms |
| + skip the guaranteed-miss parse | **4.6 ms** | **3.1 ms** |

Attribution for the plugin kind: 35.7 ms was the quadratic append, 8.6 ms the
repeated union scans, 15.9 ms the parse that could not succeed. For core kinds
the two validation changes are inert by construction, which the table shows.

A level duplicate is **two** store writes (`updateNodes` for the shifted level
numbers, then `createNodes`), so the per-duplicate saving is roughly double the
`createNodes` row.

## Not changed, and why

`cloneLevelSubtree` does a `JSON.parse(JSON.stringify(node))` per node
(`clone-scene-graph.ts:235`), which reads like an obvious batching candidate.
Measured on the same 900-node subtree it is **16.3 ms per-node vs 15.2 ms
batched** — 1.1×. The per-node form also isolates a node that fails to
serialise, which the batched form would not. Left alone.

## Tests

`packages/core/src/store/actions/node-mutation-sanitize.test.ts` gains two
guards, both verified to fail against the wrong implementation and pass against
this one:

- non-finite numbers are still dropped on a kind the union does not carry
  (fails against an early `return candidate`)
- bulk append keeps op order and de-duplicates against existing children
  (fails against a plain `[...children, ...additions]`)

One of them also pins a pre-existing gap rather than hiding it: with a null
schema the sanitiser cannot tell an array from an opaque value, so it does not
descend, and a `NaN` inside `position` survives. That is true today with or
without this patch. Pinned so a future fix is a deliberate change.

`bun test` in `packages/core`: 919 pass, 0 fail. `tsc --noEmit`: clean.
