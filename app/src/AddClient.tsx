// The Add-client form.
//
// This was a window.prompt(), which the webview does not implement — the
// button did nothing at all. It also could not have shown the one thing worth
// showing: what the typed name turns into. Slugification is silent, and the
// result becomes a tool-name prefix in every session, so it is worth seeing
// before it is committed to.

import { useState } from 'react'

import { slugify, validateSlug } from './wwm'

interface Props {
  /** Existing server names, for catching a collision before the CLI exits 4. */
  taken: string[]
  busy: boolean
  onCancel: () => void
  onSubmit: (slug: string, label: string) => void
}

export function AddClient({ taken, busy, onCancel, onSubmit }: Props) {
  const [name, setName] = useState('')

  // The prefix is configurable (CLAUDE_PLUGIN_OPTION_PREFIX), and `status`
  // does not report it, so infer it from what already exists. This is only the
  // preview string — the CLI names the server, and its answer is what lands.
  const pfx = taken[0]?.match(/^[a-z0-9]+-/)?.[0] ?? 'wf-'

  const slug = slugify(name)
  const server = pfx + slug
  const problem = name.trim() === '' ? null : validateSlug(slug)
  const collides = !problem && slug !== '' && taken.includes(server)
  const ready = slug !== '' && !problem && !collides && !busy

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (ready) onSubmit(slug, name.trim())
  }

  return (
    <div className="sheet">
      <form className="sheet-card narrow" onSubmit={submit}>
        <header>
          <div>
            <h2>Add a new connection</h2>
            <p className="muted">
              Registers a new Webflow connection under its own name, so it gets its own
              authorization. Existing connections stay authorized.
            </p>
          </div>
        </header>

        <label className="field">
          <span>Connection name</span>
          <input
            autoFocus
            value={name}
            placeholder="Dino Studios"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          {slug !== '' && (
            <p className={problem || collides ? 'error' : 'muted mono preview'}>
              {problem
                ? `That name is ${problem}.`
                : collides
                  ? 'Connection with the same name already exists'
                  : `→ creates ${server}`}
            </p>
          )}
        </label>

        <footer className="sheet-foot">
          <p className="muted">
            You will be asked to authorize it next, in a terminal window here.
          </p>
          <div className="actions">
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={!ready}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}
