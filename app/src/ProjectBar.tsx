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
  /** Connections waiting to be enabled once a folder is chosen. */
  ready: number
  onPick: () => void
  onSelect: (dir: string) => void
  onForget: (dir: string) => void
  /** Shown when this folder's set is remembered in plugin state, not default. */
  onReset?: () => void
}

export function ProjectBar({
  current,
  recents,
  home,
  busy,
  loading,
  summary,
  ready,
  onPick,
  onSelect,
  onForget,
  onReset,
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

  const others = recents.filter((r) => r !== current).slice(0, 4)

  useEffect(() => {
    if (others.length === 0) setOpen(false)
  }, [others.length])

  return (
    <div className={`projectbar${current ? '' : ' unset'}`} ref={wrap}>
      <div className="projectbar-main">
        {current ? (
          <h2 className="pane-heading projectbar-path" title={current}>
            {abbreviate(current, home)}
          </h2>
        ) : (
          <h2 className="pane-heading">No folder selected</h2>
        )}
        {current ? (
          summary && <p className="projectbar-meta muted">{summary}</p>
        ) : (
          <p className="projectbar-hint muted">
            {ready === 1
              ? '1 connection is ready. Pick a folder to enable it there.'
              : `${ready} connections are ready. Pick a folder to choose which load there.`}
          </p>
        )}
      </div>
      {loading && <span className="spinner" aria-hidden="true" />}

      <div className="projectbar-actions">
        {onReset && (
          <button
            className="ghost"
            disabled={busy}
            title="Forget this folder's remembered set. Every connection loads here, including ones added later."
            onClick={onReset}
          >
            Reset to default
          </button>
        )}
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
        <button className={current ? undefined : 'primary'} onClick={onPick} disabled={busy}>
          {current ? 'Switch' : 'Choose folder…'}
        </button>
      </div>

      {open && others.length > 0 && (
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
