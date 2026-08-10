import { useEffect, useRef, useState } from 'react'

/**
 * Runs a tutor-authored interactive widget inside a hostile-by-default iframe.
 *
 * The isolation rests on three independent things:
 *
 *  1. `sandbox="allow-scripts"` WITHOUT `allow-same-origin`. This is the load
 *     bearing one: the frame gets a unique opaque origin, so it cannot touch
 *     `window.parent`, read the app's storage, or reach any same-origin API.
 *     Never add `allow-same-origin` here — combined with `allow-scripts` it
 *     lets the frame remove its own sandbox attribute.
 *  2. A CSP inside the document that permits inline script and style and
 *     nothing else. No network of any kind: no fetch, no XHR, no websockets,
 *     no remote images or fonts.
 *  3. The app's own top-level CSP, which already forbids remote origins.
 *
 * Height is negotiated over postMessage. The frame is the only thing that
 * knows its content height, and it cannot resize itself.
 */

const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  // Belt and braces: the opaque origin already blocks these.
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

/** Reports content height to the host, and nothing else. */
const HEIGHT_REPORTER = `
<script>
  (function () {
    var last = 0;
    function report() {
      var h = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      );
      if (h !== last) { last = h; parent.postMessage({ type: 'lyceum:height', height: h }, '*'); }
    }
    window.addEventListener('load', report);
    window.addEventListener('resize', report);
    if (window.ResizeObserver && document.documentElement) {
      new ResizeObserver(report).observe(document.documentElement);
    }
    setInterval(report, 500);
  })();
</script>`

const BASE_STYLE = `
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 14px; line-height: 1.5;
    padding: 12px;
    background: transparent;
    color: CanvasText;
  }
</style>`

function buildDocument(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">
${BASE_STYLE}
</head><body>
${code}
${HEIGHT_REPORTER}
</body></html>`
}

const MIN_HEIGHT = 80
const MAX_HEIGHT = 640

export function WidgetFrame({ code }: { code: string }): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(160)

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      // The frame has an opaque origin, so `event.origin` is "null" and cannot
      // be used to authenticate it. Match on the source window instead, which
      // a different frame cannot forge.
      if (event.source !== frameRef.current?.contentWindow) return

      const data = event.data as { type?: unknown; height?: unknown }
      if (data?.type !== 'lyceum:height') return

      const reported = Number(data.height)
      if (!Number.isFinite(reported)) return
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(reported))))
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <iframe
      ref={frameRef}
      title="Interactive widget"
      // Deliberately no allow-same-origin — see the note at the top.
      sandbox="allow-scripts"
      srcDoc={buildDocument(code)}
      className="w-full rounded border-0 bg-transparent"
      style={{ height }}
    />
  )
}
