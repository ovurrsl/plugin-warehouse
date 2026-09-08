/**
 * The drawing readout — a DOM strip, built imperatively, deliberately.
 *
 * ## Why this is not a React portal
 *
 * A placement tool is mounted by the host's `ToolManager`, which lives inside
 * `<Viewer>`'s `<Canvas>`. Everything below that canvas is reconciled by
 * **R3F's** reconciler, not by react-dom — and a portal does not change which
 * reconciler owns the subtree. `react-dom`'s `createPortal` only tags a
 * container; the children are still created through R3F's host config, whose
 * `createInstance` looks the tag up in the THREE catalogue and throws
 * `R3F: Div is not part of the THREE namespace!` for a `<div>`.
 *
 * That throw is not survivable in place. `<Canvas>` re-raises anything thrown
 * inside it, and the viewer wraps its scene in
 * `<ErrorBoundary fallback={null} scope="viewer-scene">` — so ONE `<div>` in a
 * tool takes down the entire 3D subtree, `CustomCameraControls` included. The
 * reported symptom of exactly that is "the camera locks and I cannot draw":
 * both are gone because the whole scene unmounted, on the first cursor move
 * after arming the tool.
 *
 * The host's own in-canvas DOM goes through drei's `<Html>`, and its
 * screen-fixed chrome is mounted OUTSIDE the canvas. A tool has no way to reach
 * outside, so it owns its element directly — which is also cheaper: a readout
 * that changes on every cursor move writes three strings instead of running a
 * reconciliation pass per frame.
 *
 * ## Why inline styles
 *
 * Tailwind v4's scanner does not follow symlinks, a git dependency always lands
 * as a symlink, and the host's `@source` list does not name this package — so a
 * utility class written here is never compiled and the failure is silent. Every
 * value below is a literal or a host CSS variable, resolved by the browser at
 * paint time. See `src/panels/styles.ts` for the same rule stated for panels.
 */

export type RouteHudRole = 'pedestrian' | 'vehicle'

export const ROUTE_ROLE_COLORS: Record<RouteHudRole, string> = {
  pedestrian: '#2f9e58',
  vehicle: '#f2c31d',
}

export const ROUTE_ROLE_LABELS: Record<RouteHudRole, string> = {
  pedestrian: 'Yaya Yolu',
  vehicle: 'Araç Koridoru',
}

export type RouteHudModel = {
  role: RouteHudRole
  /** Whether a first corner has been committed — before that there is no leg. */
  hasAnchor: boolean
  /** The leg from the last corner to the cursor, metres. */
  legDistanceM: number
  /** That leg's bearing, degrees clockwise from +Z. */
  legAngleDeg: number
  /** Every committed leg plus the live one, metres. */
  totalDistanceM: number
}

export type RouteHudText = {
  roleLabel: string
  accent: string
  /** Empty before the first corner; the prompt carries the instruction instead. */
  readouts: string[]
  prompt: string | null
}

/**
 * The strings the strip shows.
 *
 * Split from the DOM so the wording and the rounding are assertable without a
 * document — the readout is the only part of this file that can be wrong in a
 * way a user notices.
 */
export function formatRouteHud(model: RouteHudModel): RouteHudText {
  const roleLabel = ROUTE_ROLE_LABELS[model.role]
  const accent = ROUTE_ROLE_COLORS[model.role]

  if (!model.hasAnchor) {
    return { roleLabel, accent, readouts: [], prompt: 'Başlangıç noktasını tıklayın' }
  }

  const readouts = [
    `Mesafe: ${model.legDistanceM.toFixed(2)} m`,
    `Açı: ${model.legAngleDeg.toFixed(1)}°`,
  ]
  // The total is the sum of every leg; before the second corner it IS the leg,
  // and repeating one number twice reads as a bug rather than as a total.
  if (model.totalDistanceM > model.legDistanceM + 1e-9) {
    readouts.push(`Toplam: ${model.totalDistanceM.toFixed(2)} m`)
  }
  return { roleLabel, accent, readouts, prompt: null }
}

export type RouteDrawHud = {
  /** `null` hides the strip — the cursor has left the floor, or the tool is idle. */
  update(model: RouteHudModel | null): void
  destroy(): void
}

const CONTAINER_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  bottom: '24px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: '50',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '8px 16px',
  borderRadius: '9999px',
  border: '1px solid color-mix(in oklab, var(--border) 80%, transparent)',
  background: 'color-mix(in oklab, var(--background) 95%, transparent)',
  color: 'var(--foreground)',
  font: '600 12px/1 ui-sans-serif, system-ui, sans-serif',
  boxShadow: '0 10px 30px rgb(0 0 0 / 0.25)',
  backdropFilter: 'blur(8px)',
  // The strip is a readout, never a target: a click meant for the floor must
  // reach the canvas even when the cursor is over it.
  pointerEvents: 'none',
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

function applyStyle(element: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, style)
}

function divider(document: Document): HTMLElement {
  const element = document.createElement('span')
  applyStyle(element, {
    width: '1px',
    height: '14px',
    background: 'color-mix(in oklab, var(--border) 80%, transparent)',
  })
  return element
}

/**
 * Mounts the strip on `document.body`, or returns `null` where there is no
 * document — the manifest barrel is imported during the host's server
 * prerender, so nothing here may assume one.
 */
export function createRouteDrawHud(): RouteDrawHud | null {
  if (typeof document === 'undefined') return null

  const root = document.createElement('div')
  root.dataset.warehouseHud = 'route-draw'
  applyStyle(root, CONTAINER_STYLE)
  root.hidden = true

  const swatch = document.createElement('span')
  applyStyle(swatch, { width: '10px', height: '10px', borderRadius: '9999px' })

  const roleLabel = document.createElement('span')
  const readout = document.createElement('span')
  applyStyle(readout, { color: 'var(--muted-foreground)', fontWeight: '500' })

  const hint = document.createElement('span')
  applyStyle(hint, { color: 'var(--muted-foreground)', fontSize: '11px', fontWeight: '500' })
  hint.textContent = 'Çift tık / Enter: bitir · Esc: iptal'

  root.append(swatch, roleLabel, divider(document), readout, divider(document), hint)
  document.body.append(root)

  return {
    update(model) {
      if (!model) {
        root.hidden = true
        return
      }
      const text = formatRouteHud(model)
      root.hidden = false
      swatch.style.background = text.accent
      roleLabel.textContent = text.roleLabel
      readout.textContent = text.prompt ?? text.readouts.join('   ')
    },
    destroy() {
      root.remove()
    },
  }
}
