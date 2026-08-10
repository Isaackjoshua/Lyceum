// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitiseSvg } from '../src/renderer/lib/sanitiseSvg.js'

/**
 * The tutor's diagrams are model output injected into the DOM, so this policy
 * is the barrier that has to hold. These tests are the regression net for it.
 */
describe('sanitiseSvg', () => {
  it('keeps ordinary drawing elements', () => {
    const clean = sanitiseSvg(
      '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="4" height="4" fill="#b07d4e"/><text x="2" y="8">input</text></svg>'
    )
    expect(clean).toContain('<rect')
    expect(clean).toContain('<text')
    expect(clean).toContain('input')
    expect(clean).toContain('#b07d4e')
  })

  it('strips script tags', () => {
    const clean = sanitiseSvg('<svg><script>window.pwned = 1</script><rect/></svg>')
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('window.pwned')
    expect(clean).toContain('<rect')
  })

  it('strips inline event handlers', () => {
    const clean = sanitiseSvg(
      '<svg><rect onload="pwn()" onclick="pwn()" onerror="pwn()" fill="red"/></svg>'
    )
    expect(clean).not.toMatch(/onload|onclick|onerror/i)
    expect(clean).toContain('fill="red"')
  })

  it('strips foreignObject, the HTML escape hatch inside SVG', () => {
    const clean = sanitiseSvg(
      '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="pwn()"></body></foreignObject></svg>'
    )
    expect(clean.toLowerCase()).not.toContain('foreignobject')
    expect(clean).not.toContain('onerror')
  })

  it('strips remote references', () => {
    const clean = sanitiseSvg(
      '<svg><image href="https://evil.example/t.png" x="0" y="0"/><use href="#x"/></svg>'
    )
    expect(clean).not.toContain('evil.example')
    expect(clean.toLowerCase()).not.toContain('<image')
    expect(clean.toLowerCase()).not.toContain('<use')
  })

  it('strips links and navigation attributes', () => {
    const clean = sanitiseSvg(
      '<svg><a href="https://evil.example"><text>click</text></a></svg>'
    )
    expect(clean).not.toContain('evil.example')
    expect(clean).not.toContain('href')
  })

  it('strips javascript: URLs', () => {
    const clean = sanitiseSvg('<svg><a xlink:href="javascript:pwn()"><rect/></a></svg>')
    expect(clean.toLowerCase()).not.toContain('javascript:')
  })

  it('strips iframes', () => {
    const clean = sanitiseSvg('<svg><iframe src="https://evil.example"></iframe></svg>')
    expect(clean.toLowerCase()).not.toContain('<iframe')
  })

  it('survives malformed markup without throwing', () => {
    expect(() => sanitiseSvg('<svg><rect')).not.toThrow()
    expect(() => sanitiseSvg('not markup at all')).not.toThrow()
    expect(() => sanitiseSvg('')).not.toThrow()
  })

  it('keeps a mermaid-shaped graph intact, labels included', () => {
    // Mermaid with htmlLabels:false emits <text>/<tspan>, not foreignObject —
    // this asserts the combination the renderer actually relies on.
    const clean = sanitiseSvg(
      '<svg><g class="node"><rect class="basic label-container"/><g class="label"><text><tspan>g(x)</tspan></text></g></g><path class="edgePath" d="M0,0L10,10"/></svg>'
    )
    expect(clean).toContain('g(x)')
    expect(clean).toContain('<tspan')
    expect(clean).toContain('<path')
  })
})
