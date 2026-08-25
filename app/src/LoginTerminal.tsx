import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'

interface Props {
  server: string
  label: string
  /**
   * The old grant was already revoked on the way in, so the consent screen is
   * replacing one rather than issuing the first. Copy only — the pty runs the
   * same `claude mcp login` either way.
   */
  reauth?: boolean
  onExit: (code: number) => void
  onClose: () => void
}

export function LoginTerminal({ server, label, reauth = false, onExit, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [exited, setExited] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!host.current) return

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      // xterm's default ANSI palette assumes a dark background, so the light
      // background needs a matching palette or anything the CLI prints in
      // white or a bright colour washes out. Keep these in step with :root
      // in styles.css and with .term's background.
      theme: {
        background: '#ffffff',
        foreground: '#181818',
        cursor: '#2062d4',
        selectionBackground: '#cedef9',
        black: '#181818',
        red: '#c0392b',
        green: '#059669',
        yellow: '#b45309',
        blue: '#2062d4',
        magenta: '#8b3fa8',
        cyan: '#0e7490',
        white: '#555555',
        brightBlack: '#6b7280',
        brightRed: '#e74c3c',
        brightGreen: '#047857',
        brightYellow: '#92400e',
        brightBlue: '#1754bc',
        brightMagenta: '#7c3aed',
        brightCyan: '#0891b2',
        brightWhite: '#181818',
      },
      convertEol: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    fit.fit()

    term.onData((data) => {
      void invoke('login_write', { data }).catch(() => {
        /* the child is gone; the exit event covers it */
      })
    })

    const resize = new ResizeObserver(() => {
      fit.fit()
      void invoke('login_resize', { rows: term.rows, cols: term.cols }).catch(() => {})
    })
    resize.observe(host.current)

    // Events are global, so they have to be matched to this session by id.
    // Starting a session kills any previous one, and that kill emits a real
    // `login:exit`. Under StrictMode the effect mounts twice, so an
    // unfiltered listener reads the first child's death as its own and the
    // sheet claims the login exited while its child is still prompting.
    const id = crypto.randomUUID()
    let live = true

    // Both listeners must be attached before login_start, or the first burst
    // of output is lost, URL included.
    const unlisten = Promise.all([
      listen<{ id: string; data: string }>('login:output', (e) => {
        if (e.payload.id === id) term.write(e.payload.data)
      }),
      listen<{ id: string; code: number }>('login:exit', (e) => {
        if (e.payload.id !== id) return
        setExited(e.payload.code)
        onExit(e.payload.code)
      }),
    ])

    void unlisten.then(() => {
      // Unmounted while the listeners were still being attached. Starting now
      // would kill whichever session replaced this one.
      if (!live) return
      return invoke('login_start', {
        id,
        server,
        noBrowser: false,
        rows: term.rows,
        cols: term.cols,
      }).catch((e: unknown) => setError(String(e)))
    })

    return () => {
      live = false
      resize.disconnect()
      void unlisten.then((fns) => fns.forEach((f) => f()))
      void invoke('login_close', { id }).catch(() => {})
      term.dispose()
    }
    // Deliberately mount-once. Re-running this would kill and respawn the
    // OAuth flow mid-browser-round-trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The same ^C the CLI tells you to press. Closing alone would do it. The
  // unmount kills the child with SIGKILL, and ^C lets `claude mcp login`
  // drop its callback server and pending state first.
  // Closing waits for the write so the two IPC calls cannot land out of order.
  const cancel = () => {
    void invoke('login_write', { data: '\x03' })
      .catch(() => {
        /* already gone; the unmount cleanup covers it */
      })
      .finally(onClose)
  }

  return (
    <div className="sheet">
      <div className="sheet-card login">
        <header>
          <div>
            <h2>
              {reauth ? 'Reauthorize' : 'Authorize'} {label}
            </h2>
            <p className="muted">
              Webflow&rsquo;s consent screen lists every site in every workspace you can reach, and
              it is multi&#8209;select.{' '}
              {reauth ? (
                <>
                  This grant replaces the one {label} had rather than extending it, so tick every
                  site it should reach from now on &mdash; anything left unticked is dropped,
                  including sites it reached until a moment ago. Until this finishes it reaches
                  nothing.
                </>
              ) : (
                <>
                  Tick only {label}&rsquo;s site or sites &mdash; that selection is what this
                  connection will be able to read.
                </>
              )}{' '}
              Do not tick the workspace row above them unless you mean the whole workspace.
            </p>
          </div>
        </header>

        {error && <p className="error">{error}</p>}
        <div className="term" ref={host} />

        <footer>
          <span className="muted">
            {exited === null
              ? `running \`claude mcp login ${server}\``
              : exited === 0
                ? 'Login finished. Verify to see which sites the grant actually covers.'
                : `Exited ${exited}.`}
          </span>
          <div className="actions">
            <button onClick={cancel} disabled={exited !== null}>
              Cancel
            </button>
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
