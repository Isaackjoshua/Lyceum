import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'

/**
 * Renders tutor prose: GitHub-flavoured markdown, KaTeX maths, and highlighted
 * code. Memoised because it re-renders on every streamed delta.
 */
export const Markdown = memo(function Markdown({
  children,
  className
}: {
  children: string
  className?: string
}): JSX.Element {
  return (
    <div className={cn('lyceum-prose', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: false }],
          [rehypeHighlight, { detect: true, ignoreMissing: true }]
        ]}
        components={{
          // Links are inert in the transcript; the main process opens externals.
          a: ({ children: text, href }) => (
            <a
              href={href}
              onClick={(e) => e.preventDefault()}
              className="text-accent underline underline-offset-2"
            >
              {text}
            </a>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
