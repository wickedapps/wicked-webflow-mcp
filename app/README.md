# Wicked Webflow MCP Manager

A GUI over the `wwm` CLI. It does not reimplement any of it.

## Why it exists

`claude mcp login` checks for a controlling terminal before it starts the browser flow. An agent shell and the Bash tool have neither, so `wwm connect --json` can only hand back a command string for the user to paste into their own terminal ([`bin/wwm:1726`](../bin/wwm)). Pipes do not satisfy the check — a pty does, and a desktop process is the only one of the three surfaces that can open one.

That is the app's job. Everything else here — the status table, the active toggles, verify — is a convenience over `wwm <cmd> --json` and duplicates what the interactive `wwm` dashboard already does in a terminal.

## Architecture

```
React  ──invoke──▶  Rust  ──spawn──▶  wwm --json  ──spawn──▶  claude
                     │
                     └──pty──▶  claude mcp login <server>
```

- `src-tauri/src/wwm.rs` — runs `wwm <args> --json` in a given directory, parses stdout, keeps stderr for when it isn't JSON. Non-zero exits still carry structured output.
- `src-tauri/src/pty.rs` — the login pty, via `portable-pty`. Streams to the frontend as `login:output` / `login:exit` events.
- `src/wwm.ts` — typed client, and the app's half of the `--json` contract.
- `src/project.ts` — which folder is being managed, and the recents list.

No state is duplicated. `state.json` and `.claude.json` have exactly one writer (the CLI), because `.claude.json`'s schema belongs to Claude Code and tracking it in two languages would mean fixing every Claude Code release twice.

### The project directory

`status`'s activation block and everything `switch` writes are keyed on a working directory — `~/.claude.json`'s `projects[<resolved cwd>].disabledMcpServers`. In a terminal that is wherever you have `cd`'d. A GUI has no equivalent, and one launched from Finder starts at `/`, so the directory is an explicit choice: a picker in the header, persisted in `localStorage` with a recents list.

Commands run *in* that directory rather than being passed a flag. `--project` exists only on `switch` and `activate`, so a flag would be silently ignored by `status` and the table would describe a different directory than the toggles wrote to.

Two consequences worth knowing:

- **Until a folder is chosen, the "Active here" toggles are inert.** Health, sites and verify are global facts and still work. Defaulting to `$HOME` instead would mean a first click quietly writing a disable list for the home directory.
- **The picked path is not always the stored one.** The CLI resolves symlinks, so `/tmp/x` is keyed as `/private/tmp/x`. The app adopts whatever `status` reports as `cwd`, so what is displayed is what gets written.

### The PATH problem

A GUI launched from Finder inherits a minimal `PATH` — it cannot see a node installed through nvm, or Homebrew on Apple silicon. Both `wwm` and the `claude` it shells out to would be missing. `wwm.rs` asks the login shell for the real `PATH` once (`$SHELL -ilc`) and hands it to every child. Delete that and the app works in `npm run dev` and fails for every user who double-clicks the icon.

## Prerequisites

- Rust — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- On macOS, Xcode command line tools. On Linux, the [Tauri system dependencies](https://tauri.app/start/prerequisites/).
- `wwm` on `PATH` (`npm install -g wicked-webflow-mcp`), or `WWM_BIN` pointed at `bin/wwm` in this checkout — which is what you want while developing:

  ```
  WWM_BIN="$(git rev-parse --show-toplevel)/bin/wwm" npm run dev
  ```

## Commands

```
npm install
npm run dev      # vite + tauri, hot reload
npm run build    # bundle for this platform
npm run check    # tsc --noEmit
npm run icons    # regenerate the icon set from src-tauri/icons/icon.png
```

The checked-in `icon.png` is a placeholder. Replace it and run `npm run icons`, then extend `bundle.icon` in `tauri.conf.json` with the generated `.icns`/`.ico` before shipping a real release.

## The `--json` contract

The app and the CLI install separately and upgrade separately, so the CLI's output is a versioned interface rather than whatever `emitJson` happened to pass.

- `bin/wwm` exports `SCHEMA_VERSION` and stamps it as the first key of every payload.
- `test/schema.test.js` pins the **exact** key set of every command's output, end to end against a stub `claude`. A field cannot appear or disappear without that suite failing first.
- `src/wwm.ts` declares `EXPECTED_SCHEMA_VERSION` and refuses any payload that does not match, with a message naming which side to upgrade.

Bump `SCHEMA_VERSION` only on a breaking change — a field removed, renamed, retyped, or given a new meaning. Adding a field is not breaking; consumers ignore keys they do not know. Either way, update the pin in `test/schema.test.js` and the interfaces in `src/wwm.ts` in the same commit.
