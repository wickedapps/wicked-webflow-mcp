import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { AddClient } from './AddClient'
import { ConfirmRemove } from './ConfirmRemove'
import { LoginTerminal } from './LoginTerminal'
import { ProjectBar } from './ProjectBar'
import * as projects from './project'
import * as wwm from './wwm'

type Tab = 'connections' | 'projects'

type AppError = {
  message: string
  kind: 'cli-upgrade' | 'app-upgrade' | 'generic'
  detail?: string | null
}

function caught(e: unknown): AppError {
  if (e instanceof wwm.WwmError) {
    return { message: e.message, kind: e.kind, detail: e.detail }
  }
  const message = e instanceof Error ? e.message : String(e)
  return {
    message,
    kind: message.includes('npm install -g wicked-webflow-mcp') ? 'cli-upgrade' : 'generic',
  }
}

function EmptyState({
  title = 'No connections yet',
  children,
  footer,
  action,
}: {
  title?: string
  children: ReactNode
  footer?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-copy">{children}</p>
      {footer}
      {action}
    </div>
  )
}

type Notice = {
  title: string
  body: ReactNode
  actionLabel: string | null
  actionHref: string | null
  recheck: boolean
  detail: string | null
}

function SetupNotice({
  title,
  children,
  detail,
  actionLabel,
  actionHref,
  recheck,
  busy,
  onAction,
  onRecheck,
  onOpenError,
}: {
  title: string
  children: ReactNode
  detail?: string | null
  actionLabel?: string | null
  actionHref?: string | null
  recheck?: boolean
  busy: string | null
  onAction?: () => void
  onRecheck?: () => void
  onOpenError?: (message: string) => void
}) {
  const upgrading = busy === 'Upgrading'
  const primaryBusy =
    upgrading && actionLabel === 'Install'
      ? 'Installing…'
      : upgrading
        ? 'Updating…'
        : actionLabel

  return (
    <EmptyState
      title={title}
      footer={
        detail ? (
          <details className="empty-state-detail">
            <summary>Show details</summary>
            <pre>{detail}</pre>
          </details>
        ) : undefined
      }
      action={
        actionLabel || recheck ? (
          <div className="empty-state-action">
            {actionHref && actionLabel ? (
              <a
                className="btn primary"
                href={actionHref}
                onClick={(e) => {
                  e.preventDefault()
                  void wwm.openUrl(actionHref).catch((err) => {
                    onOpenError?.(err instanceof Error ? err.message : String(err))
                  })
                }}
              >
                {actionLabel}
              </a>
            ) : actionLabel && onAction ? (
              <button className="primary" onClick={onAction} disabled={busy !== null}>
                {primaryBusy}
              </button>
            ) : null}
            {recheck && onRecheck ? (
              <button onClick={onRecheck} disabled={busy !== null}>
                {busy === 'Checking' ? 'Checking…' : 'Check again'}
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {children}
    </EmptyState>
  )
}

function nodeNotice(probe: wwm.Probe): Notice {
  const version = probe.version ? ` Version ${probe.version} is installed.` : ''
  return {
    title: probe.found ? 'Node.js update needed' : 'Node.js not found',
    body: probe.found
      ? `This app needs Node.js ${probe.required} or later.${version}`
      : `This app needs Node.js ${probe.required} or later.`,
    actionLabel: 'Download Node.js',
    actionHref: wwm.NODE_DOWNLOAD,
    recheck: true,
    detail: null,
  }
}

function claudeNotice(probe: wwm.Probe): Notice {
  const version = probe.version ? ` Version ${probe.version} is installed.` : ''
  return {
    title: probe.found ? 'Claude Code update needed' : 'Claude Code not found',
    body: probe.found
      ? `This app needs Claude Code ${probe.required} or later.${version}`
      : `This app needs Claude Code ${probe.required} or later.`,
    actionLabel: 'Install Claude Code',
    actionHref: wwm.CLAUDE_INSTALL,
    recheck: true,
    detail: null,
  }
}

function describeWwmSetup(
  located: wwm.Located | null,
  error: AppError | null,
): Notice | null {
  const missingWwm = located !== null && located.found === false
  const staleWwm = located !== null && located.found && located.version === null
  const pinned = wwm.usesPinnedBin(located)
  const failed =
    error?.kind === 'cli-upgrade' &&
    (error.message === 'Update failed' || /Could not run `npm`/i.test(error.message))

  if (error?.kind === 'app-upgrade') {
    return {
      title: 'Update needed',
      body: 'This app is older than the command-line tool installed here. Download the latest version of the app.',
      actionLabel: null,
      actionHref: null,
      recheck: false,
      detail: null,
    }
  }

  if (failed) {
    return {
      title: 'Update failed',
      body: (
        <>
          Try again, or run <code>npm install -g wicked-webflow-mcp</code> in a terminal.
        </>
      ),
      actionLabel: pinned ? null : 'Try again',
      actionHref: null,
      recheck: true,
      detail: error.detail ?? null,
    }
  }

  if (error?.kind === 'cli-upgrade' || missingWwm || staleWwm) {
    // The bundled copy is present but would not run. Node is the overwhelmingly
    // likely cause — it is the one prerequisite bundling does not remove — and
    // there is nothing to install, so this offers a re-check rather than a fix
    // it cannot perform.
    if (wwm.usesBundledBin(located)) {
      return {
        title: 'Command-line tool could not run',
        body: 'This app includes its own copy of the command-line tool, but it did not start. Check that Node.js 22 or later is installed.',
        actionLabel: null,
        actionHref: null,
        recheck: true,
        detail: null,
      }
    }
    if (pinned) {
      return {
        title: missingWwm ? 'Command-line tool not found' : 'Update needed',
        body: (
          <>
            This app is using a local checkout. Point <code>WWM_BIN</code> at a current copy of the
            tool.
          </>
        ),
        actionLabel: null,
        actionHref: null,
        recheck: false,
        detail: null,
      }
    }
    if (missingWwm) {
      return {
        title: 'Command-line tool not found',
        body: 'This app needs a command-line tool that is not installed yet.',
        actionLabel: 'Install',
        actionHref: null,
        recheck: true,
        detail: null,
      }
    }
    return {
      title: 'Update needed',
      body: 'The command-line tool installed here is older than this app. Update it to keep managing connections here.',
      actionLabel: 'Update',
      actionHref: null,
      recheck: false,
      detail: null,
    }
  }

  return null
}

function describeNotices(
  deps: wwm.Deps | null,
  located: wwm.Located | null,
  error: AppError | null,
): Notice[] {
  if (!deps) return []
  const notices: Notice[] = []
  if (!deps.node.ok) notices.push(nodeNotice(deps.node))
  if (!deps.claude.ok) notices.push(claudeNotice(deps.claude))
  if (deps.node.ok) {
    const wwmSetup = describeWwmSetup(located, error)
    if (wwmSetup) notices.push(wwmSetup)
  }
  return notices
}

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
  const [deps, setDeps] = useState<wwm.Deps | null>(null)
  const [located, setLocated] = useState<wwm.Located | null>(null)
  const [data, setData] = useState<wwm.StatusResult | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [busy, setBusy] = useState<string | null>('Loading')
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
      setError(caught(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const boot = useCallback(async (checking = false) => {
    setBusy(checking ? 'Checking' : 'Loading')
    setError(null)
    try {
      const next = await wwm.checkDeps()
      setDeps(next)
      if (!next.node.ok || !next.claude.ok) {
        setData(null)
        return
      }
      const found = await wwm.locate()
      setLocated(found)
      if (!found.found || found.version === null) {
        setData(null)
        return
      }
      setData(await wwm.status(projects.load().current, false))
    } catch (e) {
      setError(caught(e))
    } finally {
      setBusy(null)
    }
  }, [])

  const upgradeCli = async () => {
    setBusy('Upgrading')
    try {
      const result = await wwm.upgradeCli()
      if (result.code !== 0) {
        setError({
          message: 'Update failed',
          kind: 'cli-upgrade',
          detail: (result.stderr || result.stdout).trim() || null,
        })
        return
      }
      await boot(false)
    } catch (e) {
      setError(caught(e))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void boot(false)
  }, [boot])

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
      setError(caught(e))
    }
    try {
      setData(await wwm.status(project, false))
    } catch (e) {
      setError(caught(e))
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
      setError(caught(e))
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
      setError(caught(e))
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
        setError(caught(e))
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
        setError(caught(e))
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
        setError(caught(e))
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
        setError(caught(e))
      } finally {
        setBusy(null)
      }
    })()
  }

  const notices = describeNotices(deps, located, error)
  const setup = notices.length > 0

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

      {notices.map((notice) => (
        <SetupNotice
          key={notice.title}
          title={notice.title}
          detail={notice.detail}
          actionLabel={notice.actionLabel}
          actionHref={notice.actionHref}
          recheck={notice.recheck}
          busy={busy}
          onAction={() => void upgradeCli()}
          onRecheck={() => void boot(true)}
          onOpenError={(message) => setError({ message, kind: 'generic' })}
        >
          {notice.body}
        </SetupNotice>
      ))}
      {error && !setup && <p className="error">{error.message}</p>}

      {tab === 'connections' && !setup && (
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

      {tab === 'projects' && !setup && (
        <>
          {((pending ?? project) || (data && data.servers.length > 0)) && (
            <ProjectBar
              current={pending ?? project}
              recents={store.recents}
              home={located?.home ?? null}
              busy={busy !== null}
              loading={pending !== null}
              summary={projectSummary(pending, project, data)}
              ready={data?.servers.length ?? 0}
              onPick={() => void pickProject()}
              onSelect={(dir) => void useProject(dir)}
              onForget={(dir) => setStore(projects.forget(dir))}
              {...(project && !pending && data?.activation.source === 'plugin state'
                ? { onReset: resetToDefault }
                : {})}
            />
          )}

          {project && data?.activation.fileConflict && (
            <p className="warn-banner">
              <code>.wicked-webflow</code> lists a different set and wins at session start &mdash;
              the current selection will be undone next session. Re-run the switch with{' '}
              <code>--write</code> from the CLI to make it stick.
            </p>
          )}

          {((pending ?? project) || !data || data.servers.length === 0) && (
            <ListWrap status={busy === 'Loading' ? 'Loading…' : null}>
              {(pending ?? project) &&
                data?.servers.map((row) => {
                  const on = row.active
                  return (
                    <article key={row.server} className="card">
                      <div className="card-body">
                        <h3 className="card-title">{row.label}</h3>
                        <p className="card-id mono muted">{row.server}</p>
                        <p className="card-meta">
                          <Status kind={on ? 'ok' : 'warn'}>{on ? 'Enabled' : 'Disabled'}</Status>
                        </p>
                      </div>
                      <div className="card-actions">
                        <button
                          className={on ? undefined : 'primary'}
                          disabled={busy !== null}
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
