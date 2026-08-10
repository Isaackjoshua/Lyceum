import { describe, expect, it } from 'vitest'
import { buildHtml, escapeHtml, renderMath } from '../src/main/pdf/render.js'

describe('renderMath', () => {
  it('renders display maths through KaTeX', () => {
    const html = renderMath('Before\n\n$$E = mc^2$$\n\nAfter')
    expect(html).toContain('katex')
    expect(html).not.toContain('$$')
  })

  it('renders inline maths', () => {
    const html = renderMath('The value $x^2$ grows.')
    expect(html).toContain('katex')
    expect(html).not.toMatch(/\$x\^2\$/)
  })

  it('leaves dollar signs inside fenced code alone', () => {
    const html = renderMath('```bash\n$ echo $HOME\n```')
    expect(html).toContain('echo')
    expect(html).not.toContain('katex')
  })

  it('leaves dollar signs inside inline code alone', () => {
    const html = renderMath('Run `$PATH` to see it.')
    expect(html).toContain('$PATH')
    expect(html).not.toContain('katex')
  })

  it('does not throw on malformed maths', () => {
    expect(() => renderMath('$\\frac{1}{$')).not.toThrow()
  })

  it('still renders ordinary markdown', () => {
    const html = renderMath('# Title\n\n- one\n- two\n\n**bold**')
    expect(html).toContain('<h1>')
    expect(html).toContain('<li>')
    expect(html).toContain('<strong>')
  })
})

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    )
  })
})

describe('buildHtml', () => {
  const doc = {
    title: 'The chain rule',
    subtitle: 'Backpropagation from scratch',
    meta: ['Machine learning', '2 of 3 objectives met'],
    sections: [
      { heading: 'Summary', body: 'The chain rule composes derivatives: $f(g(x))$.' },
      { heading: 'Your notes', body: '- A note' }
    ]
  }

  it('produces a standalone document', () => {
    const html = buildHtml(doc)
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('</html>')
    // No external references: everything is inlined.
    expect(html).not.toMatch(/<link[^>]+href=/)
    expect(html).not.toMatch(/src="https?:/)
  })

  it('includes a cover, a table of contents and every section', () => {
    const html = buildHtml(doc)
    expect(html).toContain('class="cover"')
    expect(html).toContain('class="toc"')
    expect(html).toContain('Summary')
    expect(html).toContain('Your notes')
    expect(html).toContain('Backpropagation from scratch')
  })

  it('escapes headings and titles', () => {
    const html = buildHtml({
      ...doc,
      title: '<img onerror=x>',
      sections: [{ heading: '<b>h</b>', body: 'ok' }]
    })
    expect(html).toContain('&lt;img onerror=x&gt;')
    expect(html).toContain('&lt;b&gt;h&lt;/b&gt;')
  })

  it('inlines KaTeX fonts as data URIs', () => {
    const html = buildHtml(doc)
    expect(html).toContain('data:font/woff2;base64,')
  })
})
