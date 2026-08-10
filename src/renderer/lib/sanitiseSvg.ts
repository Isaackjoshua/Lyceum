import DOMPurify from 'dompurify'

/**
 * Sanitiser for tutor-authored diagrams.
 *
 * Everything passed through here is model output being injected into the DOM,
 * so this is the barrier that has to hold. Kept in its own module so the
 * policy is unit-testable rather than buried in a component.
 *
 * What gets removed, and why:
 *   - `script`            — arbitrary code execution.
 *   - `foreignObject`     — an HTML escape hatch inside SVG.
 *   - `iframe`            — embedded browsing context.
 *   - `image` / `use`     — can reference remote or local URLs.
 *   - `a` + href/xlink    — navigation out of the app.
 *   - every `on*` handler — DOMPurify strips these by default; the explicit
 *                           list documents intent and survives config drift.
 *
 * The app's CSP already blocks remote loads and inline script, so this is
 * defence in depth rather than the only barrier.
 */
export const SVG_SANITISE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'a', 'use', 'image'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'href', 'xlink:href']
}

export function sanitiseSvg(markup: string): string {
  return DOMPurify.sanitize(markup, SVG_SANITISE_CONFIG)
}
