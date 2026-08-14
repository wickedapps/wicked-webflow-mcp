// Parser regression suite.
//
// Fixtures under test/fixtures/<version>/ pin parser shapes for that Claude
// Code version. `claude mcp list` and `claude mcp get` have no --json, so this
// suite is what tells us a Claude Code release broke the plugin. Add a new
// fixture directory per supported version; never edit an old one just to make
// a test pass.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SITES_COL,
  compareVersions,
  formatSites,
  isMainPath,
  parseArgv,
  parseHealth,
  parseMcpGet,
  parseMcpList,
  parsePersistedOutput,
  parseVerifyTranscript,
  parseVersion,
  slugify,
  validateSlug,
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

test('a persisted path containing spaces is captured whole', () => {
  // Regression: an early version captured to the first whitespace, which broke
  // for anyone whose home directory has a space in it.
  const p = parsePersistedOutput('<persisted-output>\nOutput too large (60.8KB). Full output saved to: /Users/me/My Projects/x.json\n\nPreview:\n</persisted-output>')
  assert.equal(p.path, '/Users/me/My Projects/x.json')
})
