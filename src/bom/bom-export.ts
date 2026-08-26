import { generateWarehouseBomHtml } from './bom-html'
import { generateWarehouseBomPdf } from './bom-pdf'
import { generateWarehouseBomSheets } from './bom-sheets'
import type { BomDocumentOptions, WarehouseBOM } from './types'

/**
 * Triggers a file download in the browser environment.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Generates and downloads the binary PDF Bill of Materials report in the browser.
 */
export async function exportWarehouseBomPdf(
  bom: WarehouseBOM,
  filename?: string,
  options: BomDocumentOptions = {},
): Promise<void> {
  const bytes = await generateWarehouseBomPdf(bom, options)
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
  const defaultName = `Warehouse_BOM_${bom.zoneName ? `${bom.zoneName}_` : ''}${bom.date}.pdf`
  downloadBlob(blob, filename ?? defaultName)
}

/**
 * Generates and opens a printable multi-sheet HTML window for the Bill of Materials.
 */
export function exportWarehouseBomHtml(bom: WarehouseBOM, options: BomDocumentOptions = {}): void {
  if (typeof window === 'undefined') return
  const sheets = generateWarehouseBomSheets(bom, options)
  const html = generateWarehouseBomHtml(sheets, options)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
