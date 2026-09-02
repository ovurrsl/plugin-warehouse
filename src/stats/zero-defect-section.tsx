'use client'

import { Icon } from '@iconify/react'
import { useScene } from '@pascal-app/core'
import type { ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import React, { useMemo, useState } from 'react'
import {
  calculateFacilityZDSUReport,
  exportZoneAuditJson,
  exportZoneAuditMarkdown,
} from './zero-defect'
import { REGULATORY_STANDARDS } from './zero-defect-standards'
import type {
  FacilityZDSUReport,
  RegulatoryStandardId,
  ZDSUDefect,
  ZDSUStatus,
  ZDSUUtilizationHealth,
  ZoneZDSUAudit,
} from './zero-defect-types'
import { areaLabel } from '../units'

const FG = 'var(--sidebar-foreground)'
const BORDER = 'var(--sidebar-border)'
const ACCENT = 'var(--sidebar-accent)'
const RING = 'var(--sidebar-ring)'

const fade = (percent: number) => `color-mix(in oklab, ${FG} ${percent}%, transparent)`

export function ZeroDefectZoneReportSection({ levelId }: { levelId?: string | null }) {
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)
  const unit = useViewer((s) => s.unit)
  const [selectedStandard, setSelectedStandard] = useState<RegulatoryStandardId | null>(null)
  const [selectedZoneId, setSelectedZoneId] = useState<string | 'all'>('all')
  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(null)
  const [copiedStatus, setCopiedStatus] = useState<'none' | 'json' | 'md'>('none')

  // Find all zones on current level (or all zones if levelId is null)
  const zones = useMemo(() => {
    return Object.values(nodes).filter((node) => {
      const isZone = (node as { type?: string })?.type === 'zone'
      if (!isZone) return false
      if (levelId) return (node as { parentId?: string })?.parentId === levelId
      return true
    }) as ZoneNode[]
  }, [nodes, levelId])

  const facilityReport: FacilityZDSUReport | null = useMemo(() => {
    if (!selectedStandard) return null
    return calculateFacilityZDSUReport(nodes as never, zones, { standardId: selectedStandard })
  }, [nodes, zones, selectedStandard])

  const visibleAudits = useMemo(() => {
    if (!facilityReport) return []
    if (selectedZoneId === 'all') return facilityReport.zoneAudits
    return facilityReport.zoneAudits.filter((z) => z.zoneId === selectedZoneId)
  }, [facilityReport, selectedZoneId])

  const handleCopyJson = async () => {
    if (!facilityReport) return
    try {
      const json = exportZoneAuditJson(facilityReport)
      await navigator.clipboard.writeText(json)
      setCopiedStatus('json')
      setTimeout(() => setCopiedStatus('none'), 2000)
    } catch (e) {
      console.error('Failed to copy JSON:', e)
    }
  }

  const handleCopyMarkdown = async () => {
    if (!facilityReport) return
    try {
      const md = exportZoneAuditMarkdown(facilityReport)
      await navigator.clipboard.writeText(md)
      setCopiedStatus('md')
      setTimeout(() => setCopiedStatus('none'), 2000)
    } catch (e) {
      console.error('Failed to copy Markdown:', e)
    }
  }

  if (zones.length === 0) {
    return (
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          padding: '0.75rem',
          borderRadius: '0.5rem',
          border: `1px dashed ${BORDER}`,
          backgroundColor: 'color-mix(in oklab, var(--sidebar-accent) 40%, transparent)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Icon height={16} icon="lucide:shield-alert" style={{ color: fade(60) }} width={16} />
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: FG }}>
            Zero Defect Start-up (ZDSU)
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '0.75rem', color: fade(70), lineHeight: 1.4 }}>
          No zones drawn on this level. Draw a zone polygon with the Zone Tool to run automated
          regulatory start-up compliance audits.
        </p>
      </section>
    )
  }

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        marginTop: '0.25rem',
      }}
    >
      {/* Section Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Icon
            height={15}
            icon="lucide:shield-check"
            style={{
              color:
                !facilityReport
                  ? fade(50)
                  : facilityReport.overallStatus === 'ready'
                    ? '#10b981'
                    : facilityReport.overallStatus === 'warning'
                      ? '#f59e0b'
                      : '#ef4444',
            }}
            width={15}
          />
          <h3 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: FG }}>
            Zero Defect Start-up
          </h3>
        </div>
        {facilityReport && (
          <StatusBadge score={facilityReport.overallReadinessScore} status={facilityReport.overallStatus} />
        )}
      </div>

      {/* Mandatory Standard Selector Warning Banner when standard is null */}
      {selectedStandard === null ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.625rem',
            padding: '0.875rem',
            borderRadius: '0.5rem',
            border: '1px solid color-mix(in oklab, #f59e0b 50%, transparent)',
            backgroundColor: 'color-mix(in oklab, #f59e0b 12%, transparent)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Icon height={18} icon="lucide:shield-alert" style={{ color: '#f59e0b', flexShrink: 0 }} width={18} />
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: FG }}>
              Yönetmelik Seçin (Select Standard)
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.75rem', color: fade(80), lineHeight: 1.4 }}>
            ZDSU sıfır hata ve güvenlik denetimini başlatmak için lütfen geçerli bir uluslararası yönetmelik standardı seçin.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.375rem', marginTop: '0.25rem' }}>
            {(['TR', 'EU', 'US'] as RegulatoryStandardId[]).map((id) => (
              <button
                key={id}
                onClick={() => setSelectedStandard(id)}
                style={{
                  padding: '0.375rem 0.25rem',
                  borderRadius: '0.375rem',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  border: `1px solid color-mix(in oklab, #f59e0b 40%, ${BORDER})`,
                  backgroundColor: 'color-mix(in oklab, var(--sidebar-accent) 80%, transparent)',
                  color: FG,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
                type="button"
              >
                {REGULATORY_STANDARDS[id].shortName}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Standard Switcher Header Bar when a standard is active */
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.375rem 0.5rem',
            borderRadius: '0.375rem',
            backgroundColor: 'color-mix(in oklab, var(--sidebar-accent) 50%, transparent)',
            border: `1px solid ${BORDER}`,
          }}
        >
          <span style={{ fontSize: '0.6875rem', color: fade(70), fontWeight: 500 }}>
            Standard:
          </span>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {(['TR', 'EU', 'US'] as RegulatoryStandardId[]).map((id) => {
              const isActive = selectedStandard === id
              return (
                <button
                  key={id}
                  onClick={() => setSelectedStandard(id)}
                  style={{
                    padding: '0.1875rem 0.4375rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.625rem',
                    fontWeight: isActive ? 600 : 500,
                    border: `1px solid ${isActive ? RING : 'transparent'}`,
                    backgroundColor: isActive ? ACCENT : 'transparent',
                    color: FG,
                    cursor: 'pointer',
                  }}
                  type="button"
                >
                  {REGULATORY_STANDARDS[id].shortName}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Lockout / Hide Results if no standard is selected */}
      {selectedStandard !== null && facilityReport && (
        <>
          {/* Facility Overview Banner */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.375rem',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              backgroundColor: 'color-mix(in oklab, var(--sidebar-accent) 60%, transparent)',
              border: `1px solid ${BORDER}`,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.6875rem', color: fade(60) }}>Audited</span>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                {facilityReport.zonesAudited} {facilityReport.zonesAudited === 1 ? 'zone' : 'zones'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.6875rem', color: fade(60) }}>Floor Util.</span>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                {facilityReport.averageFloorUtilizationPct}%
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.6875rem', color: fade(60) }}>Defects</span>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                {facilityReport.totalDefects.blocking > 0 ? (
                  <span style={{ color: '#ef4444' }}>{facilityReport.totalDefects.blocking} Block</span>
                ) : facilityReport.totalDefects.warning > 0 ? (
                  <span style={{ color: '#f59e0b' }}>{facilityReport.totalDefects.warning} Warn</span>
                ) : (
                  <span style={{ color: '#10b981' }}>0 Defects</span>
                )}
              </span>
            </div>
          </div>

          {/* Zone Selector Filter if > 1 zone */}
          {zones.length > 1 && (
            <div style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
              <button
                onClick={() => setSelectedZoneId('all')}
                style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '9999px',
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  border: `1px solid ${selectedZoneId === 'all' ? RING : BORDER}`,
                  backgroundColor: selectedZoneId === 'all' ? ACCENT : 'transparent',
                  color: FG,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                type="button"
              >
                All Zones ({zones.length})
              </button>
              {zones.map((z) => (
                <button
                  key={z.id}
                  onClick={() => setSelectedZoneId(z.id)}
                  style={{
                    padding: '0.25rem 0.5rem',
                    borderRadius: '9999px',
                    fontSize: '0.6875rem',
                    fontWeight: 500,
                    border: `1px solid ${selectedZoneId === z.id ? RING : BORDER}`,
                    backgroundColor: selectedZoneId === z.id ? ACCENT : 'transparent',
                    color: FG,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  type="button"
                >
                  {z.name || 'Zone'}
                </button>
              ))}
            </div>
          )}

          {/* Zone Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {visibleAudits.map((audit) => {
              const isExpanded = expandedZoneId === audit.zoneId || visibleAudits.length === 1
              return (
                <ZoneAuditCard
                  audit={audit}
                  isExpanded={isExpanded}
                  key={audit.zoneId}
                  onToggle={() =>
                    setExpandedZoneId(isExpanded && visibleAudits.length > 1 ? null : audit.zoneId)
                  }
                  unit={unit}
                />
              )
            })}
          </div>

          {/* Export Action Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem', marginTop: '0.25rem' }}>
            <button
              onClick={handleCopyJson}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.25rem',
                padding: '0.375rem 0.5rem',
                borderRadius: '0.375rem',
                border: `1px solid ${BORDER}`,
                backgroundColor: 'color-mix(in oklab, var(--sidebar-accent) 50%, transparent)',
                color: FG,
                fontSize: '0.6875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
              type="button"
            >
              <Icon height={12} icon={copiedStatus === 'json' ? 'lucide:check' : 'lucide:file-json'} width={12} />
              <span>{copiedStatus === 'json' ? 'Copied JSON!' : 'Copy ZDSU JSON'}</span>
            </button>
            <button
              onClick={handleCopyMarkdown}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.25rem',
                padding: '0.375rem 0.5rem',
                borderRadius: '0.375rem',
                border: `1px solid ${BORDER}`,
                backgroundColor: 'color-mix(in oklab, var(--sidebar-accent) 50%, transparent)',
                color: FG,
                fontSize: '0.6875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
              type="button"
            >
              <Icon height={12} icon={copiedStatus === 'md' ? 'lucide:check' : 'lucide:file-text'} width={12} />
              <span>{copiedStatus === 'md' ? 'Copied Audit!' : 'Copy Audit Cert'}</span>
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function ZoneAuditCard({
  audit,
  unit,
  isExpanded,
  onToggle,
}: {
  audit: ZoneZDSUAudit
  unit: 'metric' | 'imperial'
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '0.375rem',
        border: `1px solid ${audit.readiness.status === 'blocked' ? '#ef444480' : BORDER}`,
        backgroundColor: 'color-mix(in oklab, var(--sidebar-accent) 30%, transparent)',
        overflow: 'hidden',
      }}
    >
      {/* Card Header / Accordion trigger */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.5rem 0.625rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: FG,
          width: '100%',
        }}
        type="button"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', overflow: 'hidden' }}>
          <Icon
            height={12}
            icon={isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'}
            style={{ color: fade(60), flexShrink: 0 }}
            width={12}
          />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem', overflow: 'hidden' }}>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {audit.zoneName}
            </span>
            <span style={{ fontSize: '0.6875rem', color: fade(65), fontWeight: 400, flexShrink: 0 }}>
              ({audit.floorName})
            </span>
          </div>
          <span
            style={{
              fontSize: '0.625rem',
              padding: '0.0625rem 0.375rem',
              borderRadius: '9999px',
              backgroundColor: ACCENT,
              color: fade(80),
              flexShrink: 0,
            }}
          >
            {formatZoneRole(audit.role)}
          </span>
        </div>
        <StatusBadge score={audit.readiness.score} status={audit.readiness.status} />
      </button>

      {/* Expanded Metrics & Defect List */}
      {isExpanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            padding: '0 0.625rem 0.625rem 0.625rem',
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          {/* Key Figures Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.375rem',
              paddingTop: '0.5rem',
            }}
          >
            <MetricItem label="Footprint Area" value={areaLabel(audit.geometry.areaM2, unit, 0)} />
            <MetricItem
              label="Pallet Positions"
              note={
                audit.storage.totalPalletPositions > 0
                  ? `${audit.storage.selectivityIndex}% Direct Access`
                  : undefined
              }
              value={audit.storage.totalPalletPositions.toLocaleString()}
            />
            <MetricItem label="Clear Height" value={`${audit.geometry.clearHeightM.toFixed(1)}m`} />
            <MetricItem
              label="Sprinkler Clearance"
              note={audit.clearance.sprinklerCompliant ? 'Compliant OK' : 'VIOLATION (<0.5m)'}
              noteColor={audit.clearance.sprinklerCompliant ? '#10b981' : '#ef4444'}
              value={`${audit.clearance.sprinklerClearanceM.toFixed(2)}m`}
            />
            {audit.staging.dockCount > 0 && (
              <>
                <MetricItem label="Dock Levellers" value={`${audit.staging.dockCount}`} />
                <MetricItem
                  label="Buffer / Dock"
                  note={
                    audit.staging.stagingAreaPerDockM2 && audit.staging.stagingAreaPerDockM2 >= 30
                      ? 'Compliant OK'
                      : 'DEFICIT'
                  }
                  noteColor={
                    audit.staging.stagingAreaPerDockM2 && audit.staging.stagingAreaPerDockM2 >= 30
                      ? '#10b981'
                      : '#ef4444'
                  }
                  value={`${audit.staging.stagingAreaPerDockM2?.toFixed(1) ?? '–'} m²`}
                />
              </>
            )}
          </div>

          {/* Utilization Progress Bar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.125rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem' }}>
              <span style={{ color: fade(70) }}>Floor Utilization</span>
              <span style={{ fontWeight: 600, color: getHealthColor(audit.utilization.health) }}>
                {audit.utilization.floorUtilizationPct}% ({formatHealth(audit.utilization.health)})
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '6px',
                borderRadius: '3px',
                backgroundColor: 'color-mix(in oklab, var(--sidebar-border) 80%, transparent)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, audit.utilization.floorUtilizationPct)}%`,
                  height: '100%',
                  backgroundColor: getHealthColor(audit.utilization.health),
                  borderRadius: '3px',
                  transition: 'width 200ms ease-out',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: fade(50) }}>
              <span>0%</span>
              <span>
                Optimal: {audit.utilization.optimalRange[0]}%–{audit.utilization.optimalRange[1]}%
              </span>
              <span>100%</span>
            </div>
          </div>

          {/* Defects & Checklist */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: fade(80) }}>
              Audit Findings & Checklist
            </span>
            {audit.defects.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.375rem 0.5rem',
                  borderRadius: '0.25rem',
                  backgroundColor: '#10b98115',
                  border: '1px solid #10b98130',
                  color: '#10b981',
                  fontSize: '0.6875rem',
                }}
              >
                <Icon height={13} icon="lucide:check-circle-2" width={13} />
                <span>100% Start-up Compliant · Zero Defects Detected</span>
              </div>
            ) : (
              audit.defects.map((d, index) => <DefectRow defect={d} key={`${d.code}-${d.targetLayer || index}`} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricItem({
  label,
  value,
  note,
  noteColor,
}: {
  label: string
  value: string
  note?: string
  noteColor?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '0.3125rem 0.375rem',
        borderRadius: '0.25rem',
        backgroundColor: 'color-mix(in oklab, var(--sidebar-accent) 40%, transparent)',
      }}
    >
      <span style={{ fontSize: '0.625rem', color: fade(60) }}>{label}</span>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: FG }}>{value}</span>
      {note && (
        <span style={{ fontSize: '0.5625rem', color: noteColor || fade(50), marginTop: '0.0625rem' }}>
          {note}
        </span>
      )}
    </div>
  )
}

function DefectRow({ defect }: { defect: ZDSUDefect }) {
  const isBlocking = defect.severity === 'blocking'
  const isWarning = defect.severity === 'warning'
  const color = isBlocking ? '#ef4444' : isWarning ? '#f59e0b' : '#3b82f6'
  const bg = isBlocking ? '#ef444415' : isWarning ? '#f59e0b15' : '#3b82f615'
  const border = isBlocking ? '#ef444430' : isWarning ? '#f59e0b30' : '#3b82f630'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.125rem',
        padding: '0.375rem 0.5rem',
        borderRadius: '0.25rem',
        backgroundColor: bg,
        border: `1px solid ${border}`,
        fontSize: '0.6875rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
          <Icon
            height={12}
            icon={isBlocking ? 'lucide:alert-octagon' : isWarning ? 'lucide:alert-triangle' : 'lucide:info'}
            style={{ color, flexShrink: 0 }}
            width={12}
          />
          <span style={{ fontWeight: 600, color }}>{defect.title}</span>
          {defect.targetLayer && (
            <span
              style={{
                fontSize: '0.5625rem',
                fontWeight: 600,
                padding: '0.0625rem 0.3125rem',
                borderRadius: '0.25rem',
                backgroundColor: 'color-mix(in oklab, var(--sidebar-foreground) 12%, transparent)',
                color: FG,
              }}
            >
              {defect.targetLayer}
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.5625rem', color: fade(60) }}>{defect.code}</span>
      </div>
      <span style={{ color: fade(80), lineHeight: 1.3, fontSize: '0.625rem' }}>{defect.message}</span>
      {defect.standardRef && (
        <span style={{ fontSize: '0.5625rem', color: fade(50), fontStyle: 'italic' }}>
          Ref: {defect.standardRef}
        </span>
      )}
    </div>
  )
}

function StatusBadge({ score, status }: { score: number; status: ZDSUStatus }) {
  const isReady = status === 'ready'
  const isWarn = status === 'warning'
  const color = isReady ? '#10b981' : isWarn ? '#f59e0b' : '#ef4444'
  const bg = isReady ? '#10b98120' : isWarn ? '#f59e0b20' : '#ef444420'
  const border = isReady ? '#10b98140' : isWarn ? '#f59e0b40' : '#ef444440'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.125rem 0.4375rem',
        borderRadius: '9999px',
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color,
        fontSize: '0.6875rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{status.toUpperCase()}</span>
      <span>{score}%</span>
    </span>
  )
}

function formatZoneRole(role: string): string {
  switch (role) {
    case 'storage-selective':
      return 'Selective Storage'
    case 'storage-drivein':
      return 'Drive-In Storage'
    case 'storage-live':
      return 'Live Flow Storage'
    case 'staging-inbound':
      return 'Inbound Staging'
    case 'staging-outbound':
      return 'Outbound Staging'
    case 'picking':
      return 'Forward Picking'
    case 'vas-packing':
      return 'VAS / Packing'
    case 'conveyor-corridor':
      return 'Conveyor Corridor'
    case 'traffic-aisle':
      return 'Traffic Aisle'
    case 'quarantine':
      return 'Quarantine / QA'
    default:
      return 'General Zone'
  }
}

function formatHealth(health: ZDSUUtilizationHealth): string {
  switch (health) {
    case 'optimal':
      return 'Optimal'
    case 'congested':
      return 'Congested'
    case 'severe-congestion':
      return 'Severe Congestion'
    case 'sparse':
      return 'Underutilized'
  }
}

function getHealthColor(health: ZDSUUtilizationHealth): string {
  switch (health) {
    case 'optimal':
      return '#10b981'
    case 'congested':
      return '#f59e0b'
    case 'severe-congestion':
      return '#ef4444'
    case 'sparse':
      return '#3b82f6'
  }
}
