import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { VisualPayload } from '@shared/types'
import { sanitiseSvg } from '@/lib/sanitiseSvg'
import { WidgetFrame } from '@/components/WidgetFrame'

/**
 * Renders a tutor-authored diagram inline.
 *
 * Everything here is model output, so it is treated as untrusted markup:
 *   - SVG is sanitised by `sanitiseSvg`, which strips <script>, event handlers,
 *     <foreignObject> and anything that can navigate or fetch. That policy
 *     lives in its own module so it can be unit tested.
 *   - Mermaid runs with securityLevel 'strict' (its own HTML sanitiser, and
 *     click/script directives disabled), and its SVG output is sanitised again
 *     on the way in.
 *   - Interactive HTML runs in a sandboxed, opaque-origin iframe with its own
 *     CSP — see WidgetFrame. It is never sanitised and injected inline,
 *     because interactivity needs script, and script needs isolation.
 * The app's CSP already forbids remote loads, so this is defence in depth
 * rather than the only barrier.
 */

let mermaidReady: Promise<typeof import('mermaid').default> | null = null

/** Mermaid is ~500KB; load it only when a diagram actually appears. */
async function loadMermaid(dark: boolean): Promise<typeof import('mermaid').default> {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'neutral',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        // Mermaid puts node and edge labels inside <foreignObject> by default,
        // which the sanitiser strips — leaving empty boxes. Rendering labels
        // as native <text> keeps foreignObject forbidden AND keeps the labels.
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        class: { htmlLabels: false }
      })
      return mod.default
    })
  }
  return mermaidReady
}

export function VisualRenderer({ visual }: { visual: VisualPayload }): JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const isWidget = visual.format === 'html'
  const [error, setError] = useState<string | null>(null)
  const idBase = useId().replace(/[^a-zA-Z0-9]/g, '')
  const cancelled = useRef(false)

  useEffect(() => {
    if (visual.format === 'html') return
    cancelled.current = false

    const run = async (): Promise<void> => {
      try {
        if (visual.format === 'svg') {
          const clean = sanitiseSvg(visual.code)
          if (!clean.trim()) throw new Error('The diagram was empty after sanitising.')
          if (!cancelled.current) setHtml(clean)
          return
        }

        if (visual.format === 'mermaid') {
          const dark = document.documentElement.classList.contains('dark')
          const mermaid = await loadMermaid(dark)
          const { svg } = await mermaid.render(`m${idBase}`, visual.code)
          const clean = sanitiseSvg(svg)
          if (!cancelled.current) setHtml(clean)
          return
        }

        throw new Error(`Unsupported diagram format: ${String(visual.format)}`)
      } catch (err) {
        if (!cancelled.current) setError((err as Error).message)
      }
    }

    void run()
    return () => {
      cancelled.current = true
    }
  }, [visual.code, visual.format, idBase])

  if (error) {
    return (
      <figure className="my-4 rounded-md border border-dashed p-4">
        <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          The tutor sent a diagram that could not be drawn ({error})
        </figcaption>
      </figure>
    )
  }

  if (isWidget) {
    return (
      <figure className="my-4 overflow-hidden rounded-md border bg-card">
        <WidgetFrame code={visual.code} />
        {visual.caption && (
          <figcaption className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
            {visual.caption}
          </figcaption>
        )}
      </figure>
    )
  }

  return (
    <figure className="my-4 overflow-x-auto rounded-md border bg-card p-4">
      {html ? (
        <div
          className="lyceum-visual flex justify-center"
          // Sanitised immediately above; see the note at the top of this file.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="h-24 animate-pulse rounded bg-secondary/60" />
      )}
      {visual.caption && (
        <figcaption className="mt-2.5 text-center text-xs text-muted-foreground">
          {visual.caption}
        </figcaption>
      )}
    </figure>
  )
}
