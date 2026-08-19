// Typed client for the CLI.

import { invoke } from '@tauri-apps/api/core'

/** The CLI --json schema this build speaks (`SCHEMA_VERSION` in bin/wwm). */
export const EXPECTED_SCHEMA_VERSION = 1

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

/** bin/wwm exit codes. */
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
    readonly kind: 'cli-upgrade' | 'app-upgrade' | 'generic' = 'generic',
  ) {
    super(message)
    this.name = 'WwmError'
  }
}

/** Reject payloads this build does not know how to read. */
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

/** Project directory, or null if none is chosen yet. */
export type Project = string | null

/**
 * Run a wwm command in `project`. `--json` is appended on the Rust side if
 * absent; a null project runs in HOME.
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
  found: boolean
  path: string | null
  source: 'WWM_BIN' | 'bundled' | 'PATH'
  version: string | null
  schemaVersion: number | null
  path_env: string | null
  home: string | null
  stderr: string
}

export const locate = () => invoke<Located>('wwm_locate')

export const NODE_DOWNLOAD = 'https://nodejs.org/en/download'
export const CLAUDE_INSTALL =
  'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code'

export interface Probe {
  found: boolean
  ok: boolean
  path: string | null
  version: string | null
  required: string
}

export interface Deps {
  node: Probe
  claude: Probe
}

export const checkDeps = () => invoke<Deps>('deps_check')

export const openUrl = (url: string) => invoke<void>('open_url', { url })

export interface UpgradeResult {
  code: number
  stdout: string
  stderr: string
}

/** Install or upgrade the published CLI. */
export const upgradeCli = () => invoke<UpgradeResult>('wwm_upgrade')

export const usesPinnedBin = (located: Located | null): boolean =>
  located?.source === 'WWM_BIN' || located?.source === 'bundled'

/**
 * The CLI shipped inside the app, rather than installed by the user.
 *
 * Both this and `WWM_BIN` are "pinned" — neither can be fixed by installing
 * from npm — but they fail for opposite reasons and cannot share a message:
 * a stale `WWM_BIN` is a checkout the user chose and must repoint, whereas a
 * bundled copy that will not run is almost always a missing Node.
 */
export const usesBundledBin = (located: Located | null): boolean =>
  located?.source === 'bundled'

export const status = (project: Project, refresh = false) =>
  run<StatusResult>(refresh ? ['status', '--refresh'] : ['status'], project)

export const connect = (project: Project, slug: string, label?: string) =>
  run<ConnectResult>(
    ['connect', slug, ...(label ? ['--label', label] : []), '--print-command'],
    project,
  )

export const switchTo = (project: Project, servers: string[]) =>
  run<SwitchResult>(servers.length === 0 ? ['switch', '--none'] : ['switch', ...servers], project)

export const switchDefault = (project: Project) =>
  run<SwitchResult>(['switch', '--default'], project)

export const verify = (project: Project, server?: string) =>
  run<VerifyResult>(server ? ['verify', server] : ['verify'], project)

export const remove = (project: Project, server: string) =>
  run<{ ok: boolean }>(['remove', server, '--yes'], project)

export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export function validateSlug(slug: string): string | null {
  if (!slug) return 'empty once punctuation and spaces are removed'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return 'must be lowercase letters, digits and hyphens'
  if (slug.length > 32) return 'longer than 32 characters'
  return null
}
