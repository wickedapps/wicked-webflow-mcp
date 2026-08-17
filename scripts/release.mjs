#!/usr/bin/env node
// One version, five files.
//
// npm, the plugin manifest, the marketplace entry, the CLI's hardcoded
// VERSION (npm ships only bin/wwm, so it cannot read package.json) and now the
// Tauri crate all carry the same number and have no way to notice when they
// stop agreeing. `check` is wired into CI and prepublishOnly so skew fails
// there rather than shipping a plugin that reports a version it isn't.
//
//   node scripts/release.mjs check          verify all five agree
//   node scripts/release.mjs stamp 0.6.0    write 0.6.0 everywhere
//   node scripts/release.mjs stamp          write package.json's version everywhere
//
// Edits are surgical regex replacements, not JSON.parse/stringify round-trips,
// so hand-formatting (compact keyword arrays, comments in Cargo.toml) survives.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/

/**
 * Every JSON `"version": "1.2.3"` pair. Dependency specs are safe: they are
 * `"react": "^19.0.0"`, where the key is not `version`.
 */
const JSON_VERSION = /("version"\s*:\s*")(\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?)(")/g

/** The `version = "..."` inside Cargo's `[package]` table only — never a dependency's. */
function cargoPackageVersion(src, replacement) {
  const start = src.search(/^\[package\]$/m)
  if (start === -1) throw new Error('no [package] table')
  const rest = src.slice(start + '[package]'.length)
  const end = rest.search(/^\[/m)
  const block = end === -1 ? rest : rest.slice(0, end)
  const found = []
  const next = block.replace(/^(version\s*=\s*")([^"]+)(")/m, (_, a, v, c) => {
    found.push(v)
    return replacement === null ? `${a}${v}${c}` : `${a}${replacement}${c}`
  })
  if (found.length === 0) throw new Error('no version in [package]')
  return { versions: found, src: src.slice(0, start + '[package]'.length) + next + (end === -1 ? '' : rest.slice(end)) }
}

const TARGETS = [
  { file: 'package.json', kind: 'json' },
  { file: 'bin/wwm', kind: 'js' },
  { file: '.claude-plugin/plugin.json', kind: 'json' },
  { file: '.claude-plugin/marketplace.json', kind: 'json' },
  // Optional so the CLI half of the repo still releases if app/ is ever split
  // out. Skips are printed, never silent — a typo'd path must not read as OK.
  { file: 'app/src-tauri/Cargo.toml', kind: 'cargo', optional: true },
  { file: 'app/src-tauri/tauri.conf.json', kind: 'json', optional: true },
]

/** @returns {{versions: string[], src: string}} */
function apply(kind, src, replacement) {
  if (kind === 'json') {
    const versions = []
    const out = src.replace(JSON_VERSION, (_, a, v, c) => {
      versions.push(v)
      return replacement === null ? `${a}${v}${c}` : `${a}${replacement}${c}`
    })
    return { versions, src: out }
  }
  if (kind === 'js') {
    const versions = []
    const out = src.replace(/^(export const VERSION = ')([^']+)(')/m, (_, a, v, c) => {
      versions.push(v)
      return replacement === null ? `${a}${v}${c}` : `${a}${replacement}${c}`
    })
    return { versions, src: out }
  }
  if (kind === 'cargo') return cargoPackageVersion(src, replacement)
  throw new Error(`unknown kind ${kind}`)
}

function load() {
  const found = []
  const skipped = []
  for (const t of TARGETS) {
    const path = join(ROOT, t.file)
    if (!existsSync(path)) {
      if (t.optional) { skipped.push(t.file); continue }
      throw new Error(`missing required file: ${t.file}`)
    }
    const src = readFileSync(path, 'utf8')
    let result
    try {
      result = apply(t.kind, src, null)
    } catch (e) {
      throw new Error(`${t.file}: ${e.message}`)
    }
    if (result.versions.length === 0) throw new Error(`${t.file}: no version found`)
    for (const v of result.versions) found.push({ file: t.file, version: v, target: t, path })
  }
  return { found, skipped }
}

function check() {
  const { found, skipped } = load()
  const distinct = [...new Set(found.map((f) => f.version))]
  const width = Math.max(...found.map((f) => f.file.length))
  for (const f of found) console.log(`  ${f.file.padEnd(width)}  ${f.version}`)
  for (const s of skipped) console.log(`  ${s.padEnd(width)}  (absent — skipped)`)

  if (distinct.length === 1) {
    console.log(`\nok — ${distinct[0]} across ${found.length} declaration${found.length === 1 ? '' : 's'}.`)
    return 0
  }
  console.error(`\nversion skew: ${distinct.join(', ')}`)
  console.error(`Run \`node scripts/release.mjs stamp <version>\` to reconcile.`)
  return 1
}

function stamp(requested) {
  const { found, skipped } = load()
  const version = requested ?? found.find((f) => f.file === 'package.json')?.version
  if (!version) throw new Error('no version given and none found in package.json')
  if (!SEMVER.test(version)) throw new Error(`not a semver: ${version}`)

  const written = []
  for (const t of TARGETS) {
    const path = join(ROOT, t.file)
    if (!existsSync(path)) continue
    const src = readFileSync(path, 'utf8')
    const { versions, src: out } = apply(t.kind, src, version)
    if (out !== src) written.push(`${t.file} ${versions.join('/')} -> ${version}`)
    else written.push(`${t.file} already ${version}`)
    writeFileSync(path, out)
  }
  for (const w of written) console.log(`  ${w}`)
  for (const s of skipped) console.log(`  ${s} (absent — skipped)`)
  console.log(`\nstamped ${version}. Commit, tag, then \`npm publish\`.`)
  return 0
}

const [mode = 'check', arg] = process.argv.slice(2)
try {
  if (mode === 'check') process.exit(check())
  else if (mode === 'stamp') process.exit(stamp(arg))
  else {
    console.error(`usage: release.mjs check | stamp [version]`)
    process.exit(2)
  }
} catch (e) {
  console.error(`release.mjs: ${e.message}`)
  process.exit(1)
}
