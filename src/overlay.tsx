'use client'

import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * A DOM overlay owned by this plugin, mounted from inside the 3D canvas.
 *
 * A build tool is mounted by the host's `ToolManager` *inside* the R3F tree, so
 * everything it returns is reconciled by three.js's renderer — a `<div>` there
 * is not a div, it is an unknown three.js element. React DOM's `createPortal`
 * does not help either: a portal's children are reconciled by whichever renderer
 * owns the tree, so they would still arrive at the R3F reconciler.
 *
 * The way across the boundary is a second React root, which is precisely what
 * drei's `<Html>` does (`ReactDOM.createRoot(el)` in `web/Html.js`). This is the
 * same mechanism with none of the per-frame projection: the card is chrome
 * pinned to the viewport, not a label tracking a point in the scene.
 *
 * The host has no overlay slot for plugins — `registerEditorHostPanel` puts a
 * panel in the left rail and nothing else — so a tool that wants chrome of its
 * own has to bring it. Contents cross into the new root as an element, and
 * anything stateful inside must read a module-level store rather than React
 * context: the two roots share no context, by construction.
 */

type Overlay = { root: Root; host: HTMLElement }

const overlays = new Map<string, Overlay>()

/**
 * Mount `element` into a fixed-position layer over the page, and return the
 * teardown.
 *
 * Keyed by `id` so a remount — React 19 strict mode double-invokes effects —
 * reuses the same root and container instead of stacking a second copy. The
 * returned disposer is idempotent for the same reason.
 */
export function mountOverlay(id: string, element: ReactNode): () => void {
  if (typeof document === 'undefined') return () => {}

  let overlay = overlays.get(id)
  if (!overlay) {
    const host = document.createElement('div')
    host.dataset.warehouseOverlay = id
    // The layer itself is transparent to the pointer so it never steals a click
    // meant for the canvas underneath; the card inside opts back in. z-40 is
    // where the host puts its own canvas chrome (the quick-measurement HUD), so
    // this sits with it rather than over the panels and dialogs above it.
    host.style.cssText =
      'position:fixed;inset:0;z-index:40;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;'
    document.body.appendChild(host)
    overlay = { host, root: createRoot(host) }
    overlays.set(id, overlay)
  }

  overlay.root.render(element)

  return () => {
    const current = overlays.get(id)
    if (!current) return
    overlays.delete(id)
    // Unmounting synchronously from inside an effect cleanup is what React warns
    // about, so defer past the current commit.
    queueMicrotask(() => {
      current.root.unmount()
      current.host.remove()
    })
  }
}
