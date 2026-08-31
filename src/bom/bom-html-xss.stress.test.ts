import { describe, expect, test } from 'bun:test'
import { generateWarehouseBomHtml } from './bom-html'
import type { BomSheet } from './types'

describe('Warehouse BOM HTML SVG9XSS Sanitization Stress Test', () => {
  const maliciousVectors = [
    {
      name: 'Direct script tag',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS_TAG")</script><rect width="100" height="100"/></svg>',
      forbidden: ['<script', 'alert("XSS_TAG")', 'alert('],
    },
    {
      name: 'Inline onload event handler',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle cx="50" cy="50" r="40"/></svg>',
      forbidden: ['onload=', 'onload =', 'alert(1'],
    },
    {
      name: 'Inline onerror event handler',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="alert(2)"/></svg>',
      forbidden: ['onerror=', 'onerror =', 'alert(2)'],
    },
    {
      name: 'foreignObject with embedded XHTML script and iframe',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="200" height="200"><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(3)</script><iframe src="javascript:alert(4)"></iframe></body></foreignObject></svg>',
      forbidden: ['<script', '<iframe', 'javascript:', 'alert(3)', 'alert(4)'],
    },
    {
      name: 'Anchor tag with javascript: URI',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(5)"><text>Click</text></a></svg>',
      forbidden: ['javascript:alert(5)', 'javascript:'],
    },
    {
      name: 'SVG SMIL animate and set execution handlers',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><animate onbegin="alert(6)"/><set attributeName="onmouseover" to="alert(7)"/></svg>',
      forbidden: ['onbegin=', 'alert(6)', 'alert(7)'],
    },
    {
      name: 'CDATA wrapped executable script',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script><![CDATA[�alert(8)]]></script></svg>',
      forbidden: ['<script', 'alert(8)'],
    },
  ]

  for (const vec of maliciousVectors) {
    test(`DOM Purify strips ${vec.name}`, () => {
      const sheet: BomSheet = {
        title: `Security Stress Test - ${vec.name}`,
        svg: vec.svg,
      }

      const html = generateWarehouseBomHtml([sheet], { title: 'BOM XSS Test' })

      for (const pattern of vec.forbidden) {
        expect(html.toLowerCase().includes(pattern.toLowerCase())).toBe(false)
      }
    })
  }

  test('preserves legitimate SVG vector graphics (rects, text, paths, tables)', () => {
    const validSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><g id="title-block"><text x="50" y="50">SHEET 1/1</text><rect x="10" y="10" width="980" height="780" fill="none" stroke="#000"/></g></svg>'
    const sheet: BomSheet = {
      title: 'Valid Sheet',
      svg: validSvg,
    }

    const html = generateWarehouseBomHtml([sheet])
    expect(html).toContain('SHEET 1/1')
    expect(html).toContain('<svg')
    expect(html).toContain('<rect')
    expect(html).toContain('<!doctype html>')
  })
})
