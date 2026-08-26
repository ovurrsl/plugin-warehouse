import type { BomDocumentOptions, BomSheet, WarehouseBOM } from './types'

// Standard landscape letter page dimensions at 96 DPI (11in x 8.5in)
const W = 1056
const H = 816
const MARGIN = 48
const TITLE_H = 76

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function titleBlockSvg(
  sheetIndex: number,
  totalSheets: number,
  sheetTitle: string,
  bom: WarehouseBOM,
  options: BomDocumentOptions = {},
): string {
  const bx = MARGIN
  const by = H - MARGIN - TITLE_H
  const bw = W - MARGIN * 2
  const bh = TITLE_H

  const dateStr = options.date ?? bom.date
  const companyName = options.companyName ?? 'PASCAL DIGITAL TWIN'
  const projName = options.title ?? bom.projectName

  return `
  <g class="title-block">
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#0f172a" stroke="#334155" stroke-width="1"/>
    <!-- Company & Project -->
    <text x="${bx + 16}" y="${by + 28}" fill="#38bdf8" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold">${escapeXml(companyName)}</text>
    <text x="${bx + 16}" y="${by + 52}" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="10">Project: <tspan fill="#f1f5f9" font-weight="bold">${escapeXml(projName)}</tspan>  |  Scope: <tspan fill="#f1f5f9">${escapeXml(bom.scopeLabel)}</tspan></text>
    
    <!-- Sheet Title -->
    <line x1="${bx + 540}" y1="${by}" x2="${bx + 540}" y2="${by + bh}" stroke="#334155" stroke-width="1"/>
    <text x="${bx + 556}" y="${by + 28}" fill="#64748b" font-family="Helvetica, Arial, sans-serif" font-size="9" text-transform="uppercase">DRAWING / SCHEDULE</text>
    <text x="${bx + 556}" y="${by + 52}" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold">${escapeXml(sheetTitle)}</text>

    <!-- Sheet Number & Date -->
    <line x1="${bx + bw - 180}" y1="${by}" x2="${bx + bw - 180}" y2="${by + bh}" stroke="#334155" stroke-width="1"/>
    <text x="${bx + bw - 164}" y="${by + 28}" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="10">DATE: <tspan fill="#f1f5f9">${escapeXml(dateStr)}</tspan></text>
    <text x="${bx + bw - 164}" y="${by + 54}" fill="#38bdf8" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold">SHEET ${sheetIndex + 1}/${totalSheets}</text>
  </g>`
}

/**
 * Pure SVG sheets generator producing full plan-set sheets for the Bill of Materials.
 */
export function generateWarehouseBomSheets(
  bom: WarehouseBOM,
  options: BomDocumentOptions = {},
): BomSheet[] {
  const rawSheets: Array<{ title: string; contentSvg: string }> = []

  // ── Sheet 1: Cover & Summary Dashboard ────────────────────────────────────
  let coverSvg = ''

  // Header Banner
  coverSvg += `
  <rect x="${MARGIN}" y="${MARGIN}" width="${W - MARGIN * 2}" height="54" fill="#1e293b" rx="4"/>
  <text x="${MARGIN + 20}" y="${MARGIN + 34}" fill="#38bdf8" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="bold">WAREHOUSE INSTALLATION BILL OF MATERIALS (BOM)</text>
  <text x="${W - MARGIN - 20}" y="${MARGIN + 34}" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="11" text-anchor="end">SUMMARY SPECIFICATION &amp; CAPACITY REPORT</text>
  `

  // KPI Grid
  const kpiCols = 4
  const cardGap = 12
  const cardW = (W - MARGIN * 2 - cardGap * (kpiCols - 1)) / kpiCols
  const cardH = 68
  const kpiStartY = MARGIN + 74

  bom.kpis.forEach((kpi, idx) => {
    const row = Math.floor(idx / kpiCols)
    const col = idx % kpiCols
    const cx = MARGIN + col * (cardW + cardGap)
    const cy = kpiStartY + row * (cardH + 10)

    coverSvg += `
    <g class="kpi-card">
      <rect x="${cx}" y="${cy}" width="${cardW}" height="${cardH}" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1" rx="6"/>
      <text x="${cx + 14}" y="${cy + 30}" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold">${escapeXml(String(kpi.value))}<tspan font-size="12" fill="#64748b" font-weight="normal"> ${escapeXml(kpi.unit ?? '')}</tspan></text>
      <text x="${cx + 14}" y="${cy + 52}" fill="#64748b" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold">${escapeXml(kpi.label.toUpperCase())}</text>
    </g>`
  })

  // Equipment Breakdown Summary
  const kpiRows = Math.ceil(bom.kpis.length / kpiCols)
  const breakdownY = kpiStartY + kpiRows * (cardH + 10) + 16
  const breakdownW = (W - MARGIN * 2 - 16) / 2
  const breakdownH = 260

  coverSvg += `
  <rect x="${MARGIN}" y="${breakdownY}" width="${breakdownW}" height="${breakdownH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1" rx="4"/>
  <rect x="${MARGIN}" y="${breakdownY}" width="${breakdownW}" height="32" fill="#334155" rx="4"/>
  <text x="${MARGIN + 14}" y="${breakdownY + 21}" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold">EQUIPMENT CATEGORY BREAKDOWN</text>
  `

  let bRowY = breakdownY + 54
  bom.sections.slice(0, 7).forEach((sec) => {
    coverSvg += `
    <text x="${MARGIN + 14}" y="${bRowY}" fill="#1e293b" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="bold">${escapeXml(sec.title)}</text>
    <text x="${MARGIN + breakdownW - 14}" y="${bRowY}" fill="#0369a1" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="end">${sec.items.length} line items</text>
    <line x1="${MARGIN + 14}" y1="${bRowY + 8}" x2="${MARGIN + breakdownW - 14}" y2="${bRowY + 8}" stroke="#f1f5f9" stroke-width="1"/>
    `
    bRowY += 28
  })

  // Engineering Notes Box
  const notesX = MARGIN + breakdownW + 16
  coverSvg += `
  <rect x="${notesX}" y="${breakdownY}" width="${breakdownW}" height="${breakdownH}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" rx="4"/>
  <rect x="${notesX}" y="${breakdownY}" width="${breakdownW}" height="32" fill="#334155" rx="4"/>
  <text x="${notesX + 14}" y="${breakdownY + 21}" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold">ENGINEERING &amp; STRUCTURAL NOTES</text>
  `

  let noteY = breakdownY + 52
  bom.engineeringNotes.slice(0, 6).forEach((note) => {
    coverSvg += `
    <text x="${notesX + 14}" y="${noteY}" fill="#334155" font-family="Helvetica, Arial, sans-serif" font-size="9.5">${escapeXml(note)}</text>
    `
    noteY += 34
  })

  rawSheets.push({
    title: 'Cover & Installation Summary',
    contentSvg: coverSvg,
  })

  // ── Sheets 2+: Itemized Schedules ─────────────────────────────────────────
  const maxRowsPerSheet = 14
  const allItems: Array<{ sectionTitle: string; item: (typeof bom.sections)[0]['items'][0] }> = []
  bom.sections.forEach((sec) => {
    sec.items.forEach((item) => {
      allItems.push({ sectionTitle: sec.title, item })
    })
  })

  const totalItemSheets = Math.max(1, Math.ceil(allItems.length / maxRowsPerSheet))
  for (let sIdx = 0; sIdx < totalItemSheets; sIdx++) {
    const chunk = allItems.slice(sIdx * maxRowsPerSheet, (sIdx + 1) * maxRowsPerSheet)
    let schedSvg = ''

    // Table Header
    const tY = MARGIN + 10
    const tW = W - MARGIN * 2
    schedSvg += `
    <rect x="${MARGIN}" y="${tY}" width="${tW}" height="30" fill="#1e293b" rx="4"/>
    <text x="${MARGIN + 12}" y="${tY + 19}" fill="#f8fafc" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold">EQUIPMENT SYSTEM</text>
    <text x="${MARGIN + 180}" y="${tY + 19}" fill="#f8fafc" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold">ITEM / ROLE</text>
    <text x="${MARGIN + 360}" y="${tY + 19}" fill="#f8fafc" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold">SPECIFICATION / DIMENSIONS</text>
    <text x="${MARGIN + tW - 200}" y="${tY + 19}" fill="#f8fafc" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold" text-anchor="end">QUANTITY</text>
    <text x="${MARGIN + tW - 140}" y="${tY + 19}" fill="#f8fafc" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold" text-anchor="middle">UNIT</text>
    <text x="${MARGIN + tW - 80}" y="${tY + 19}" fill="#f8fafc" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold">NOTES</text>
    `

    let rY = tY + 36
    const rowH = 34
    chunk.forEach((row, rIdx) => {
      const isEven = rIdx % 2 === 0
      const bgFill = isEven ? '#ffffff' : '#f8fafc'
      schedSvg += `
      <g class="table-row">
        <rect x="${MARGIN}" y="${rY}" width="${tW}" height="${rowH}" fill="${bgFill}" stroke="#e2e8f0" stroke-width="0.5"/>
        <text x="${MARGIN + 12}" y="${rY + 21}" fill="#475569" font-family="Helvetica, Arial, sans-serif" font-size="10">${escapeXml(row.sectionTitle)}</text>
        <text x="${MARGIN + 180}" y="${rY + 21}" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold">${escapeXml(row.item.item)}</text>
        <text x="${MARGIN + 360}" y="${rY + 21}" fill="#334155" font-family="Helvetica, Arial, sans-serif" font-size="9.5">${escapeXml(row.item.specification)}</text>
        <text x="${MARGIN + tW - 200}" y="${rY + 21}" fill="#0f172a" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="end">${row.item.quantity.toLocaleString()}</text>
        <text x="${MARGIN + tW - 140}" y="${rY + 21}" fill="#64748b" font-family="Helvetica, Arial, sans-serif" font-size="10" text-anchor="middle">${escapeXml(row.item.unit)}</text>
        <text x="${MARGIN + tW - 80}" y="${rY + 21}" fill="#64748b" font-family="Helvetica, Arial, sans-serif" font-size="9" font-style="italic">${escapeXml(row.item.notes ?? '')}</text>
      </g>`
      rY += rowH
    })

    rawSheets.push({
      title: `BOM Schedule (Part ${sIdx + 1} of ${totalItemSheets})`,
      contentSvg: schedSvg,
    })
  }

  const totalCount = rawSheets.length
  return rawSheets.map((sh, idx) => {
    const titleBlock = titleBlockSvg(idx, totalCount, sh.title, bom, options)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <rect x="${MARGIN}" y="${MARGIN}" width="${W - MARGIN * 2}" height="${H - MARGIN * 2}" fill="none" stroke="#cbd5e1" stroke-width="1.5"/>
    ${sh.contentSvg}
    ${titleBlock}
    </svg>`
    return {
      title: sh.title,
      svg,
    }
  })
}
