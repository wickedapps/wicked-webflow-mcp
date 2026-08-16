// The pty view.
//
// `claude mcp login` checks for a controlling terminal before it opens the
// browser flow, so the CLI cannot run it from an agent shell and neither could
// this app over pipes. Rust opens a real pty (src-tauri/src/pty.rs) and this
// is the other end of it.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'

interface Props {
  server: string
  label: string
  onExit: (code: number) => void
  onClose: () => void
}

export function LoginTerminal({ server, label, onExit, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [exited, setExited] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!host.current) return

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#181818', foreground: '#f1f2f4', cursor: '#2062d4' },
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

    // Both listeners must be attached before login_start, or the first burst
    // of output — which includes the URL — is lost.
    const unlisten = Promise.all([
      listen<string>('login:output', (e) => term.write(e.payload)),
      listen<{ code: number }>('login:exit', (e) => {
        setExited(e.payload.code)
        onExit(e.payload.code)
      }),
    ])

    void unlisten.then(() =>
      invoke('login_start', {
        server,
        noBrowser: false,
        rows: term.rows,
        cols: term.cols,
      }).catch((e: unknown) => setError(String(e))),
    )

    return () => {
      resize.disconnect()
      void unlisten.then((fns) => fns.forEach((f) => f()))
      void invoke('login_close').catch(() => {})
      term.dispose()
    }
    // Deliberately mount-once: re-running this would kill and respawn the
    // OAuth flow mid-browser-round-trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="sheet">
      <div className="sheet-card">
        <header>
          <div>
            <h2>Authorize {label}</h2>
            <p className="muted">
              Webflow&rsquo;s consent screen lists every site in every workspace you can reach, and
              it is multi&#8209;select. Tick only {label}&rsquo;s site or sites &mdash; that
              selection is what this connection will be able to read. Do not tick the workspace row
              above them unless you mean the whole workspace.
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
          <button onClick={onClose}>{exited === null ? 'Cancel' : 'Done'}</button>
        </footer>
      </div>
    </div>
  )
}
