import DOMPurify from 'dompurify'
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
 * Fallback sanitizer for headless / Node.js / Bun / Next.js SSR environments where
 * DOMPurify cannot attach to a global DOM window.
 *
 * Strips script tags, embedded objects/iframes, inline event handlers,
 * dangerous URI schemes, and XML entity injections while preserving valid SVG vector elements.
 */
export function sanitizeSvg(svg: string): string {
  if (typeof DOMPurify !== 'undefined') {
    if (typeof (DOMPurify as any).sanitize === 'function') {
      return (DOMPurify as any).sanitize(svg, { USE_PROFILES: { svg: true } })
    }
    if (typeof DOMPurify === 'function' && typeof window !== 'undefined') {
      try {
        const instance = (DOMPurify as unknown as (w: Window) => typeof DOMPurify)(window)
        if (typeof (instance as any)?.sanitize === 'function') {
          return (instance as any).sanitize(svg, { USE_PROFILES: { svg: true } })
        }
      } catch {
        // Fall through to headless sanitizer
      }
    }
  }

  return sanitizeSvgHeadless(svg)
}

function sanitizeSvgHeadless(rawSvg: string): string {
  let cleaned = rawSvg

  // 1. Strip XML DOCTYPE and ENTITY declarations to prevent XXE / entity expansions
  cleaned = cleaned.replace(/<!DOCTYPE[\s\S]*?>/gi, '')
  cleaned = cleaned.replace(/<!ENTITY[\s\S]*?>/gi, '')

  // 2. Strip <script> tags and all contents within <script>...</script> (including CDATA)
  cleaned = cleaned.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
  cleaned = cleaned.replace(/<script\b[^>]*>/gi, '')

  // 3. Strip <foreignObject> tags and their entire contents
  cleaned = cleaned.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
  cleaned = cleaned.replace(/<foreignObject\b[^>]*>/gi, '')

  // 4. Strip dangerous embedded elements: iframe, object, embed, applet, meta, link, base, form, input, audio, video
  cleaned = cleaned.replace(
    /<(?:iframe|object|embed|applet|meta|link|base|form|input|audio|video)\b[\s\S]*?<\/(?:iframe|object|embed|applet|meta|link|base|form|input|audio|video)\s*>/gi,
    '',
  )
  cleaned = cleaned.replace(
    /<(?:iframe|object|embed|applet|meta|link|base|form|input|audio|video)\b[^>]*>/gi,
    '',
  )

  // 5. Strip inline event handler attributes (e.g., onload, onerror, onbegin, onend, onclick, onmouseover, etc.)
  cleaned = cleaned.replace(/\s+on[a-zA-Z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  // 6. Strip javascript: / vbscript: / data:text/html URI schemes in attributes
  cleaned = cleaned.replace(
    /\s+(?:xlink:)?href\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|[^\s>]*javascript:[^\s>]*)/gi,
    '',
  )
  cleaned = cleaned.replace(
    /\s+(?:xlink:)?href\s*=\s*(?:"\s*vbscript:[^"]*"|'\s*vbscript:[^']*'|[^\s>]*vbscript:[^\s>]*)/gi,
    '',
  )
  cleaned = cleaned.replace(
    /\s+(?:xlink:)?href\s*=\s*(?:"\s*data:text\/(?:html|javascript)[^"]*"|'\s*data:text\/(?:html|javascript)[^']*')/gi,
    '',
  )
  cleaned = cleaned.replace(
    /\s+src\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|[^\s>]*javascript:[^\s>]*)/gi,
    '',
  )
  cleaned = cleaned.replace(
    /\s+src\s*=\s*(?:"\s*vbscript:[^"]*"|'\s*vbscript:[^']*'|[^\s>]*vbscript:[^\s>]*)/gi,
    '',
  )
  cleaned = cleaned.replace(
    /\s+src\s*=\s*(?:"\s*data:text\/(?:html|javascript)[^"]*"|'\s*data:text\/(?:html|javascript)[^']*')/gi,
    '',
  )

  // 7. Strip SMIL animation handler manipulations
  cleaned = cleaned.replace(
    /\s+attributeName\s*=\s*(?:"on[a-zA-Z0-9_-]+"|'on[a-zA-Z0-9_-]+')/gi,
    '',
  )
  cleaned = cleaned.replace(
    /\s+to\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|"[^"]*alert\([^"]*"|'[^']*alert\([^']*')/gi,
    '',
  )
  cleaned = cleaned.replace(
    /\s+values\s*=\s*(?:"[^"]*javascript:[^"]*"|'[^']*javascript:[^']*')/gi,
    '',
  )

  // 8. Strip any remaining javascript: literals
  cleaned = cleaned.replace(/javascript\s*:\s*/gi, '')

  return cleaned
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
  const pages = sheets
    .map((s) => `<section class="sheet">${sanitizeSvg(s.svg)}</section>`)
    .join('\n')

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
