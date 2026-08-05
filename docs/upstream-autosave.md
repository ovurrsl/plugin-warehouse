# perf(autosave): stop serialising the whole scene on every store write

## Symptom

On large scenes, every single edit hitches the main thread — moving a wall,
deleting a node, one slider tick, one undo. The hitch grows with scene size
and has nothing to do with rendering: a 3 MB scene (≈2,700 racking bays from a
warehouse plugin) pays 15 ms per edit on a fast desktop CPU and 40–80 ms on an
integrated-graphics laptop. Continuous writers — dragging a door in the 2D
floor plan, a door animation writing per frame, scrubbing a parametric slider —
turn that into a sustained freeze, because each write pays the full cost.

Deleting the plugin objects "fixes" it, which misleadingly points at the
plugin: the real variable is just the serialised size of `state.nodes`.

## Cause

`useAutoSave` subscribes to the scene store and decides "did the scene
change?" by serialising the entire node map **synchronously inside the
subscription, on every write**:

```ts
const currentNodesSnapshot = JSON.stringify(state.nodes)   // every write!
const changed = currentNodesSnapshot !== lastNodesSnapshot || …
```

The debounce below it only delays the *save*; this compare runs immediately,
every time, and its cost is O(total scene JSON).

## Fix

Compare by reference instead. The store hands out a fresh `nodes` object on
every write that touches nodes, so a reference compare catches every real
change. The stringify bought one thing: suppressing saves when a write produced
a new object with identical content. That false positive costs at most one
debounced save — and a host that persists remotely already dedupes
content-identical saves before POSTing (SceneLoader's signature compare), so
in practice it costs nothing.

With the patch, the per-write cost of change detection is one pointer compare.

## Measurements (2,708-bay scene, 3.4 MB of nodes)

| per store write | before | after |
|---|---|---|
| change detection | 15.2 ms (desktop) / est. 40–80 ms (iGPU laptop) | ~0 ms |

(Idle and orbit frame times are unaffected — camera movement never writes the
store. This is purely an edit-time hitch.)
