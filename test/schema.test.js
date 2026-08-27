// The `--json` contract.
//
// bin/wwm's JSON output used to be incidental, whatever an emitJson call site
// happened to pass. It now has a consumer that ships separately (app/, the
// desktop front end) and cannot be fixed by editing this repo, so the shapes
// are pinned here.
//
// Every test asserts the EXACT key set, not a subset. Adding a field is not a
// breaking change for consumers, but it must still fail here. The point is
// that no field appears or disappears without someone deciding whether
// SCHEMA_VERSION should move. When one of these fails, either revert the
// output change or update the pin AND bump SCHEMA_VERSION if the change is
// breaking. Never quietly widen the assertion.
//
// These run the real CLI end to end against a throwaway ~/.claude.json, a
// throwaway plugin data dir, and a stub `claude`. No network, no credential,
// no real Claude Code install.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCHEMA_VERSION } from '../bin/wwm'

const HERE = dirname(fileURLToPath(import.meta.url))
const WWM = join(HERE, '..', 'bin', 'wwm')
const FIXTURES = join(HERE, 'fixtures', '2.1.223')

/** Two wwm-owned servers plus a neighbour that must never be touched. */
const MCP_LIST = `Checking MCP server health…

wf-example: https://mcp.webflow.com/mcp - ✔ Connected
wf-other: https://mcp.webflow.com/mcp - ! Needs authentication
notes: https://mcp.example.com/notes - ✔ Connected
`

/**
 * A stand-in for the `claude` CLI. Node rather than sh so argument matching is
 * readable; wwm finds it through WWM_CLAUDE_BIN.
 */
function stubClaude(dir, { verifyTranscript = '' } = {}) {
  const path = join(dir, 'claude')
  writeFileSync(
    path,
    `#!/usr/bin/env node
const a = process.argv.slice(2)
const has = (...xs) => xs.every((x) => a.includes(x))
if (has('--version')) { process.stdout.write('2.1.223 (Claude Code)\\n'); process.exit(0) }
if (has('mcp', 'list')) { process.stdout.write(${JSON.stringify(MCP_LIST)}); process.exit(0) }
if (has('-p')) { process.stdout.write(${JSON.stringify(verifyTranscript)}); process.exit(0) }
process.exit(0)
`,
    { mode: 0o755 },
  )
  return path
}

function sandbox(t, { connections = ['wf-example', 'wf-other'], verifyTranscript = '' } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'wwm-schema-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))

  const data = join(base, 'data')
  mkdirSync(data, { recursive: true })
  const jsonPath = join(base, 'claude.json')
  writeFileSync(jsonPath, JSON.stringify({ projects: {} }, null, 2))
  writeFileSync(
    join(data, 'state.json'),
    JSON.stringify({
      version: 1,
      connections: Object.fromEntries(
        connections.map((n) => [n, { label: n.replace(/^wf-/, ''), addedAt: '2026-01-01T00:00:00Z' }]),
      ),
      projects: {},
    }),
  )

  const project = join(base, 'project')
  mkdirSync(project)

  const env = {
    ...process.env,
    WWM_CLAUDE_BIN: stubClaude(base, { verifyTranscript }),
    WWM_CLAUDE_JSON: jsonPath,
    CLAUDE_PLUGIN_DATA: data,
  }

  return {
    base,
    project,
    /** Run the real CLI with --json. Returns the parsed payload whatever the exit code. */
    run(args) {
      try {
        return JSON.parse(
          execFileSync(process.execPath, [WWM, ...args, '--json'], { env, encoding: 'utf8' }),
        )
      } catch (e) {
        if (typeof e.stdout === 'string' && e.stdout.trim()) return JSON.parse(e.stdout)
        throw e
      }
    },
  }
}

/** Assert the exact key set, with a diff that names what moved. */
function keys(payload, expected, what) {
  const actual = Object.keys(payload).sort()
  const want = [...expected].sort()
  const added = actual.filter((k) => !want.includes(k))
  const gone = want.filter((k) => !actual.includes(k))
  assert.deepEqual(
    actual,
    want,
    `${what} keys changed` +
      (added.length ? `\n  added:   ${added.join(', ')}` : '') +
      (gone.length ? `\n  removed: ${gone.join(', ')}` : '') +
      `\nUpdate the pin, and bump SCHEMA_VERSION if this breaks a consumer.`,
  )
}

// ---------------------------------------------------------------------------
// the envelope
// ---------------------------------------------------------------------------

test('every payload carries schemaVersion first', (t) => {
  const box = sandbox(t)
  for (const args of [['version'], ['doctor'], ['status'], ['activate', '--project', box.project]]) {
    const out = box.run(args)
    assert.equal(out.schemaVersion, SCHEMA_VERSION, `${args[0]} is missing schemaVersion`)
    assert.equal(
      Object.keys(out)[0],
      'schemaVersion',
      `${args[0]}: schemaVersion must be the first key, so a consumer can read it from a truncated payload`,
    )
  }
})

test('SCHEMA_VERSION is an integer, and is not the release version', () => {
  // The two version numbers move independently on purpose. If someone ever
  // "fixes" this by setting it to VERSION, consumers start comparing 0.5.1 to
  // an integer and every check silently fails open.
  assert.equal(Number.isInteger(SCHEMA_VERSION), true)
  assert.ok(SCHEMA_VERSION >= 1)
})

// ---------------------------------------------------------------------------
// per-command shapes
// ---------------------------------------------------------------------------

test('version', (t) => {
  const out = sandbox(t).run(['version'])
  keys(out, ['schemaVersion', 'version'], 'version')
  assert.equal(typeof out.version, 'string')
})

test('doctor', (t) => {
  const out = sandbox(t).run(['doctor'])
  keys(out, ['schemaVersion', 'ok', 'checks'], 'doctor')
  assert.ok(Array.isArray(out.checks) && out.checks.length > 0)
  for (const check of out.checks) keys(check, ['name', 'ok', 'detail'], 'doctor.checks[]')
})

test('status', (t) => {
  const box = sandbox(t)
  const out = box.run(['status', '--project', box.project])

  keys(out, ['schemaVersion', 'ok', 'cwd', 'servers', 'activation', 'cached'], 'status')
  keys(
    out.activation,
    ['source', 'connectorsSuppressed', 'fileConflict'],
    'status.activation',
  )

  const row = out.servers.find((s) => s.server === 'wf-example')
  assert.ok(row, 'the stub list must produce a wf-example row')
  keys(
    row,
    [
      'server',
      'label',
      'health',
      'statusText',
      'sites',
      'workspaceIds',
      'singleSite',
      'verifiedAt',
      'verifyFailed',
      'active',
    ],
    'status.servers[]',
  )

  // The values the app reads, not only whether the keys exist.
  assert.equal(row.sites, null, 'never verified must be null — not [], which reads as "verified, no sites"')
  assert.equal(row.verifiedAt, null)
  assert.equal(row.verifyFailed, false)
  assert.equal(row.active, true)
  assert.equal(out.servers.some((s) => s.server === 'notes'), false, 'only wf-* servers are ours')
})

test('switch', (t) => {
  const box = sandbox(t)
  const out = box.run(['switch', 'example', '--project', box.project])

  keys(
    out,
    [
      'schemaVersion',
      'ok',
      'cwd',
      'active',
      'disabled',
      'connector',
      'wroteFile',
      'fileConflict',
      'source',
      'restartRequired',
      'error',
    ],
    'switch',
  )
  assert.deepEqual(out.active, ['wf-example'])
  assert.deepEqual(out.disabled, ['wf-other'])
  assert.equal(out.source, 'plugin state')
})

test('connect, which can never authorize without a TTY', (t) => {
  const box = sandbox(t, { connections: [] })
  const out = box.run(['connect', 'newclient', '--label', 'New Client'])

  keys(
    out,
    ['schemaVersion', 'ok', 'server', 'label', 'scope', 'loginCommand', 'authorized'],
    'connect',
  )
  // The whole reason app/src-tauri/src/pty.rs exists. The CLI hands back a
  // command instead of running it. If this ever starts coming back authorized,
  // the app's login sheet is dead code and should go.
  assert.equal(out.authorized, false)
  assert.equal(out.loginCommand, 'claude mcp login wf-newclient')
})

test('remove', (t) => {
  const out = sandbox(t).run(['remove', 'example', '--yes'])
  keys(out, ['schemaVersion', 'ok', 'server', 'steps', 'purged'], 'remove')
  assert.ok(Array.isArray(out.steps))
})

/** Every reauth path emits one key set, so all of them are pinned by one list. */
const REAUTH_KEYS = [
  'schemaVersion',
  'ok',
  'server',
  'label',
  'previous',
  'revoked',
  'logoutCommand',
  'loginCommand',
  'authorized',
  'verified',
  'changed',
]

test('reauth, which without a TTY hands back the commands and changes nothing', (t) => {
  const box = sandbox(t)
  const out = box.run(['reauth', 'example'])

  keys(out, REAUTH_KEYS, 'reauth (print-command)')
  // The load-bearing assertion. An agent shell cannot run `claude mcp login`,
  // so if this path ever starts revoking on its own it destroys a working
  // grant on the strength of a command the user may never paste.
  assert.equal(out.revoked, false)
  assert.equal(out.authorized, false)
  assert.equal(out.logoutCommand, 'claude mcp logout wf-example')
  assert.equal(out.loginCommand, 'claude mcp login wf-example')
  assert.equal(out.verified, null)
  assert.equal(out.changed, null)
})

test('reauth --revoke-only drops the grant and stops, for a caller that owns a terminal', (t) => {
  const box = sandbox(t)
  const out = box.run(['reauth', 'example', '--revoke-only', '--yes'])

  keys(out, REAUTH_KEYS, 'reauth (revoke-only)')
  assert.equal(out.revoked, true)
  assert.equal(out.authorized, false, 'revoking is not authorizing')
  assert.equal(out.loginCommand, 'claude mcp login wf-example')
  assert.equal(out.logoutCommand, null, 'the logout already happened; handing it back would invite a second one')
})

test('reauth --revoke-only refuses without --yes, because there is no undo', (t) => {
  const box = sandbox(t)
  const out = box.run(['reauth', 'example', '--revoke-only'])
  assert.equal(out.ok, false)
  assert.equal(out.exitCode, 2)
})

test('reauth clears the recorded site list, so status cannot report a dead grant as reach', (t) => {
  // A connection whose grant was just revoked must not keep reporting the sites
  // that grant used to cover. "needs auth" next to a list of two sites reads to
  // a skimming human as "reaches two sites".
  const box = sandbox(t, {
    connections: ['wf-example'],
    verifyTranscript: readFileSync(join(FIXTURES, 'verify-two-sites.jsonl'), 'utf8'),
  })
  const verified = box.run(['verify', 'example'])
  assert.deepEqual(verified.results[0].sites, ['Example Site', 'Example Staging'])

  const out = box.run(['reauth', 'example', '--revoke-only', '--yes'])
  assert.deepEqual(out.previous.sites, ['Example Site', 'Example Staging'], 'the old list survives as history')

  const after = box.run(['status', '--project', box.project])
  const row = after.servers.find((s) => s.server === 'wf-example')
  assert.equal(row.sites, null, 'the revoked grant is not still reported as reach')
  assert.equal(row.verifiedAt, null)

  // A second reauth over an already-revoked connection can still say what it
  // used to reach. This is the path a failed browser step leaves behind, and
  // losing the before-list is what would make the next diff meaningless.
  const again = box.run(['reauth', 'example', '--revoke-only', '--yes'])
  assert.deepEqual(again.previous.sites, ['Example Site', 'Example Staging'])
})

test('reauth refuses a server that does not exist, rather than creating one', (t) => {
  const box = sandbox(t, { connections: [] })
  const out = box.run(['reauth', 'nosuchclient'])
  assert.equal(out.ok, false)
  assert.equal(out.exitCode, 2)
  assert.match(out.detail, /wwm connect nosuchclient/)
})

test('activate — the SessionStart hook, which must stay exit 0 and parseable', (t) => {
  const box = sandbox(t)
  const out = box.run(['activate', '--project', box.project])
  keys(
    out,
    ['schemaVersion', 'ok', 'cwd', 'source', 'active', 'disabled', 'unknown', 'changed', 'error'],
    'activate',
  )
})

test('verify', (t) => {
  const box = sandbox(t, {
    connections: ['wf-example'],
    verifyTranscript: readFileSync(join(FIXTURES, 'verify-two-sites.jsonl'), 'utf8'),
  })
  const out = box.run(['verify', 'example'])

  keys(out, ['schemaVersion', 'ok', 'results'], 'verify')
  assert.equal(out.ok, true)
  keys(
    out.results[0],
    ['server', 'ok', 'sites', 'workspaceIds', 'total', 'hasMore', 'singleSite', 'cached'],
    'verify.results[] (success)',
  )
  assert.deepEqual(out.results[0].sites, ['Example Site', 'Example Staging'])
})

test('verify, when the check could not be made', (t) => {
  // An empty transcript is "no tool call happened", which the parser must
  // report as not-known rather than as a clean pass.
  const box = sandbox(t, { connections: ['wf-example'], verifyTranscript: '' })
  const out = box.run(['verify', 'example'])

  assert.equal(out.ok, false)
  keys(
    out.results[0],
    ['server', 'ok', 'reason', 'finalText', 'stderr', 'cached'],
    'verify.results[] (failure)',
  )
})

test('the error envelope', (t) => {
  const box = sandbox(t)
  // A name collision: wf-example is already in the stub `mcp list` output.
  const out = box.run(['connect', 'example'])

  keys(out, ['schemaVersion', 'ok', 'error', 'detail', 'exitCode'], 'error envelope')
  assert.equal(out.ok, false)
  assert.equal(out.exitCode, 4, 'EXIT.COLLISION is part of the contract, not an implementation detail')
})
