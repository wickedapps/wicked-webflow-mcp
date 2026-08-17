// Remove destroys the OAuth grant everywhere. Confirm so that cannot be
// confused with disabling a connection in one project.

interface Props {
  server: string
  label: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmRemove({ server, label, busy, onCancel, onConfirm }: Props) {
  return (
    <div className="sheet">
      <div className="sheet-card narrow">
        <header>
          <div>
            <h2>Remove {label}?</h2>
            <p className="muted">
              This destroys the authorization for <code>{server}</code> everywhere, not just in one
              folder. Restoring it means walking through Webflow&rsquo;s consent screen again. To
              unload a connection in a project, switch to the Projects tab and disable it there.
            </p>
          </div>
        </header>
        <footer>
          <span />
          <div className="actions">
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button className="danger-fill" type="button" onClick={onConfirm} disabled={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
