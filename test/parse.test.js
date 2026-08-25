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
  VERIFY_STALE_MS,
  WICKED_FILE,
  applyKey,
  compareVersions,
  dashboardProblems,
  decodeKey,
  describeVerification,
  diffSites,
  formatSites,
  initPicker,
  isMainPath,
  menuItems,
  mergeDisabled,
  mutatesServerList,
  parseArgv,
  pickedIndexes,
  renderPicker,
  switchArgv,
  verifyCost,
  verifyPlan,
  parseHealth,
  reauthReport,
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
  // line must be reported as unparsed so the caller can exit 7.
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
// verify transcripts. The security-critical parser
// ---------------------------------------------------------------------------

test('parseVerifyTranscript extracts one site from a real transcript', () => {
  const v = parseVerifyTranscript(fixture('verify-one-site.jsonl'))
  assert.equal(v.ok, true)
  assert.equal(v.total, 1)
  assert.equal(v.singleSite, true)
  assert.deepEqual(v.sites.map((s) => s.name), ['Example Site'])
  assert.deepEqual(v.workspaceIds, ['5f0000000000000000000002'])
})

test('a multi-site grant is a normal result, not a failure', () => {
  // Webflow's consent screen is multi-select on purpose. Authorizing a client's
  // several sites in one grant is a thing users do deliberately, so this reports
  // the count and the names and passes.
  const v = parseVerifyTranscript(fixture('verify-two-sites.jsonl'))
  assert.equal(v.ok, true)
  assert.equal(v.total, 2)
  assert.equal(v.singleSite, false)
  assert.equal(v.sites.length, 2)
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
  assert.equal(v.singleSite, null, 'not false — we learned nothing about the site count')
  assert.ok(v.finalText, 'the prose is still captured for diagnostics')
})

test('a permission-blocked tool call is "could not tell"', () => {
  const v = parseVerifyTranscript(fixture('verify-permission-blocked.jsonl'))
  assert.equal(v.ok, false)
  assert.equal(v.sawToolUse, true)
  assert.equal(v.singleSite, null)
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
  assert.equal(slugify('Dino Studios'), 'dino-studios')
  assert.equal(slugify('  Stones & Boots!! '), 'stones-boots')
  assert.equal(slugify('ACME_Corp'), 'acme-corp')

  assert.equal(validateSlug('dino'), null)
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
  const a = parseArgv(['connect', 'dino', '--label', 'Dino Studios', '--json'])
  assert.deepEqual(a.positional, ['connect', 'dino'])
  assert.equal(a.flags.label, 'Dino Studios')
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
  // The other half of the contract. Importing bin/wwm from a test must not run
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
// the status SITES cell
// ---------------------------------------------------------------------------

test('formatSites states the facts without editorialising', () => {
  // A multi-site grant used to print a ⚠ here. It is a normal authorization.
  // The cell reports what the connection reaches and lets the user judge it.
  assert.equal(formatSites(['Dino'], ' (2h ago)'), 'Dino (2h ago)')
  assert.equal(formatSites(['A', 'B', 'C'], ''), '3: A, B, C')
  assert.ok(!formatSites(['A', 'B', 'C'], '').includes('⚠'))
  assert.equal(formatSites(null), 'unverified')
  assert.equal(formatSites([], ''), 'none')
})

test('formatSites drops whole names rather than clipping one', () => {
  // A clipped name reads as a different site, and telling two sites apart is
  // the entire reason this cell prints names at all.
  const out = formatSites(['Dino Marketing', 'Dino Market Research'], '', SITES_COL)
  assert.ok(out.length <= SITES_COL, `"${out}" is ${out.length} wide, budget ${SITES_COL}`)
  assert.match(out, /\+1$/)
})

// ---------------------------------------------------------------------------
// activation. The differentiator, and the one with silent failure modes
// ---------------------------------------------------------------------------

test('parseWickedFile ignores comments and blank lines', () => {
  const entries = parseWickedFile('# clients active here\n\ndino\r\nwf-stonesboots  # the EU one\n\n')
  assert.deepEqual(entries, ['dino', 'wf-stonesboots'])
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
  assert.equal(toServerName('dino'), 'wf-dino')
  assert.equal(toServerName('wf-dino'), 'wf-dino')
  assert.equal(toServerName('Dino Studios'), 'wf-dino-studios')
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
  // session loads everything. Nothing shows it. status reads back what we
  // just wrote, so it needs an explicit assertion, not a smoke test.
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

  // --yes is consent. The key disables every claude.ai connector in the
  // project, so it is never written without being asked for.
  const none = box.run(['switch', '--none', '--project', project, '--yes'])
  assert.deepEqual(none.active, [])
  assert.equal(none.connector, 'suppressed')
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).disableClaudeAiConnectors, true)

  const back = box.run(['switch', 'a', '--project', project])
  assert.equal(back.connector, 'restored')
  // `{}` is not a setting. Removing the only key removes the file rather than
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

test('switch --default forgets plugin state so later connections load too', (t) => {
  // `--all` writes the current owned names. A connection added after that stays
  // off in the project, which is the opposite of "go back to default". Default
  // means deleting the remembered set, not snapshotting everything that exists
  // right now.
  const project = mkdtempSync(join(tmpdir(), 'wwm-proj-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const key = realpathSync(project)
  const box = sandbox(t)

  box.run(['switch', 'a', '--project', project])
  assert.deepEqual(JSON.parse(readFileSync(join(box.data, 'state.json'), 'utf8')).projects[key].active, ['wf-a'])
  assert.equal(box.run(['activate', '--for-cwd', '--project', project]).source, 'plugin state')

  const out = box.run(['switch', '--default', '--project', project])
  assert.deepEqual(out.active, ['wf-a', 'wf-b'])
  assert.equal(out.source, 'default (all)')
  assert.equal(JSON.parse(readFileSync(join(box.data, 'state.json'), 'utf8')).projects[key].active, undefined)
  assert.deepEqual(box.config().projects[key].disabledMcpServers, [])
  assert.equal(box.run(['activate', '--for-cwd', '--project', project]).source, 'default (all)')
})

test('switch --all still remembers the set — that is not default', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'wwm-proj-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const key = realpathSync(project)
  const box = sandbox(t)

  const out = box.run(['switch', '--all', '--project', project])
  assert.deepEqual(out.active, ['wf-a', 'wf-b'])
  assert.equal(out.source, 'plugin state')
  assert.deepEqual(JSON.parse(readFileSync(join(box.data, 'state.json'), 'utf8')).projects[key].active, ['wf-a', 'wf-b'])
})

test('switch --default cannot be combined with a set', (t) => {
  const box = sandbox(t)
  assert.throws(() => box.run(['switch', '--default', '--all', '--project', box.base]), (err) => err.status === 2)
  assert.throws(() => box.run(['switch', '--default', '--write', '--project', box.base]), (err) => err.status === 2)
  assert.throws(() => box.run(['switch', 'a', '--default', '--project', box.base]), (err) => err.status === 2)
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
  // state file, or a directory nobody has ever opened must all exit 0. A hook
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

// --- the mcp list cache ------------------------------------------------------

test('mutatesServerList recognises everything that changes the list', () => {
  for (const sub of ['add', 'remove', 'login', 'logout']) {
    assert.equal(mutatesServerList(['mcp', sub, 'wf-a']), true, `mcp ${sub} changes the list`)
  }
  // Reads must not drop the cache, or the dashboard health-checks every server
  // on every menu redraw and the cache stops being a cache.
  assert.equal(mutatesServerList(['mcp', 'list']), false)
  assert.equal(mutatesServerList(['mcp', 'get', 'wf-a']), false)
  assert.equal(mutatesServerList(['--version']), false)
  assert.equal(mutatesServerList(['-p', 'call data_sites_tool']), false)
  assert.equal(mutatesServerList([]), false)
  assert.equal(mutatesServerList(undefined), false)
})

test('removing a connection drops the list cache', (t) => {
  // Reported from a real run: after `remove`, the menu redrew from a 60s-old
  // snapshot and still listed the connection that had just been destroyed.
  // Pressing `r` fixed it, which is exactly the tell for a stale cache.
  const base = mkdtempSync(join(tmpdir(), 'wwm-cache-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))

  const data = join(base, 'data')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'state.json'), JSON.stringify({
    version: 1,
    connections: { 'wf-a': { label: 'A', addedAt: '2026-01-01T00:00:00Z' } },
    projects: {},
  }))

  // A stub `claude` so no real CLI, network or credential is involved.
  const stub = join(base, 'claude')
  writeFileSync(stub, '#!/bin/sh\ncase "$1" in\n  --version) echo "2.1.223 (Claude Code)" ;;\nesac\nexit 0\n', { mode: 0o755 })

  const cache = join(data, 'mcp-list-cache.json')
  writeFileSync(cache, JSON.stringify({
    at: Date.now(),
    data: { servers: [{ name: 'wf-a', target: 'https://mcp.webflow.com/mcp', health: 'connected', statusText: '✔ Connected', raw: '' }], unparsed: [], ok: true },
  }))
  assert.ok(existsSync(cache), 'the fixture must start with a warm cache')

  execFileSync(process.execPath, [WWM, 'remove', 'wf-a', '--yes', '--json'], {
    env: {
      ...process.env,
      WWM_CLAUDE_BIN: stub,
      WWM_CLAUDE_JSON: join(base, 'claude.json'),
      CLAUDE_PLUGIN_DATA: data,
    },
    encoding: 'utf8',
  })

  assert.equal(existsSync(cache), false, 'the next read must go to `claude mcp list`, not to a snapshot taken before the removal')
})

// ---------------------------------------------------------------------------
// interactive kernel
//
// The picker is a pure state machine wrapped in a read loop, so a key script
// exercises everything that decides what the user sees. Only the loop that
// gets bytes and the writes that paint them are untested here, and neither
// makes a decision.
// ---------------------------------------------------------------------------

/** Drive a picker with a key script, the way the read loop would. */
function drive(state, keys) {
  for (const k of keys) {
    state = applyKey(state, typeof k === 'string' ? { name: k } : k)
    if (state.done || state.cancelled || state.action) break
  }
  return state
}

const char = (c) => ({ name: 'char', char: c })

test('decodeKey reads arrows as whole escape sequences', () => {
  // This only works because a Down arrow arrives as ONE 3-byte read, so a
  // lone 0x1b is unambiguously Escape and no disambiguation timer is needed.
  assert.deepEqual(decodeKey([0x1b, 0x5b, 0x41]), { name: 'up' })
  assert.deepEqual(decodeKey([0x1b, 0x5b, 0x42]), { name: 'down' })
  assert.deepEqual(decodeKey([0x1b]), { name: 'esc' })

  // Application-cursor mode (ESC O A) is not exotic. tmux copy-mode, less,
  // and some ssh sessions all produce it.
  assert.deepEqual(decodeKey([0x1b, 0x4f, 0x41]), { name: 'up' })
})

test('decodeKey maps the control keys a picker needs', () => {
  assert.deepEqual(decodeKey([0x03]), { name: 'ctrl-c' })
  assert.deepEqual(decodeKey([0x0d]), { name: 'enter' })
  assert.deepEqual(decodeKey([0x0a]), { name: 'enter' })
  assert.deepEqual(decodeKey([0x20]), { name: 'space' })
  assert.deepEqual(decodeKey([0x7f]), { name: 'backspace' })
  assert.deepEqual(decodeKey([]), { name: 'none' })
  assert.deepEqual(decodeKey([0x61]), { name: 'char', char: 'a' })
})

test('decodeKey does not mistake a multi-byte character for a control key', () => {
  assert.deepEqual(decodeKey(Buffer.from('é', 'utf8')), { name: 'char', char: 'é' })
})

const THREE = [{ label: 'wf-a' }, { label: 'wf-b' }, { label: 'wf-c' }]

test('the cursor wraps at both ends', () => {
  const up = drive(initPicker({ items: THREE }), ['up'])
  assert.equal(up.cursor, 2, 'up from the first row lands on the last')
  const down = drive(initPicker({ items: THREE, cursor: 2 }), ['down'])
  assert.equal(down.cursor, 0)
})

test('space toggles only in a multiselect', () => {
  const multi = drive(initPicker({ items: THREE, multi: true }), ['space', 'down', 'space'])
  assert.deepEqual(pickedIndexes(multi), [0, 1])

  const single = drive(initPicker({ items: THREE }), ['space'])
  assert.deepEqual(pickedIndexes(single), [], 'space is inert in a single select')
})

test('enter in a single select resolves to the row under the cursor', () => {
  const s = drive(initPicker({ items: THREE, checked: [true, false, false] }), ['down', 'enter'])
  assert.equal(s.done, true)
  assert.deepEqual(pickedIndexes(s), [1], 'the pre-checked row must not leak into a single select')
})

test('a and n select all and none', () => {
  const all = drive(initPicker({ items: THREE, multi: true }), [char('a')])
  assert.deepEqual(pickedIndexes(all), [0, 1, 2])
  const none = drive(initPicker({ items: THREE, multi: true, checked: [true, true, true] }), [char('n')])
  assert.deepEqual(pickedIndexes(none), [])
})

test('cancelling is distinguishable from confirming an empty selection', () => {
  // switch --none deactivates everything. If escape and "confirm with nothing
  // ticked" collapsed into the same answer, backing out of the picker would
  // silently unload every connection in the project.
  const escaped = drive(initPicker({ items: THREE, multi: true, checked: [true, false, false] }), ['esc'])
  assert.equal(escaped.cancelled, true)
  assert.equal(escaped.done, false)

  const emptied = drive(initPicker({ items: THREE, multi: true, checked: [true, false, false] }), [char('n'), 'enter'])
  assert.equal(emptied.cancelled, false)
  assert.equal(emptied.done, true)
  assert.deepEqual(pickedIndexes(emptied), [])
})

test('ctrl-c and EOF cancel rather than confirming', () => {
  for (const key of ['ctrl-c', 'eof']) {
    const s = drive(initPicker({ items: THREE, multi: true, checked: [true, true, true] }), [key])
    assert.equal(s.cancelled, true, `${key} must cancel`)
    assert.equal(s.done, false)
  }
})

test('a registered hotkey escapes the loop without confirming', () => {
  const s = drive(initPicker({ items: THREE, hotkeys: ['r'] }), [char('r')])
  assert.equal(s.action, 'r')
  assert.equal(s.done, false)
  assert.equal(s.cancelled, false)
})

test('an unregistered letter is inert, not a hotkey', () => {
  const s = drive(initPicker({ items: THREE, hotkeys: [] }), [char('r')])
  assert.equal(s.action, null)
  assert.equal(s.cursor, 0)
})

test('number keys jump, and toggle in a multiselect', () => {
  const multi = drive(initPicker({ items: THREE, multi: true }), [char('3')])
  assert.equal(multi.cursor, 2)
  assert.deepEqual(pickedIndexes(multi), [2])

  const out = drive(initPicker({ items: THREE, multi: true }), [char('9')])
  assert.equal(out.cursor, 0, 'a number past the end must not move the cursor off the list')
})

test('applyKey never mutates the state it was given', () => {
  const before = initPicker({ items: THREE, multi: true })
  const snapshot = JSON.stringify(before)
  applyKey(before, { name: 'space' })
  applyKey(before, { name: 'down' })
  assert.equal(JSON.stringify(before), snapshot)
})

test('an empty picker can still be escaped', () => {
  const s = drive(initPicker({ items: [], multi: true }), ['down', 'space', 'esc'])
  assert.equal(s.cancelled, true)
})

test('renderPicker marks the cursor and the checked rows', () => {
  const state = initPicker({ items: THREE, multi: true, checked: [true, false, false], cursor: 1 })
  const lines = renderPicker(state, { width: 60 })
  assert.match(lines[0], /◉ wf-a/)
  assert.match(lines[1], /^\s+❯ ◯ wf-b/, 'the cursor row carries the marker')
  assert.ok(lines.some((l) => /space toggle/.test(l)), 'multiselect keys are advertised')
  assert.ok(lines.every((l) => !/\x1b\[/.test(l)), 'no colour unless asked for')
})

test('the footer is inside the redrawn block so a live figure can move', () => {
  const state = initPicker({ items: THREE, multi: true, checked: [true, true, false] })
  const lines = renderPicker(state, { width: 60, footer: (s) => `${pickedIndexes(s).length} selected` })
  assert.ok(lines.some((l) => l.includes('2 selected')))
})

test('renderPicker clips rather than wrapping a narrow terminal', () => {
  const state = initPicker({ items: [{ label: 'wf-a', hint: 'x'.repeat(200) }] })
  for (const line of renderPicker(state, { width: 40 })) {
    assert.ok(line.length <= 40, `line overflowed: ${line.length}`)
  }
})

// ---------------------------------------------------------------------------
// flow decisions
// ---------------------------------------------------------------------------

const ROW = (over = {}) => ({
  server: 'wf-a', label: 'A', health: 'connected', sites: ['A'],
  verifiedAt: '2026-08-14T00:00:00Z', verifyFailed: false, active: true, workspaceIds: [], ...over,
})

test('verify pre-selects the cheap correct set, not everything', () => {
  // A bare interactive `verify` must not re-buy results it already has.
  // Fresh rows arrive unticked.
  const now = Date.parse('2026-08-15T00:00:00Z')
  const plan = verifyPlan([
    ROW({ server: 'fresh', verifiedAt: '2026-08-14T00:00:00Z' }),
    ROW({ server: 'stale', verifiedAt: '2026-06-01T00:00:00Z' }),
    ROW({ server: 'never', verifiedAt: null, sites: null }),
    ROW({ server: 'failed', verifiedAt: '2026-08-14T00:00:00Z', verifyFailed: true }),
  ], { now })

  assert.deepEqual(plan.map((p) => p.preselect), [false, true, true, true])
  assert.equal(plan[0].stale, false)
  assert.equal(plan[1].stale, true)
  assert.equal(plan[2].never, true)
})

test('an unparseable verifiedAt counts as never checked, not as fresh', () => {
  // Reading a corrupt timestamp as "recent" would silently skip the check.
  const plan = verifyPlan([ROW({ verifiedAt: 'not a date' })], { now: Date.now() })
  assert.equal(plan[0].never, true)
  assert.equal(plan[0].preselect, true)
})

test('the staleness window is a week', () => {
  assert.equal(VERIFY_STALE_MS, 7 * 24 * 60 * 60 * 1000)
})

test('verifyCost is the figure shown before the money is spent', () => {
  assert.deepEqual(verifyCost(0), { count: 0, usd: 0, seconds: 0 })
  assert.deepEqual(verifyCost(3), { count: 3, usd: 0.12, seconds: 27 })
})

test('switchArgv collapses to --all and --none', () => {
  const owned = ['wf-a', 'wf-b']
  assert.deepEqual(switchArgv({ active: [], owned }), ['switch', '--none'])
  assert.deepEqual(switchArgv({ active: ['wf-a', 'wf-b'], owned }), ['switch', '--all'])
  assert.deepEqual(switchArgv({ active: ['wf-a'], owned }), ['switch', 'a'])
  assert.deepEqual(switchArgv({ active: ['wf-a'], owned, write: true }), ['switch', 'a', '--write'])
})

test('switchArgv strips the configured prefix, not a hardcoded one', () => {
  assert.deepEqual(switchArgv({ active: ['x-a'], owned: ['x-a', 'x-b'], pfx: 'x-' }), ['switch', 'a'])
})

test('the dashboard leads with a file conflict, because it undoes the switch', () => {
  const problems = dashboardProblems({
    rows: [ROW()],
    activation: { fileConflict: true, connectorsSuppressed: false },
  })
  assert.equal(problems[0].id, 'file-conflict')
})

test('the built-in claude.ai connector is never reported as a problem', () => {
  // Choosing `--none` and using Claude Code's own Webflow connector is a
  // legitimate end state, not a defect. Flagging it warns someone about a
  // decision they just made, and promoting it to the first menu row as
  // "Fix this" claims the tool knows better. It is stated neutrally on the
  // dashboard; the choice belongs at the moment of switching to none.
  const rows = [ROW({ active: false })]
  for (const connectorsSuppressed of [true, false]) {
    const problems = dashboardProblems({ rows, activation: { connectorsSuppressed } })
    assert.ok(
      !problems.some((p) => p.id === 'connector-hole'),
      `connectorsSuppressed=${connectorsSuppressed} must not raise a problem`
    )
  }
})

test('an empty active set does not become a menu row on its own', () => {
  const rows = [ROW({ active: false })]
  const problems = dashboardProblems({ rows, activation: { connectorsSuppressed: false } })
  const items = menuItems({ rows, problems })
  assert.ok(!items.some((i) => i.id.startsWith('fix-connector')), 'nothing to fix')
  assert.equal(items[0].id, 'switch', 'the menu opens on the normal first action')
})

test('never-checked connections are surfaced, and a failed check is not called unchecked', () => {
  const unchecked = dashboardProblems({ rows: [ROW({ sites: null, verifiedAt: null })], activation: {} })
  assert.ok(unchecked.some((p) => p.id === 'unverified'))

  const failed = dashboardProblems({ rows: [ROW({ sites: null, verifyFailed: true })], activation: {} })
  assert.ok(!failed.some((p) => p.id === 'unverified'), 'a failed check is its own state')
})

test('no connections means no problems to report', () => {
  assert.deepEqual(dashboardProblems({ rows: [], activation: { fileConflict: true } }), [])
})

test('the menu is derived from state, and never offers Status', () => {
  const empty = menuItems({ rows: [], problems: [] })
  assert.deepEqual(empty.map((i) => i.id), ['connect', 'doctor'])

  const full = menuItems({ rows: [ROW()], problems: [] })
  assert.deepEqual(full.map((i) => i.id), ['switch', 'connect', 'verify', 'reauth', 'remove', 'doctor'])
  assert.ok(!full.some((i) => i.id === 'status'), 'the dashboard above the menu is status')
})

test('the top problem becomes the first menu row', () => {
  const problems = dashboardProblems({ rows: [ROW()], activation: { fileConflict: true } })
  const items = menuItems({ rows: [ROW()], problems })
  assert.equal(items[0].id, 'fix-file-conflict')
  assert.equal(items[0].label, problems[0].fix)
})

test('describeVerification does not spend width repeating the age column', () => {
  assert.equal(describeVerification(ROW({ sites: ['A', 'B'] })), '2 sites — A, B')
  assert.equal(describeVerification(ROW({ sites: null })), 'never checked')
  assert.equal(describeVerification(ROW({ sites: null, verifyFailed: true })), 'last check failed')
})

// ---------------------------------------------------------------------------
// reauthorization
// ---------------------------------------------------------------------------

test('diffSites names what a reauthorization added and dropped', () => {
  const d = diffSites(['A', 'B'], ['B', 'C'])
  assert.deepEqual(d.added, ['C'])
  assert.deepEqual(d.removed, ['A'])
  assert.equal(d.same, false)
  assert.equal(d.unknown, false)
})

test('diffSites treats order and duplicates as noise, not as change', () => {
  const d = diffSites(['B', 'A'], ['A', 'B', 'B'])
  assert.equal(d.same, true)
  assert.deepEqual(d.sites, ['A', 'B'])
})

test('diffSites does not claim every site was added when the old grant was never checked', () => {
  // The dangerous confusion: "we never looked at the old grant" is not "the old
  // grant reached nothing". Reporting `added: [everything]` would tell someone
  // their reauthorization widened a scope when it may have narrowed it.
  const d = diffSites(null, ['A'])
  assert.equal(d.unknown, true)
  assert.equal(d.same, false)
  assert.deepEqual(d.removed, [])
})

test('an unchanged site list after a reauthorization is reported, not swallowed', () => {
  // The whole point of reauthorizing is usually to change the list. Coming back
  // with the same one is a real outcome with a known cause, and reporting only
  // the site names would let someone believe they had changed something.
  const lines = reauthReport(diffSites(['A'], ['A']), 'wf-x').join('\n')
  assert.match(lines, /same list as before/)
  assert.match(lines, /app settings/, 'must say where to revoke so the picker is shown again')

  const changed = reauthReport(diffSites(['A'], ['B']), 'wf-x').join('\n')
  assert.doesNotMatch(changed, /same list/)
  assert.match(changed, /added:\s+B/)
  assert.match(changed, /dropped:\s+A/)
})

test('reauthReport says nothing when there is no before to compare against', () => {
  assert.deepEqual(reauthReport(diffSites(null, ['A']), 'wf-x'), [])
  assert.deepEqual(reauthReport(null, 'wf-x'), [])
})

// ---------------------------------------------------------------------------
// distribution guards
// ---------------------------------------------------------------------------

test('bin/wwm imports nothing npm would have to install', () => {
  // The plugin ships as a bare git clone with no node_modules, and
  // hooks/hooks.json runs this file on every SessionStart. A dependency here
  // is an unresolved-module crash before main(), which breaks every plugin
  // user's sessions, including the never-fatal activate hook. See
  // internal/INTERACTIVE-UX.md.
  const source = readFileSync(WWM, 'utf8')
  const specifiers = [...source.matchAll(/^import\s[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
  assert.ok(specifiers.length > 0, 'expected to find some imports to check')
  for (const spec of specifiers) {
    assert.ok(spec.startsWith('node:'), `bin/wwm must only import node: builtins, found "${spec}"`)
  }
})

test('bare wwm without a terminal is usage and exit 2, exactly as before', (t) => {
  // The interactive dashboard must never reach a pipe, the agent's Bash tool,
  // or CI. Anything automated that runs bare `wwm` has to keep getting the
  // same bytes and the same exit code.
  const box = sandbox(t)
  let status = 0
  let stdout = ''
  try {
    stdout = execFileSync(process.execPath, [WWM], {
      env: { ...process.env, WWM_CLAUDE_JSON: join(box.base, 'claude.json'), CLAUDE_PLUGIN_DATA: box.data },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e) {
    status = e.status
    stdout = e.stdout
  }
  assert.equal(status, 2)
  assert.match(stdout, /wwm — per-client Webflow MCP connections/)
  assert.ok(!/↑↓ move/.test(stdout), 'no picker may render without a terminal')
})
