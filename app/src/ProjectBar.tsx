// Which folder the app is managing, and how to change it.
//
// It sits above the table rather than in a settings pane because it changes
// the meaning of a column: "Active here" is a fact about a directory, and a
// directory the user cannot see is one they will get wrong.

import { useEffect, useRef, useState } from 'react'

import { abbreviate, basename } from './project'

interface Props {
  current: string | null
  recents: string[]
  home: string | null
  busy: boolean
  loading: boolean
  /** Per-folder activation, or null until a folder is chosen. */
  summary: string | null
  onPick: () => void
  onSelect: (dir: string) => void
  onForget: (dir: string) => void
}

export function ProjectBar({
  current,
  recents,
  home,
  busy,
  loading,
  summary,
  onPick,
  onSelect,
  onForget,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const others = recents.filter((r) => r !== current)

  return (
    <div className={`projectbar${current ? '' : ' unset'}`} ref={wrap}>
      <div className="projectbar-main">
        {current ? (
          <span className="projectbar-path mono" title={current}>
            {abbreviate(current, home)}
          </span>
        ) : (
          <span className="projectbar-path muted">
            none chosen — connections below are global, activation is per&#8209;folder
          </span>
        )}
        {summary && <p className="projectbar-meta muted">{summary}</p>}
      </div>
      {loading && <span className="spinner" aria-hidden="true" />}

      <div className="projectbar-actions">
        {others.length > 0 && (
          <button
            className="ghost"
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
          >
            Recent
            <svg
              className={`chevron${open ? ' open' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <button onClick={onPick} disabled={busy}>
          {current ? 'Switch' : 'Choose folder…'}
        </button>
      </div>

      {open && (
        <ul className="menu">
          {others.map((dir) => (
            <li key={dir}>
              <button
                className="menu-item"
                title={dir}
                onClick={() => {
                  setOpen(false)
                  onSelect(dir)
                }}
              >
                <span className="menu-name">{basename(dir)}</span>
                <span className="menu-path mono muted">{abbreviate(dir, home)}</span>
              </button>
              <button
                className="menu-forget"
                title="Remove from this list"
                aria-label={`Remove ${dir} from recents`}
                onClick={() => onForget(dir)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
