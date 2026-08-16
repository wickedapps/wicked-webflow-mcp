import { useCallback, useEffect, useState } from 'react'

import { AddClient } from './AddClient'
import { LoginTerminal } from './LoginTerminal'
import { ProjectBar } from './ProjectBar'
import * as projects from './project'
import * as wwm from './wwm'

const HEALTH_LABEL: Record<wwm.Health, string> = {
  connected: 'connected',
  needs_auth: 'needs auth',
  failed: 'failed',
  pending_approval: 'pending approval',
  unknown: 'unknown',
}

function relative(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Sites the last verify found — or an honest absence.
 *
 * `sites: null` means never verified, which is not the same as verified and
 * fine. The CLI and the skills are both careful about this; so is the UI.
 */
function Sites({ row }: { row: wwm.ServerRow }) {
  if (row.verifyFailed) return <span className="bad">last verify failed</span>
  if (row.sites === null) return <span className="muted">unverified</span>
  if (row.sites.length === 0) return <span className="warn">no sites</span>
  return (
    <span>
      {row.sites.join(', ')} <span className="muted">({relative(row.verifiedAt)})</span>
    </span>
  )
}

function applyActive(data: wwm.StatusResult, active: string[]): wwm.StatusResult {
  const set = new Set(active)
  return {
    ...data,
    servers: data.servers.map((s) => ({ ...s, active: set.has(s.server) })),
  }
}

/** Fold a `switch --json` payload into the table so a toggle does not wait on `mcp list`. */
function applySwitch(data: wwm.StatusResult, res: wwm.SwitchResult): wwm.StatusResult {
  const next = applyActive(data, res.active)
  return {
    ...next,
    activation: {
      ...next.activation,
      fileConflict: res.fileConflict,
      connectorsSuppressed:
        res.connector === 'suppressed'
          ? true
          : res.connector === 'restored'
            ? false
            : next.activation.connectorsSuppressed,
    },
  }
}

export default function App() {
  const [located, setLocated] = useState<wwm.Located | null>(null)
  const [data, setData] = useState<wwm.StatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [login, setLogin] = useState<{ server: string; label: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [store, setStore] = useState<projects.Projects>(() => projects.load())

  const project = store.current

  const refresh = useCallback(async (dir: wwm.Project, hard = false) => {
    setBusy('Loading')
    try {
      setData(await wwm.status(dir, hard))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        setLocated(await wwm.locate())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      }
      await refresh(projects.load().current)
    })()
  }, [refresh])

  /**
   * Run something, then re-read status from cache.
   *
   * `--refresh` is the Refresh button: it forces `claude mcp list`, which
   * health-checks every configured server. After a mutation the CLI has
   * already invalidated or updated what changed; a live list is a freeze,
   * not a correctness requirement.
   */
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what)
    try {
      await fn()
      setError(null)
      setData(await wwm.status(project, false))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  /**
   * Open a folder: read its status first, adopt it only if that worked.
   *
   * A recents entry can point at a folder that has since been deleted or lives
   * on an unmounted volume, and switching to it would then silently write a
   * disable list somewhere else. The status call is the existence check.
   */
  const useProject = async (dir: string) => {
    setBusy('Loading')
    try {
      const next = await wwm.status(dir, false)
      setData(next)
      setError(null)
      // Remember the path the CLI resolved, not the one the picker returned:
      // ~/.claude.json is keyed on the realpath (/tmp → /private/tmp), and the
      // displayed folder should be the one that gets written.
      setStore(projects.select(next.cwd))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const pickProject = async () => {
    try {
      const dir = await projects.pick(project)
      if (dir) await useProject(dir)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toggle = (row: wwm.ServerRow) => {
    if (!data || !project || busy) return
    const next = data.servers
      .filter((s) => (s.server === row.server ? !s.active : s.active))
      .map((s) => s.server)
    const previous = data
    // switch replaces the whole active set; it is not a per-server flag.
    // Flip now — switch itself is a JSON write, and waiting on a status
    // reread would make the checkbox look like it ignored the click.
    setData(applyActive(data, next))
    setBusy('Switching')
    void (async () => {
      try {
        const res = await wwm.switchTo(project, next)
        setData((cur) => (cur ? applySwitch(cur, res) : cur))
        setError(null)
      } catch (e) {
        setData(previous)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    })()
  }

  const addClient = (slug: string, label: string) =>
    void (async () => {
      setBusy('Connecting')
      try {
        const res = await wwm.connect(project, slug, label)
        setError(null)
        setAdding(false)
        // Open the pty immediately. connect already ran a live `mcp list`
        // (collision check) and then invalidated that cache, so a status
        // reread here would health-check every server again — and could
        // overwrite a toggle the user made while the sheet was open.
        setData((cur) => {
          if (!cur || cur.servers.some((s) => s.server === res.server)) return cur
          return {
            ...cur,
            servers: [
              ...cur.servers,
              {
                server: res.server,
                label: res.label || label,
                health: 'needs_auth',
                statusText: 'Needs authentication',
                sites: null,
                workspaceIds: [],
                singleSite: null,
                verifiedAt: null,
                verifyFailed: false,
                active: true,
              },
            ],
          }
        })
        setLogin({ server: res.server, label: res.label || label })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    })()

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Wicked Webflow MCP Manager</h1>
          {data && (
            <p className="muted">
              {data.servers.length} connection{data.servers.length === 1 ? '' : 's'}
              {project && (
                <>
                  {' '}
                  &middot; {data.servers.filter((s) => s.active).length} active here (from{' '}
                  {data.activation.source})
                </>
              )}
            </p>
          )}
        </div>
        <div className="actions">
          <button onClick={() => setAdding(true)} disabled={busy !== null}>
            Add client
          </button>
          <button onClick={() => void refresh(project, true)} disabled={busy !== null}>
            {busy ?? 'Refresh'}
          </button>
        </div>
      </header>

      <ProjectBar
        current={project}
        recents={store.recents}
        home={located?.home ?? null}
        busy={busy !== null}
        onPick={() => void pickProject()}
        onSelect={(dir) => void useProject(dir)}
        onForget={(dir) => setStore(projects.forget(dir))}
      />

      {located && located.version === null && (
        <p className="error">
          Found no working <code>wwm</code> at <code>{located.path}</code> (source:{' '}
          {located.source}). Install it with <code>npm install -g wicked-webflow-mcp</code>, or set{' '}
          <code>WWM_BIN</code> to <code>bin/wwm</code> in a checkout.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {project && data?.activation.fileConflict && (
        <p className="warn-banner">
          <code>.wicked-webflow</code> lists a different set and wins at session start &mdash; the
          current selection will be undone next session. Re-run the switch with{' '}
          <code>--write</code> from the CLI to make it stick.
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th>Connection</th>
            <th>Label</th>
            <th>Health</th>
            <th>Sites</th>
            <th>Active here</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.servers.map((row) => (
            <tr key={row.server}>
              <td className="mono">{row.server}</td>
              <td>{row.label}</td>
              <td className={row.health === 'connected' ? 'ok' : 'warn'}>
                {HEALTH_LABEL[row.health]}
              </td>
              <td>
                <Sites row={row} />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={project ? row.active : false}
                  disabled={busy !== null || !project}
                  title={project ? undefined : 'Choose a project folder first'}
                  onChange={() => toggle(row)}
                />
              </td>
              <td className="row-actions">
                <button
                  disabled={busy !== null}
                  onClick={() => void act('Verifying', () => wwm.verify(project, row.server))}
                >
                  Verify
                </button>
                {row.health === 'needs_auth' && (
                  <button onClick={() => setLogin({ server: row.server, label: row.label })}>
                    Authorize
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data?.servers.length === 0 && (
        <p className="muted empty">No connections yet. &ldquo;Add client&rdquo; sets one up.</p>
      )}

      {/* Health, sites and verify are global facts; only the checkboxes need a
          directory. Saying so is better than greying a column with no reason. */}
      {!project && data && data.servers.length > 0 && (
        <p className="muted note">
          Choose a project folder to set which of these load there. Connections stay authorized
          either way &mdash; activation is per&#8209;folder, authorization is not.
        </p>
      )}

      {project && data && data.servers.every((s) => !s.active) && !data.activation.connectorsSuppressed && (
        <p className="muted note">
          With none of ours active, Claude Code&rsquo;s own Webflow connector can load in this
          project. It is a separate connection with its own authorization.
        </p>
      )}

      {adding && (
        <AddClient
          taken={data?.servers.map((s) => s.server) ?? []}
          busy={busy !== null}
          onCancel={() => setAdding(false)}
          onSubmit={addClient}
        />
      )}

      {login && (
        <LoginTerminal
          server={login.server}
          label={login.label}
          onExit={(code) => {
            if (code === 0) void act('Verifying', () => wwm.verify(project, login.server))
          }}
          onClose={() => setLogin(null)}
        />
      )}
    </div>
  )
}
