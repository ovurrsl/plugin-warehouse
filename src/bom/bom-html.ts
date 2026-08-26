import type { BomDocumentOptions, BomSheet } from './types'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Self-contained printable HTML document generator for the Warehouse Bill of Materials.
 *
 * Designed for browser printing via Print -> Save as PDF.
 */
export function generateWarehouseBomHtml(
  sheets: BomSheet[],
  options: BomDocumentOptions = {},
): string {
  const title = options.title ?? 'Warehouse Installation Bill of Materials'
  const pages = sheets.map((s) => `<section class="sheet">${s.svg}</section>`).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: letter landscape;
      margin: 0;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #475569;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .print-hint {
      background: #0f172a;
      color: #f8fafc;
      font-size: 13px;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .print-hint strong {
      color: #38bdf8;
    }
    .sheet {
      width: 1056px;
      height: 816px;
      margin: 16px auto;
      background: #ffffff;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      page-break-after: always;
      break-after: page;
    }
    .sheet svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    @media print {
      body {
        background: #ffffff;
      }
      .print-hint {
        display: none !important;
      }
      .sheet {
        margin: 0;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <aside class="print-hint">
    <span>💡 <strong>Pascal Warehouse Engine</strong> — Print (Ctrl+P / ⌘P) &rarr; Select "Save as PDF" to export the plan set.</span>
    <span>${sheets.length} Sheet${sheets.length === 1 ? '' : 's'} Generated</span>
  </aside>
  ${pages}
</body>
</html>`
}
