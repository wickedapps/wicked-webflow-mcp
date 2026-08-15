// Parser regression suite.
//
// Fixtures under test/fixtures/<version>/ pin parser shapes for that Claude
// Code version. `claude mcp list` and `claude mcp get` have no --json, so this
// suite is what tells us a Claude Code release broke the plugin. Add a new
// fixture directory per supported version; never edit an old one just to make
// a test pass.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SITES_COL,
  WICKED_FILE,
  compareVersions,
  formatSites,
  isMainPath,
  mergeDisabled,
  parseArgv,
  parseHealth,
  parseMcpGet,
  parseMcpList,
  parsePersistedOutput,
  parseVerifyTranscript,
  parseVersion,
  parseWickedFile,
  resolveActiveSet,
  sameList,
  slugify,
  toServerName,
  validateSlug,
  VERSION,
} from '../bin/wwm'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', '2.1.223')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

// ---------------------------------------------------------------------------
// mcp list
// ---------------------------------------------------------------------------

test('parseMcpList reads real 2.1.223 output', () => {
  const { servers, unparsed, ok } = parseMcpList(fixture('mcp-list.txt'))
  assert.equal(ok, true, `unparsed lines: ${unparsed.join(' | ')}`)
  assert.equal(servers.length, 13)

  const webflow = servers.find((s) => s.name === 'claude.ai Webflow')
  assert.equal(webflow.health, 'connected')
  assert.equal(webflow.target, 'https://mcp.webflow.com/mcp')
})

test('parseMcpList handles names containing spaces and dots', () => {
  // "claude.ai some.tool" would break any parser that splits on the last
  // colon, or that assumes names are a single token.
  const { servers } = parseMcpList(fixture('mcp-list.txt'))
  const dotted = servers.find((s) => s.name === 'claude.ai some.tool')
  assert.ok(dotted, 'expected a server literally named "claude.ai some.tool"')
  assert.equal(dotted.health, 'needs_auth')
})

test('parseMcpList handles stdio targets containing flags', () => {
  // The local-bin command contains " --app desktop --agent cli", so " - "
  // appears more than once on the line. Status is after the LAST one.
  const { servers } = parseMcpList(fixture('mcp-list.txt'))
  const local = servers.find((s) => s.name === 'local-bin')
  assert.equal(local.health, 'connected')
  assert.ok(local.target.includes('--app desktop'), 'target should keep the full command line')
  assert.ok(!local.target.endsWith('-'), 'target should not swallow the separator')
})

test('parseMcpList has no (HTTP) transport marker in 2.1.223', () => {
  // An earlier assumption was "url (HTTP) - status". It is not there.
  // Locking this in so a future format change is a visible test break.
  assert.ok(!fixture('mcp-list.txt').includes('(HTTP)'))
})

test('parseMcpList recognises all four health states', () => {
  const { servers, ok } = parseMcpList(fixture('mcp-list-pending.txt'))
  assert.equal(ok, true)
  assert.deepEqual(servers.map((s) => s.health), ['connected', 'needs_auth', 'failed', 'pending_approval'])
})

test('parseMcpList degrades loudly on an unknown status', () => {
  // Reporting a wrong status is far worse than reporting none. An unrecognised
  // line must surface as unparsed so the caller can exit 7.
  const { servers, unparsed, ok } = parseMcpList(fixture('mcp-list-unknown-glyph.txt'))
  assert.equal(ok, false)
  assert.equal(servers.length, 1)
  assert.equal(unparsed.length, 1)
  assert.match(unparsed[0], /Reticulating splines/)
})

test('parseMcpList skips the health-check header and blank lines', () => {
  const { servers } = parseMcpList('Checking MCP server health…\n\n\nfoo: bar - ✔ Connected\n')
  assert.equal(servers.length, 1)
  assert.equal(servers[0].name, 'foo')
})

test('parseHealth matches on words, not glyphs', () => {
  // Glyphs are cosmetic and Anthropic can swap them; the state names are the
  // stable contract.
  assert.equal(parseHealth('✔ Connected'), 'connected')
  assert.equal(parseHealth('Connected'), 'connected')
  assert.equal(parseHealth('★ Connected'), 'connected')
  assert.equal(parseHealth('! Needs authentication'), 'needs_auth')
  assert.equal(parseHealth('✘ Failed to connect'), 'failed')
  assert.equal(parseHealth('⏸ Pending approval'), 'pending_approval')
  assert.equal(parseHealth('Doing something new'), null)
})

// ---------------------------------------------------------------------------
// mcp get
// ---------------------------------------------------------------------------

test('parseMcpGet reads real 2.1.223 output', () => {
  const got = parseMcpGet(fixture('mcp-get.txt'))
  assert.equal(got.ok, true)
  assert.equal(got.name, 'wf-example')
  assert.equal(got.health, 'connected')
  assert.equal(got.type, 'http')
  assert.equal(got.url, 'https://mcp.webflow.com/mcp')
  assert.match(got.scope, /User config/)
})

test('parseMcpGet flags a missing server rather than guessing', () => {
  const got = parseMcpGet('No MCP server named "wf-nope". Configured servers: a, b, c')
  assert.equal(got.notFound, true)
  assert.equal(got.ok, false)
})

// ---------------------------------------------------------------------------
// verify transcripts — the security-critical parser
// ---------------------------------------------------------------------------

test('parseVerifyTranscript extracts one site from a real transcript', () => {
  const v = parseVerifyTranscript(fixture('verify-one-site.jsonl'))
  assert.equal(v.ok, true)
  assert.equal(v.total, 1)
  assert.equal(v.isolated, true)
  assert.deepEqual(v.sites.map((s) => s.name), ['Example Site'])
  assert.deepEqual(v.workspaceIds, ['5f0000000000000000000002'])
})

test('parseVerifyTranscript reports over-scope from pagination.total', () => {
  const v = parseVerifyTranscript(fixture('verify-two-sites.jsonl'))
  assert.equal(v.ok, true)
  assert.equal(v.total, 2)
  assert.equal(v.isolated, false)
  assert.equal(v.workspaceIds.length, 1, 'a grant cannot span workspaces')
})

test('a prose answer with no tool call is NOT a verification', () => {
  // Captured live: in a directory where the server was disabled, the model
  // produced a confident site list having called nothing. Reading the final
  // text would have recorded this as a pass. This is the single most
  // important assertion in the suite.
  const v = parseVerifyTranscript(fixture('verify-no-tool-call.jsonl'))
  assert.equal(v.ok, false)
  assert.equal(v.sawToolUse, false)
  assert.match(v.reason, /never called a tool/)
  assert.equal(v.isolated, false)
  assert.ok(v.finalText, 'the prose is still captured for diagnostics')
})

test('a permission-blocked tool call is "could not tell", not "isolated"', () => {
  const v = parseVerifyTranscript(fixture('verify-permission-blocked.jsonl'))
  assert.equal(v.ok, false)
  assert.equal(v.sawToolUse, true)
  assert.equal(v.isolated, false)
})

test('a <persisted-output> wrapper is never mistaken for the payload', () => {
  // The real transcript persists the 60KB guide-tool result but returns the
  // sites payload inline. The truncated preview inside the wrapper must not be
  // parsed as data.
  const v = parseVerifyTranscript(fixture('verify-persisted-output.jsonl'))
  assert.equal(v.ok, true)
  assert.equal(v.total, 1)
  assert.deepEqual(v.sites.map((s) => s.name), ['Example Site'])
})

test('a persisted sites payload is followed to disk when readable', () => {
  const raw = fixture('verify-sites-persisted.jsonl').replaceAll('FIXTURE_DIR', FIXTURES)
  const v = parseVerifyTranscript(raw, { readFile: (p) => readFileSync(p, 'utf8') })
  assert.equal(v.ok, true)
  assert.equal(v.total, 1)
  assert.deepEqual(v.sites.map((s) => s.name), ['Example Site'])
})

test('a persisted sites payload we cannot read is exit-6, not a pass', () => {
  const raw = fixture('verify-sites-persisted.jsonl').replaceAll('FIXTURE_DIR', FIXTURES)
  const v = parseVerifyTranscript(raw, { readFile: null })
  assert.equal(v.ok, false)
  assert.match(v.reason, /persisted/)
})

test('an event whose message is a bare string does not crash the parser', () => {
  // A bare-string `message` used to crash the parser mid-verify.
  const v = parseVerifyTranscript(fixture('verify-message-is-string.jsonl'))
  assert.equal(v.ok, true)
  assert.equal(v.total, 1)
})

test('a truncated transcript is "could not tell"', () => {
  const v = parseVerifyTranscript('{"type":"assistant","message":{"content":[]}}\n')
  assert.equal(v.ok, false)
  assert.match(v.reason, /result event/)
})

test('garbage lines are skipped without throwing', () => {
  const v = parseVerifyTranscript('not json\n\n{broken\n{"type":"result","result":"hi"}\n')
  assert.equal(v.ok, false)
  assert.equal(v.finalText, 'hi')
})

test('parsePersistedOutput extracts the path', () => {
  const p = parsePersistedOutput('<persisted-output>\nOutput too large (60.8KB). Full output saved to: /tmp/x.json\n\nPreview:\n</persisted-output>')
  assert.equal(p.path, '/tmp/x.json')
  assert.equal(parsePersistedOutput('ordinary text'), null)
})

// ---------------------------------------------------------------------------
// naming, versions, argv
// ---------------------------------------------------------------------------

test('slugify and validateSlug enforce the tool-name charset', () => {
  assert.equal(slugify('Hatchline Studio'), 'hatchline-studio')
  assert.equal(slugify('  Copper & Fox!! '), 'copper-fox')
  assert.equal(slugify('ACME_Corp'), 'acme-corp')

  assert.equal(validateSlug('hatchline'), null)
  assert.equal(validateSlug('a1-b2'), null)
  assert.match(validateSlug(''), /empty/)
  assert.match(validateSlug('-leading'), /must match/)
  assert.match(validateSlug('Upper'), /must match/)
  assert.match(validateSlug('x'.repeat(33)), /32 characters/)
})

test('version parsing and comparison', () => {
  assert.deepEqual(parseVersion('2.1.223 (Claude Code)'), [2, 1, 223])
  assert.equal(parseVersion('unknown'), null)
  assert.equal(compareVersions([2, 1, 223], [2, 1, 186]), 1)
  assert.equal(compareVersions([2, 1, 186], [2, 1, 186]), 0)
  assert.equal(compareVersions([2, 1, 185], [2, 1, 186]), -1)
  assert.equal(compareVersions([2, 0, 999], [2, 1, 0]), -1)
})

test('VERSION matches every published manifest', () => {
  // npm ships only bin/wwm, so VERSION is hardcoded. A bump that forgets
  // any of the four sites would ship a binary that lies about itself.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  const market = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
  assert.equal(pkg.version, VERSION)
  assert.equal(plugin.version, VERSION)
  assert.equal(market.plugins[0].version, VERSION)
})

test('parseArgv separates flags, values and positionals', () => {
  const a = parseArgv(['connect', 'hatchline', '--label', 'Hatchline Studio', '--json'])
  assert.deepEqual(a.positional, ['connect', 'hatchline'])
  assert.equal(a.flags.label, 'Hatchline Studio')
  assert.equal(a.flags.json, true)

  const b = parseArgv(['verify', '--max-age=24h', '--print-command'])
  assert.equal(b.flags['max-age'], '24h')
  assert.equal(b.flags['print-command'], true)

  // --no-browser and --no-verify are real flag names, not negations.
  const c = parseArgv(['connect', 'x', '--no-browser', '--no-verify'])
  assert.equal(c.flags['no-browser'], true)
  assert.equal(c.flags['no-verify'], true)

  const d = parseArgv(['--version'])
  assert.equal(d.flags.version, true)
  assert.deepEqual(d.positional, [])
})

// ---------------------------------------------------------------------------
// the entrypoint guard
// ---------------------------------------------------------------------------

test('isMainPath resolves symlinks before comparing', () => {
  // Caught live: `npm link` puts a symlink on PATH, so argv[1] was
  // ~/.nvm/.../bin/wwm while import.meta.url pointed at the real bin/wwm. The
  // old URL comparison was false, so `wwm doctor` printed nothing and exited 0.
  // A CLI that silently succeeds is worse than one that crashes.
  const self = fileURLToPath(import.meta.url)
  const link = join(dirname(self), 'fixtures', '.wwm-link-probe')

  try { unlinkSync(link) } catch {}
  symlinkSync(self, link)
  try {
    assert.equal(isMainPath(link, import.meta.url), true, 'a symlink to this module IS main')
    assert.equal(isMainPath(self, import.meta.url), true, 'the direct path is still main')
  } finally {
    unlinkSync(link)
  }
})

test('isMainPath is false when imported as a module', () => {
  // The other half of the contract: importing bin/wwm from a test must not run
  // the CLI. Without this, "fix" the guard by returning true and 25 tests pass.
  assert.equal(isMainPath('/usr/bin/node', import.meta.url), false)
  assert.equal(isMainPath(undefined, import.meta.url), false)
  assert.equal(isMainPath('', import.meta.url), false)
})

test('isMainPath does not throw on a nonexistent argv[1]', () => {
  // realpath() on a deleted/renamed path throws ENOENT; the guard must fall
  // back to the literal path rather than taking down the process at startup.
  assert.equal(isMainPath('/nonexistent/path/wwm', import.meta.url), false)
})

// ---------------------------------------------------------------------------
// activation — the differentiator, and the one with silent failure modes
// ---------------------------------------------------------------------------

test('parseWickedFile ignores comments and blank lines', () => {
  const entries = parseWickedFile('# clients active here\n\nhatchline\r\nwf-copperfox  # the EU one\n\n')
  assert.deepEqual(entries, ['hatchline', 'wf-copperfox'])
})

test('an empty .wicked-webflow means none, not all', () => {
  // The file is a deliberate statement by whoever committed it. Falling back
  // to "all" on an empty list would invert their intent while looking correct.
  assert.deepEqual(parseWickedFile('# nothing here\n'), [])
  const r = resolveActiveSet({ owned: ['wf-a', 'wf-b'], fileEntries: [] })
  assert.deepEqual(r.active, [])
  assert.equal(r.source, WICKED_FILE)
})

test('toServerName accepts a slug or a full server name', () => {
  assert.equal(toServerName('hatchline'), 'wf-hatchline')
  assert.equal(toServerName('wf-hatchline'), 'wf-hatchline')
  assert.equal(toServerName('Hatchline Studio'), 'wf-hatchline-studio')
  assert.equal(toServerName('acme', 'client-'), 'client-acme')
})

test('resolveActiveSet precedence: file, then state, then all', () => {
  const owned = ['wf-a', 'wf-b']
  assert.deepEqual(resolveActiveSet({ owned, fileEntries: ['a'], stateActive: ['wf-b'] }).active, ['wf-a'])
  assert.deepEqual(resolveActiveSet({ owned, stateActive: ['wf-b'] }).active, ['wf-b'])
  assert.deepEqual(resolveActiveSet({ owned }).active, ['wf-a', 'wf-b'])
  assert.equal(resolveActiveSet({ owned }).source, 'default (all)')
})

test('a name in .wicked-webflow we do not manage is reported, not silently dropped', () => {
  // A typo in a committed file otherwise looks like a working config that
  // happens to load nothing.
  const r = resolveActiveSet({ owned: ['wf-a'], fileEntries: ['a', 'hatchlnie'] })
  assert.deepEqual(r.active, ['wf-a'])
  assert.deepEqual(r.unknown, ['wf-hatchlnie'])
})

test('mergeDisabled never touches servers we do not own', () => {
  // Users disable unrelated servers by hand via /mcp. Wiping those would be us
  // breaking a setting nobody asked us to touch.
  const out = mergeDisabled(['pencil', 'wf-a'], ['wf-a', 'wf-b'], ['wf-a'])
  assert.deepEqual(out, ['pencil', 'wf-b'])
})

test('mergeDisabled is idempotent — the hook runs it every session start', () => {
  const owned = ['wf-a', 'wf-b', 'wf-c']
  const once = mergeDisabled(['pencil'], owned, ['wf-b'])
  const twice = mergeDisabled(once, owned, ['wf-b'])
  assert.deepEqual(once, twice)
  assert.deepEqual(once, ['pencil', 'wf-a', 'wf-c'])
})

test('mergeDisabled with an empty active set disables every owned name', () => {
  assert.deepEqual(mergeDisabled([], ['wf-a', 'wf-b'], []), ['wf-a', 'wf-b'])
})

test('mergeDisabled dedupes and drops non-strings', () => {
  assert.deepEqual(mergeDisabled(['pencil', 'pencil', 7, null], ['wf-a'], []), ['pencil', 'wf-a'])
  assert.deepEqual(mergeDisabled(undefined, ['wf-a'], []), ['wf-a'])
})

test('sameList compares order-sensitively', () => {
  assert.equal(sameList(['a', 'b'], ['a', 'b']), true)
  assert.equal(sameList(['a', 'b'], ['b', 'a']), false)
  assert.equal(sameList(['a'], ['a', 'b']), false)
  assert.equal(sameList(null, []), false)
})

// --- end-to-end, against throwaway files -------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WWM = join(ROOT, 'bin', 'wwm')

/** Run the real CLI against a scratch ~/.claude.json and plugin data dir. */
function sandbox(t, { claudeJson = { projects: {} }, connections = ['wf-a', 'wf-b'] } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'wwm-test-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))

  const data = join(base, 'data')
  mkdirSync(data, { recursive: true })
  const jsonPath = join(base, 'claude.json')
  writeFileSync(jsonPath, JSON.stringify(claudeJson, null, 2))
  writeFileSync(
    join(data, 'state.json'),
    JSON.stringify({
      version: 1,
      connections: Object.fromEntries(connections.map((n) => [n, { label: n, addedAt: '2026-01-01T00:00:00Z' }])),
      projects: {},
    })
  )

  const env = { ...process.env, WWM_CLAUDE_JSON: jsonPath, CLAUDE_PLUGIN_DATA: data }
  return {
    base,
    data,
    run: (args, opts = {}) => JSON.parse(execFileSync(process.execPath, [WWM, ...args, '--json'], { env, encoding: 'utf8', ...opts })),
    config: () => JSON.parse(readFileSync(jsonPath, 'utf8')),
  }
}

test('switch writes the RESOLVED cwd, not the path it was given', (t) => {
  // The silent-success bug: write projects["/tmp/x"] when Claude Code reads
  // projects["/private/tmp/x"] and activation appears to work while the next
  // session loads everything. Nothing surfaces it — status reads back what we
  // just wrote — so it needs an explicit assertion, not a smoke test.
  const box = sandbox(t)
  const real = join(box.base, 'project')
  const link = join(box.base, 'link-to-project')
  mkdirSync(real)
  symlinkSync(real, link)

  const out = box.run(['switch', 'a', '--project', link])
  const key = realpathSync(real)

  assert.notEqual(key, link, 'the fixture must actually involve a symlink')
  assert.equal(out.cwd, key)
  assert.ok(box.config().projects[key], `expected projects[${key}]`)
  assert.equal(box.config().projects[link], undefined, 'the symlink path must never become a key')
  assert.deepEqual(box.config().projects[key].disabledMcpServers, ['wf-b'])
})

test('switch preserves entries the user disabled themselves', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'wwm-proj-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const key = realpathSync(project)

  const box = sandbox(t, { claudeJson: { projects: { [key]: { disabledMcpServers: ['pencil'], hasTrustDialogAccepted: true } } } })
  box.run(['switch', 'b', '--project', project])

  const entry = box.config().projects[key]
  assert.deepEqual(entry.disabledMcpServers, ['pencil', 'wf-a'])
  assert.equal(entry.hasTrustDialogAccepted, true, 'unrelated keys in the project entry must survive')
})

test('switch --none suppresses the claude.ai connector, and switch back restores it', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'wwm-proj-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const box = sandbox(t)
  const settings = join(project, '.claude', 'settings.json')

  // --yes is consent: the key disables every claude.ai connector in the
  // project, so it is never written without being asked for.
  const none = box.run(['switch', '--none', '--project', project, '--yes'])
  assert.deepEqual(none.active, [])
  assert.equal(none.connector, 'suppressed')
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).disableClaudeAiConnectors, true)

  const back = box.run(['switch', 'a', '--project', project])
  assert.equal(back.connector, 'restored')
  // `{}` is not a setting — removing the only key removes the file rather than
  // leaving a meaningless one in the user's repo forever.
  assert.equal(existsSync(settings), false)
})

test('switch --none keeps a settings file that has other keys in it', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'wwm-proj-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  mkdirSync(join(project, '.claude'))
  const settings = join(project, '.claude', 'settings.json')
  writeFileSync(settings, JSON.stringify({ model: 'opus' }))

  const box = sandbox(t)
  box.run(['switch', '--none', '--project', project, '--yes'])
  box.run(['switch', 'a', '--project', project])

  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')), { model: 'opus' })
})

test('switch leaves a connector key it did not write alone', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'wwm-proj-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  mkdirSync(join(project, '.claude'))
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ disableClaudeAiConnectors: true }))

  const box = sandbox(t)
  const out = box.run(['switch', 'a', '--project', project])
  assert.match(out.connector, /not ours/)
  assert.equal(JSON.parse(readFileSync(join(project, '.claude', 'settings.json'), 'utf8')).disableClaudeAiConnectors, true)
})

test('switch rejects a name it does not manage instead of writing a useless key', (t) => {
  const box = sandbox(t)
  assert.throws(() => box.run(['switch', 'nope', '--project', box.base]), (err) => err.status === 2)
})

test('activate reads .wicked-webflow, and it outranks plugin state', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'wwm-proj-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const key = realpathSync(project)
  const box = sandbox(t)

  box.run(['switch', 'a', '--project', project])
  writeFileSync(join(project, WICKED_FILE), '# committed by a teammate\nb\n')

  const out = box.run(['activate', '--for-cwd', '--project', project])
  assert.equal(out.source, WICKED_FILE)
  assert.deepEqual(out.active, ['wf-b'])
  assert.deepEqual(box.config().projects[key].disabledMcpServers, ['wf-a'])
})

test('activate never fails the session, whatever it finds', (t) => {
  // It runs on every single session start. A corrupt config, an unreadable
  // state file, or a directory nobody has ever opened must all exit 0 — a hook
  // that blocks a session is worse than one that does nothing.
  const box = sandbox(t)
  writeFileSync(join(box.base, 'claude.json'), '{ not json')

  // execFileSync throws on a non-zero exit, so reaching the assertions at all
  // is the exit-0 assertion.
  const out = box.run(['activate', '--for-cwd', '--project', box.base])
  assert.equal(out.ok, false, 'the failure is still reported, just not fatal')
  assert.match(out.error, /could not read/)
  assert.ok(existsSync(join(box.data, 'activate.log')))
  assert.match(readFileSync(join(box.data, 'activate.log'), 'utf8'), /FAILED/)
})

test('activate with no connections is a no-op', (t) => {
  const box = sandbox(t, { connections: [] })
  const out = box.run(['activate', '--for-cwd', '--project', box.base])
  assert.equal(out.ok, true)
  assert.deepEqual(box.config().projects, {})
})

test('a persisted path containing spaces is captured whole', () => {
  // Regression: an early version captured to the first whitespace, which broke
  // for anyone whose home directory has a space in it.
  const p = parsePersistedOutput('<persisted-output>\nOutput too large (60.8KB). Full output saved to: /Users/me/My Projects/x.json\n\nPreview:\n</persisted-output>')
  assert.equal(p.path, '/Users/me/My Projects/x.json')
})
