import { useCallback, useEffect, useState } from 'react'
import { BookmarkPlus } from 'lucide-react'

export interface Selection {
  text: string
  x: number
  y: number
  messageId: number
}

/**
 * Floating "save note" affordance that follows a text selection inside an
 * assistant message.
 *
 * Selection is read from the DOM rather than tracked in React state because
 * the transcript re-renders on every streamed delta.
 */
export function useSelectionCapture(containerRef: React.RefObject<HTMLElement>): {
  selection: Selection | null
  clear: () => void
} {
  const [selection, setSelection] = useState<Selection | null>(null)

  const clear = useCallback(() => setSelection(null), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onMouseUp = (): void => {
      // Defer so the browser has committed the selection.
      window.setTimeout(() => {
        const domSelection = window.getSelection()
        const text = domSelection?.toString().trim() ?? ''

        if (!domSelection || domSelection.isCollapsed || text.length < 3) {
          setSelection(null)
          return
        }

        const anchor = domSelection.anchorNode
        if (!anchor || !container.contains(anchor)) {
          setSelection(null)
          return
        }

        const element =
          anchor.nodeType === Node.ELEMENT_NODE
            ? (anchor as Element)
            : anchor.parentElement
        const host = element?.closest<HTMLElement>('[data-message-id]')
        if (!host) {
          setSelection(null)
          return
        }

        const rect = domSelection.getRangeAt(0).getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()

        setSelection({
          text,
          messageId: Number(host.dataset.messageId),
          x: rect.left + rect.width / 2 - containerRect.left,
          y: rect.top - containerRect.top
        })
      }, 0)
    }

    const onScroll = (): void => setSelection(null)

    container.addEventListener('mouseup', onMouseUp)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('mouseup', onMouseUp)
      container.removeEventListener('scroll', onScroll)
    }
  }, [containerRef])

  return { selection, clear }
}

export function SelectionToolbar({
  selection,
  onSave
}: {
  selection: Selection
  onSave: () => void
}): JSX.Element {
  return (
    <div
      className="absolute z-30 -translate-x-1/2 -translate-y-full pb-2"
      style={{ left: selection.x, top: selection.y }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSave}
        className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium shadow-lg hover:bg-secondary"
      >
        <BookmarkPlus className="h-3.5 w-3.5 text-accent" />
        Save note
      </button>
    </div>
  )
}
