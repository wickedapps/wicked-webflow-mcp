import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { AddClient } from './AddClient'
import { ConfirmRemove } from './ConfirmRemove'
import { LoginTerminal } from './LoginTerminal'
import { ProjectBar } from './ProjectBar'
import * as projects from './project'
import * as wwm from './wwm'

type Tab = 'connections' | 'projects'

const HEALTH_LABEL: Record<wwm.Health, string> = {
  connected: 'Connected',
  needs_auth: 'Needs auth',
  failed: 'Failed',
  pending_approval: 'Pending approval',
  unknown: 'Unknown',
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

function StatusIcon({ kind }: { kind: 'ok' | 'bad' | 'warn' }) {
  if (kind === 'ok') {
    return (
      <svg className="status-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M5.25 8.15 7.1 10l3.65-4.4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (kind === 'bad') {
    return (
      <svg className="status-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="status-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.75 14.25 13.5H1.75L8 2.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 11.75h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function Status({
  kind,
  children,
}: {
  kind: 'ok' | 'bad' | 'warn'
  children: ReactNode
}) {
  return (
    <span className={`status ${kind}`}>
      <StatusIcon kind={kind} />
      {children}
    </span>
  )
}

/** `sites: null` is never verified — not the same as verified and empty. */
function Sites({ row }: { row: wwm.ServerRow }) {
  if (row.sites === null) return <span className="muted">Unverified</span>
  if (row.sites.length === 0) return <span className="warn">No sites</span>
  return (
    <span>
      {row.sites.join(', ')} <span className="muted">({relative(row.verifiedAt)})</span>
    </span>
  )
}

/** Health is the MCP handshake; verify is what the grant can actually see. */
function ConnectionStatus({ row }: { row: wwm.ServerRow }) {
  if (row.verifyFailed) return <Status kind="bad">Verification failed</Status>
  return (
    <>
      <Status kind={row.health === 'connected' ? 'ok' : 'warn'}>{HEALTH_LABEL[row.health]}</Status>
      <span className="muted">·</span>
      <Sites row={row} />
    </>
  )
}

function formatSource(source: string): string {
  return source === 'default (all)' ? 'default' : source
}

function projectSummary(
  pending: string | null,
  project: string | null,
  data: wwm.StatusResult | null,
): string | null {
  if (pending) return 'Loading…'
  if (!project || !data) return null
  if (data.servers.length === 0) return '0 connections'
  const active = data.servers.filter((s) => s.active).length
  return `${active} active here (from ${formatSource(data.activation.source)})`
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">No connections yet</p>
      <p className="empty-state-copy">{children}</p>
    </div>
  )
}

function applyActive(data: wwm.StatusResult, active: string[]): wwm.StatusResult {
  const set = new Set(active)
  return {
    ...data,
    servers: data.servers.map((s) => ({ ...s, active: set.has(s.server) })),
  }
}

/** Fold a `switch --json` payload into the list so a toggle does not wait on `mcp list`. */
function applySwitch(data: wwm.StatusResult, res: wwm.SwitchResult): wwm.StatusResult {
  const next = applyActive(data, res.active)
  return {
    ...next,
    activation: {
      ...next.activation,
      source: res.source ?? next.activation.source,
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

function ListWrap({ status, children }: { status: string | null; children: ReactNode }) {
  return (
    <div className={`cards${status ? ' loading' : ''}`} aria-busy={status !== null}>
      {children}
      {status && (
        <div className="list-loading">
          <span className="spinner" aria-hidden="true" />
          {status}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('connections')
  const [located, setLocated] = useState<wwm.Located | null>(null)
  const [data, setData] = useState<wwm.StatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [login, setLogin] = useState<{ server: string; label: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<{ server: string; label: string } | null>(null)
  const [store, setStore] = useState<projects.Projects>(() => projects.load())
  const [pending, setPending] = useState<string | null>(null)

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
   * Verify, then always re-read status.
   *
   * A failed verify still writes lastVerified into state (ok: false) before it
   * exits 6. If we skipped the reread, the card would keep the last successful
   * site list and still say connected — which is true of the handshake, and
   * the wrong thing to lead with.
   */
  const verifyServer = async (server: string) => {
    setBusy('Verifying')
    try {
      await wwm.verify(project, server)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    try {
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
    setPending(dir)
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
      setPending(null)
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
    // reread would make the button look like it ignored the click.
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

  const resetToDefault = () => {
    if (!data || !project || busy) return
    const previous = data
    setData(applyActive(data, data.servers.map((s) => s.server)))
    setBusy('Switching')
    void (async () => {
      try {
        const res = await wwm.switchDefault(project)
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

  const confirmRemove = () => {
    if (!removing) return
    const { server } = removing
    void (async () => {
      setBusy('Removing')
      try {
        await wwm.remove(project, server)
        setData((cur) =>
          cur ? { ...cur, servers: cur.servers.filter((s) => s.server !== server) } : cur,
        )
        setError(null)
        setRemoving(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    })()
  }

  return (
    <div className="app">
      <nav className="tabs" aria-label="Sections">
        <button
          className={`tab${tab === 'connections' ? ' active' : ''}`}
          aria-current={tab === 'connections' ? 'page' : undefined}
          onClick={() => setTab('connections')}
        >
          Connections
        </button>
        <button
          className={`tab${tab === 'projects' ? ' active' : ''}`}
          aria-current={tab === 'projects' ? 'page' : undefined}
          onClick={() => setTab('projects')}
        >
          Projects
        </button>
      </nav>

      {located && located.version === null && (
        <p className="error">
          Found no working <code>wwm</code> at <code>{located.path}</code> (source:{' '}
          {located.source}). Install it with <code>npm install -g wicked-webflow-mcp</code>, or set{' '}
          <code>WWM_BIN</code> to <code>bin/wwm</code> in a checkout.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {tab === 'connections' && (
        <>
          <div className="pane-head">
            {data ? (
              <h2 className="pane-heading">
                {data.servers.length} connection{data.servers.length === 1 ? '' : 's'}
              </h2>
            ) : (
              <h2 className="pane-heading">{busy === 'Loading' ? 'Loading…' : '\u00a0'}</h2>
            )}
            <div className="actions">
              <button className="primary" onClick={() => setAdding(true)} disabled={busy !== null}>
                Add new
              </button>
              <button
                className="icon-btn"
                onClick={() => void refresh(project, true)}
                disabled={busy !== null}
                aria-label="Refresh"
                title="Refresh"
              >
                <svg
                  className={busy === 'Loading' ? 'spin' : undefined}
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M13.5 8A5.5 5.5 0 1 1 11.4 3.4L14 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 2.5V6h-3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          <ListWrap
            status={busy === 'Loading' ? 'Loading…' : busy === 'Verifying' ? 'Verifying…' : null}
          >
            {data?.servers.map((row) => (
              <article key={row.server} className="card">
                <div className="card-body">
                  <h3 className="card-title">{row.label}</h3>
                  <p className="card-id mono muted">{row.server}</p>
                  <p className="card-meta">
                    <ConnectionStatus row={row} />
                  </p>
                </div>
                <div className="card-actions">
                  <button
                    disabled={busy !== null}
                    onClick={() => void verifyServer(row.server)}
                  >
                    Verify
                  </button>
                  {row.health === 'needs_auth' && (
                    <button
                      className="primary"
                      onClick={() => setLogin({ server: row.server, label: row.label })}
                    >
                      Authorize
                    </button>
                  )}
                  <button
                    className="icon-btn danger"
                    disabled={busy !== null}
                    aria-label={`Remove ${row.label}`}
                    title="Remove"
                    onClick={() => setRemoving({ server: row.server, label: row.label })}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 4h11M6 4V2.75h4V4M12.5 4v9.25a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75V4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M6.5 6.5v5M9.5 6.5v5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </article>
            ))}
            {data?.servers.length === 0 && (
              <EmptyState>&ldquo;Add new&rdquo; sets one up.</EmptyState>
            )}
          </ListWrap>
        </>
      )}

      {tab === 'projects' && (
        <>
          <ProjectBar
            current={pending ?? project}
            recents={store.recents}
            home={located?.home ?? null}
            busy={busy !== null}
            loading={pending !== null}
            summary={projectSummary(pending, project, data)}
            onPick={() => void pickProject()}
            onSelect={(dir) => void useProject(dir)}
            onForget={(dir) => setStore(projects.forget(dir))}
            {...(project && !pending && data?.activation.source === 'plugin state'
              ? { onReset: resetToDefault }
              : {})}
          />

          {project && data?.activation.fileConflict && (
            <p className="warn-banner">
              <code>.wicked-webflow</code> lists a different set and wins at session start &mdash;
              the current selection will be undone next session. Re-run the switch with{' '}
              <code>--write</code> from the CLI to make it stick.
            </p>
          )}

          <ListWrap status={busy === 'Loading' ? 'Loading…' : null}>
            {data?.servers.map((row) => {
              const on = Boolean(project && row.active)
              return (
                <article key={row.server} className="card">
                  <div className="card-body">
                    <h3 className="card-title">{row.label}</h3>
                    <p className="card-id mono muted">{row.server}</p>
                    <p className="card-meta">
                      {project ? (
                        <Status kind={on ? 'ok' : 'warn'}>{on ? 'Enabled' : 'Disabled'}</Status>
                      ) : (
                        <span className="muted">Choose a folder</span>
                      )}
                    </p>
                  </div>
                  <div className="card-actions">
                    <button
                      className={on ? undefined : 'primary'}
                      disabled={busy !== null || !project}
                      title={project ? undefined : 'Choose a project folder first'}
                      onClick={() => toggle(row)}
                    >
                      {on ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </article>
              )
            })}
            {data?.servers.length === 0 && (
              <EmptyState>Add one on the Connections tab.</EmptyState>
            )}
          </ListWrap>

          {!project && data && data.servers.length > 0 && (
            <p className="muted note">
              Choose a project folder to set which of these load there. Connections stay authorized
              either way &mdash; activation is per&#8209;folder, authorization is not.
            </p>
          )}

          {project &&
            data &&
            data.servers.length > 0 &&
            data.servers.every((s) => !s.active) &&
            !data.activation.connectorsSuppressed && (
              <p className="muted note">
                With none of ours active, Claude Code&rsquo;s own Webflow connector can load in this
                project. It is a separate connection with its own authorization.
              </p>
            )}
        </>
      )}

      {adding && (
        <AddClient
          taken={data?.servers.map((s) => s.server) ?? []}
          busy={busy !== null}
          onCancel={() => setAdding(false)}
          onSubmit={addClient}
        />
      )}

      {removing && (
        <ConfirmRemove
          server={removing.server}
          label={removing.label}
          busy={busy !== null}
          onCancel={() => setRemoving(null)}
          onConfirm={confirmRemove}
        />
      )}

      {login && (
        <LoginTerminal
          server={login.server}
          label={login.label}
          onExit={(code) => {
            if (code === 0) void verifyServer(login.server)
          }}
          onClose={() => setLogin(null)}
        />
      )}
    </div>
  )
}
