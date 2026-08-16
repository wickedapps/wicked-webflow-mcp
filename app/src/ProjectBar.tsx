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
  onPick: () => void
  onSelect: (dir: string) => void
  onForget: (dir: string) => void
}

export function ProjectBar({
  current,
  recents,
  home,
  busy,
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
      <span className="projectbar-label">Project</span>

      {current ? (
        <span className="projectbar-path mono" title={current}>
          {abbreviate(current, home)}
        </span>
      ) : (
        <span className="projectbar-path muted">
          none chosen — connections below are global, activation is per&#8209;folder
        </span>
      )}

      <div className="projectbar-actions">
        {others.length > 0 && (
          <button className="ghost" onClick={() => setOpen((v) => !v)} disabled={busy}>
            Recent ▾
          </button>
        )}
        <button onClick={onPick} disabled={busy}>
          {current ? 'Change…' : 'Choose folder…'}
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
