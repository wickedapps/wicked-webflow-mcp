// Reauthorizing keeps the connection and destroys its grant. `claude mcp
// logout` deletes the whole keychain record, clientId included, so the next
// login registers a fresh client and Webflow has to show its consent screen
// again — that is the point of doing this instead of a second login. It also
// means the grant that comes back replaces the old one rather than editing it,
// which is the part worth confirming: what is not ticked is gone.

interface Props {
  server: string
  label: string
  /** From the last verify. `null` means never verified, so there is nothing honest to name. */
  sites: string[] | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmReauth({ server, label, sites, busy, onCancel, onConfirm }: Props) {
  return (
    <div className="sheet">
      <div className="sheet-card narrow">
        <header>
          <div>
            <h2>Reauthorize {label}?</h2>
            <p className="muted">
              <code>{server}</code> keeps its name, its label and wherever it is enabled. What it
              loses is its current Webflow authorization. The consent screen that opens next grants
              a new one from scratch rather than extending this one, so tick every site {label}{' '}
              should reach from now on &mdash; anything left unticked is dropped, including sites it
              reaches today.
            </p>
            {sites && (
              <p className="muted">
                {sites.length === 0
                  ? 'Its last check found no sites at all, so there is nothing to lose here.'
                  : `Right now it reaches ${sites.join(', ')}.`}
              </p>
            )}
            <p className="muted">
              There is no undo, and no in&#8209;between state worth stopping at: from the moment the
              old grant goes until the browser round&#8209;trip finishes, this connection reaches
              nothing.
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
              {busy ? 'Reauthorizing…' : 'Reauthorize'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
