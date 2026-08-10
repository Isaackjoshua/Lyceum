import type { ReactNode } from 'react'

interface PlaceholderProps {
  icon: ReactNode
  title: string
  body: string
  phase: string
}

/** Honest stub for screens that arrive in a later phase. */
export function Placeholder({ icon, title, body, phase }: PlaceholderProps): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-8 w-8 items-center justify-center text-muted-foreground">
          {icon}
        </div>
        <h1 className="mt-4 font-serif text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground/70">
          {phase}
        </p>
      </div>
    </div>
  )
}
