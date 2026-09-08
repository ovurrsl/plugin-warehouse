'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { IssueList } from '../panels/issue-list'
import { routeParametrics } from './parametrics'
import {
  appendControlPoint,
  calculatePolylineLength,
  deleteControlPoint,
  prependControlPoint,
  reverseRouteDirection,
} from './route-controls-math'
import type { RouteNode } from './schema'

/**
 * The route's readings, which nothing else draws.
 *
 * Mounted as `parametrics.trailingSection`, under the node's own fields rather
 * than instead of them.
 *
 * This kind loses more than the others did by having no panel, because the
 * reading *is* the feature: the aisle band a manufacturer publishes for the
 * selected truck, the margin in millimetres, and — for a pedestrian walkway —
 * the note saying the only published width in the survey is German and this
 * one is an estimate. All of it was computed and discarded. The descriptor's
 * rule still governs what appears here: every message is a measurement or a
 * citation, never a verdict. See `../panels/issue-list`.
 */

/** The host passes no `node` prop to `trailingSection`; see the pallet panel. */
function useInspectedRoute(provided?: RouteNode): RouteNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:route') return null
  return selected as unknown as RouteNode
}

export default function RoutePanel({ node: provided }: { node?: RouteNode }) {
  const node = useInspectedRoute(provided)
  if (!node) return null

  const issues = routeParametrics.invariants?.flatMap((check) => check(node)) ?? []

  const updateNode = (patch: Partial<RouteNode>) => {
    useScene.getState().updateNode(node.id as AnyNodeId, patch)
  }

  const isFilled = node.fillEnabled !== false
  const fillColor =
    node.fillColor ?? node.laneColor ?? (node.role === 'vehicle' ? '#f59e0b' : '#3b82f6')
  const edgeColor = node.edgeColor ?? (node.role === 'vehicle' ? '#eab308' : '#ffffff')
  const arrowsEnabled = node.directionalArrows !== false

  return (
    <div className="flex flex-col gap-3 py-2 text-xs">
      {/* Streetscape-style Cross Section Preview Card */}
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
        <div className="mb-2 flex items-center justify-between font-medium text-foreground/80">
          <span>Kesit Önizleme ({node.width.toFixed(2)} m)</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
            {node.role === 'vehicle' ? 'Araç' : 'Yaya'}
          </span>
        </div>

        <div className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded border border-border/40 bg-background/50">
          {/* Left Stripe */}
          <div
            className="h-full w-2"
            style={{
              backgroundColor: edgeColor,
              borderRight: node.edgeStyle === 'dashed' ? '2px dashed rgba(0,0,0,0.3)' : 'none',
            }}
          />

          {/* Corridor Center */}
          <div
            className="relative flex h-full flex-1 items-center justify-center transition-colors"
            style={{
              backgroundColor: isFilled ? fillColor : 'transparent',
              backgroundImage: isFilled
                ? 'none'
                : 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(120,120,120,0.08) 5px, rgba(120,120,120,0.08) 10px)',
            }}
          >
            {arrowsEnabled && (
              <span className="font-bold text-foreground/70 tracking-widest select-none">
                {node.arrowDirection === 'backward'
                  ? '◀◀'
                  : node.arrowDirection === 'both'
                    ? '◀▶'
                    : '▶▶'}
              </span>
            )}
            {!isFilled && (
              <span className="text-[10px] text-muted-foreground/60 select-none">Boş Zemin</span>
            )}
          </div>

          {/* Right Stripe */}
          <div
            className="h-full w-2"
            style={{
              backgroundColor: edgeColor,
              borderLeft: node.edgeStyle === 'dashed' ? '2px dashed rgba(0,0,0,0.3)' : 'none',
            }}
          />
        </div>
      </div>

      {/* Industrial Color Quick Swatches */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
        <div className="text-[11px] font-medium text-foreground/70">Endüstriyel Renk Paleti</div>
        <div className="flex items-center gap-1.5">
          {[
            { label: 'Sarı', hex: '#eab308' },
            { label: 'Mavi', hex: '#3b82f6' },
            { label: 'Yeşil', hex: '#22c55e' },
            { label: 'Kırmızı', hex: '#ef4444' },
            { label: 'Beyaz', hex: '#ffffff' },
          ].map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.label}
              onClick={() => updateNode({ fillColor: c.hex, laneColor: c.hex })}
              className="h-5 w-5 rounded border border-border shadow-xs hover:scale-110 transition-transform cursor-pointer"
              style={{ backgroundColor: c.hex }}
            />
          ))}
          <label className="relative flex h-5 w-5 cursor-pointer items-center justify-center overflow-hidden rounded border border-border bg-background text-[10px]">
            <span>🎨</span>
            <input
              type="color"
              value={fillColor}
              onChange={(e) => updateNode({ fillColor: e.target.value, laneColor: e.target.value })}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* Route Points & Interactive Polyline Editing Controls */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium text-foreground/70">Güzergah Noktaları</div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="rounded bg-background/80 px-1.5 py-0.5 border border-border/40 font-mono">
              {node.points.length} nokta
            </span>
            <span className="rounded bg-background/80 px-1.5 py-0.5 border border-border/40 font-mono">
              {calculatePolylineLength(node.points).toFixed(1)} m
            </span>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            disabled={node.points.length >= 64}
            onClick={() => {
              try {
                const updated = prependControlPoint(node)
                updateNode({ points: updated.points })
                triggerSFX('sfx:item-place')
              } catch {}
            }}
            className="flex items-center justify-center gap-1 rounded border border-border/60 bg-background/70 px-2 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground disabled:opacity-40 cursor-pointer"
            title="Güzergahın başına 2 metre yeni nokta ekler"
          >
            <span>➕ Başa</span>
          </button>
          <button
            type="button"
            disabled={node.points.length >= 64}
            onClick={() => {
              try {
                const updated = appendControlPoint(node)
                updateNode({ points: updated.points })
                triggerSFX('sfx:item-place')
              } catch {}
            }}
            className="flex items-center justify-center gap-1 rounded border border-border/60 bg-background/70 px-2 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground disabled:opacity-40 cursor-pointer"
            title="Güzergahın sonuna 2 metre yeni nokta ekler"
          >
            <span>➕ Sona</span>
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                const updated = reverseRouteDirection(node)
                updateNode({ points: updated.points })
                triggerSFX('sfx:item-place')
              } catch {}
            }}
            className="flex items-center justify-center gap-1 rounded border border-border/60 bg-background/70 px-2 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground cursor-pointer"
            title="Yolun yönünü tersine çevirir (başlangıç ve bitişi yer değiştirir)"
          >
            <span>🔄 Çevir</span>
          </button>
        </div>

        {/* Individual Points List (Scrollable) */}
        <div className="flex max-h-36 flex-col gap-1 overflow-y-auto pr-0.5">
          {node.points.map((pt, idx) => (
            <div
              key={`pt-${idx}-${pt[0]}-${pt[1]}`}
              className="flex items-center justify-between rounded border border-border/30 bg-background/40 px-2 py-1 text-[10px]"
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-muted-foreground w-4">#{idx + 1}</span>
                <span className="font-mono text-foreground/80">
                  X: {pt[0].toFixed(2)}m, Z: {pt[1].toFixed(2)}m
                </span>
              </div>
              <button
                type="button"
                disabled={node.points.length <= 2}
                onClick={() => {
                  try {
                    const updated = deleteControlPoint(node, idx)
                    updateNode({ points: updated.points })
                    triggerSFX('sfx:item-delete')
                  } catch {}
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-30 cursor-pointer"
                title={node.points.length <= 2 ? 'En az 2 nokta gereklidir' : 'Noktayı sil'}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>

        {/* 3D Interaction Tip */}
        <div className="rounded bg-muted/40 p-1.5 text-[10px] text-muted-foreground leading-relaxed">
          💡 <span className="font-medium text-foreground/70">3D Düzenleme:</span> Uçlardaki mavi
          (+) tutamaçlarla yolu uzatabilir, ara (+) butonlarıyla yeni viraj ekleyebilir, 3D ekranda
          noktayı seçip{' '}
          <kbd className="rounded border px-1 py-0.2 bg-background font-mono text-[9px]">
            Delete
          </kbd>{' '}
          veya{' '}
          <kbd className="rounded border px-1 py-0.2 bg-background font-mono text-[9px]">
            Alt+Tık
          </kbd>{' '}
          ile silebilirsiniz.
        </div>
      </div>

      <IssueList issues={issues} />
    </div>
  )
}
