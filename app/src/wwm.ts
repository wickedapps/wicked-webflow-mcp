// Typed client for the CLI. When bumping EXPECTED_SCHEMA_VERSION, update the
// interfaces below in the same commit — they are the other half of the contract.

import { invoke } from '@tauri-apps/api/core'

/**
 * The CLI --json schema this build speaks (bin/wwm's SCHEMA_VERSION).
 *
 * The app and the CLI install separately and upgrade separately, so they will
 * disagree eventually. Better one clear sentence about which to upgrade than a
 * screen of fields that silently read `undefined`.
 */
export const EXPECTED_SCHEMA_VERSION = 1

/** Stamped on every payload by bin/wwm's emitJson. Always the first key. */
interface Envelope {
  schemaVersion: number
}

export type Health = 'connected' | 'needs_auth' | 'failed' | 'pending_approval' | 'unknown'

export interface ServerRow {
  server: string
  label: string
  health: Health
  statusText: string
  /** Site display names from the last successful verify. `null` means never verified — not "verified and empty". */
  sites: string[] | null
  workspaceIds: string[]
  singleSite: boolean | null
  verifiedAt: string | null
  verifyFailed: boolean
  /** Read from disabledMcpServers, not from `mcp list` — a disabled server still reports Connected. */
  active: boolean
}

export interface Activation {
  source: string
  connectorsSuppressed: boolean
  /** `.wicked-webflow` disagrees with what is applied now, and the file wins at next session start. */
  fileConflict: boolean
}

export interface StatusResult extends Envelope {
  ok: true
  cwd: string
  servers: ServerRow[]
  activation: Activation
  cached: boolean
}

export interface ConnectResult extends Envelope {
  ok: boolean
  server: string
  label: string
  scope: string
  /** Always present from this app: `connect` is called with `--print-command`. */
  loginCommand?: string
  authorized?: boolean
  verified?: unknown
}

export interface SwitchResult extends Envelope {
  ok: boolean
  cwd: string
  active: string[]
  disabled: string[]
  connector?: string
  wroteFile?: string | null
  /** `.wicked-webflow` disagrees with this switch, and the file wins at next session start. */
  fileConflict: boolean
  /** Same values `status` reports: `.wicked-webflow`, `plugin state`, or `default (all)`. */
  source: string
  restartRequired?: boolean
  error?: string | null
}

export interface VerifyResult extends Envelope {
  ok: boolean
  results: Array<{
    server: string
    ok: boolean
    sites?: string[]
    workspaceIds?: string[]
    singleSite?: boolean
    reason?: string
  }>
}

interface RawOutput {
  code: number
  json: unknown
  stderr: string
}

/** bin/wwm's EXIT map, for messages worth phrasing better than "exit 4". */
const EXIT_MEANING: Record<number, string> = {
  2: 'The app called wwm incorrectly.',
  3: 'Preflight failed — check that the `claude` CLI is installed and current.',
  4: 'A connection with that name already exists.',
  6: 'Verification failed.',
  7: 'wwm could not parse output from the `claude` CLI. It is probably a version ahead of this build.',
}

export class WwmError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly detail: string | null = null,
    /** The published CLI is what is behind; `npm install -g` is the fix. */
    readonly kind: 'cli-upgrade' | 'app-upgrade' | 'generic' = 'generic',
  ) {
    super(message)
    this.name = 'WwmError'
  }
}

/**
 * Checked before anything else is read: on a version we do not know, the rest
 * of the payload — including the error envelope — may not mean what we think.
 */
function assertSchema(body: Record<string, unknown>): void {
  const got = body.schemaVersion
  if (got === EXPECTED_SCHEMA_VERSION) return

  if (got === undefined) {
    throw new WwmError(
      'The command-line tool installed here is older than this app.',
      -1,
      null,
      'cli-upgrade',
    )
  }
  const cliOlder = typeof got === 'number' && got < EXPECTED_SCHEMA_VERSION
  throw new WwmError(
    cliOlder
      ? 'The command-line tool installed here is older than this app.'
      : 'This app is older than the command-line tool installed here. Download the latest version of the app.',
    -1,
    null,
    cliOlder ? 'cli-upgrade' : 'app-upgrade',
  )
}

/**
 * A project directory, or null for "none chosen yet".
 *
 * Threaded explicitly through every call rather than held as module state:
 * which directory a command ran in is the difference between two completely
 * different answers from `status`, and it should be impossible to write one
 * without saying which.
 */
export type Project = string | null

/**
 * Run a wwm command in `project`. `--json` is appended by the Rust side if
 * absent; a null project runs in HOME.
 *
 * A non-zero exit still carries parsed JSON — every failure path in the CLI
 * emits `{ok: false, error, detail, exitCode}` — so failures arrive here as a
 * structured WwmError rather than a wall of stderr.
 */
export async function run<T>(args: string[], project: Project = null): Promise<T> {
  const out = await invoke<RawOutput>('wwm_run', { args, cwd: project })

  if (out.json === null || typeof out.json !== 'object') {
    const hint = EXIT_MEANING[out.code]
    throw new WwmError(
      out.stderr.trim() || hint || `wwm exited ${out.code} with no output.`,
      out.code,
    )
  }

  const body = out.json as Record<string, unknown>
  assertSchema(body)

  if (body.ok === false) {
    throw new WwmError(
      String(body.error ?? EXIT_MEANING[out.code] ?? `wwm exited ${out.code}.`),
      out.code,
      body.detail == null ? null : String(body.detail),
    )
  }

  return body as T
}

export interface Located {
  path: string
  source: 'WWM_BIN' | 'bundled' | 'PATH'
  version: string | null
  /** null on any wwm predating the contract. */
  schemaVersion: number | null
  path_env: string | null
  /** For abbreviating project paths to `~/…`. */
  home: string | null
  stderr: string
}

export const locate = () => invoke<Located>('wwm_locate')

export interface UpgradeResult {
  code: number
  stdout: string
  stderr: string
}

/** Install or upgrade the published CLI. Refused in Rust when WWM_BIN is set. */
export const upgradeCli = () => invoke<UpgradeResult>('wwm_upgrade')

/** A global `npm install -g` would not be the binary this app is about to run. */
export const usesPinnedBin = (located: Located | null): boolean =>
  located?.source === 'WWM_BIN' || located?.source === 'bundled'

export const status = (project: Project, refresh = false) =>
  run<StatusResult>(refresh ? ['status', '--refresh'] : ['status'], project)

/**
 * Add the server. Never authorizes — `--print-command` makes the CLI return
 * the login command, which LoginTerminal then runs on a pty.
 *
 * Registration is user-scope; the project is still passed so any paths the
 * CLI prints match the directory on screen.
 */
export const connect = (project: Project, slug: string, label?: string) =>
  run<ConnectResult>(
    ['connect', slug, ...(label ? ['--label', label] : []), '--print-command'],
    project,
  )

/**
 * Set the connections active in `project`.
 *
 * `switch` takes slugs or full server names — toServerName() normalizes both.
 * It writes `projects[<project>].disabledMcpServers` in ~/.claude.json, so the
 * directory is not cosmetic here: it is what gets written.
 */
export const switchTo = (project: Project, servers: string[]) =>
  run<SwitchResult>(servers.length === 0 ? ['switch', '--none'] : ['switch', ...servers], project)

/**
 * Forget this folder's remembered set so every connection loads, including ones
 * added later. `--all` is not this: it snapshots the current names into plugin
 * state, and a connection added afterwards stays off.
 */
export const switchDefault = (project: Project) =>
  run<SwitchResult>(['switch', '--default'], project)

export const verify = (project: Project, server?: string) =>
  run<VerifyResult>(server ? ['verify', server] : ['verify'], project)

/** Destroys the OAuth grant at every scope. Not the per-project off switch — that is `switchTo`. */
export const remove = (project: Project, server: string) =>
  run<{ ok: boolean }>(['remove', server, '--yes'], project)

// Mirror of slugify()/validateSlug() in bin/wwm, for the Add-client preview.
// The CLI revalidates and exits 2 on anything bad, so drift here costs a
// wrong preview, never a wrong connection.

export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Server names become tool-name prefixes, so every character is paid for in every session. */
export function validateSlug(slug: string): string | null {
  if (!slug) return 'empty once punctuation and spaces are removed'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return 'must be lowercase letters, digits and hyphens'
  if (slug.length > 32) return 'longer than 32 characters'
  return null
}
