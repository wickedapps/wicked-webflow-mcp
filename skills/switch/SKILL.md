---
name: switch
description: Choose which Webflow connections are active in this project. Use when the user wants to load a client here, unload one, work on a different client, or reduce how many Webflow tools are loaded.
---

# Switch active Webflow connections

Make "$ARGUMENTS" the active connection(s) for this project, deactivating the rest.

1. If you are unsure which connections exist, run `wwm status --json` first and match "$ARGUMENTS" against the labels and server names it returns.
2. Run `wwm switch <slug>... --json`. Variants:
   - `--all` — everything active here.
   - `--none` — no Webflow connections here.
   - `--write` — also write `.wicked-webflow`, so the set travels with the repo and a teammate's session picks it up. Offer this when the project is a git repo and the user is setting up a client project rather than experimenting.
3. **Tell the user the current session is unchanged.** MCP connections are resolved and started before anything we can write, so the set applies from their *next* session. Do not imply the tools disappeared just now — they can see the old ones in the same session and will think the command failed.
4. If the JSON reports `fileConflict: true`, say so: `.wicked-webflow` lists a different set and wins at session start, so this switch is undone next session unless they re-run with `--write`.

## Deactivating everything has a catch — say it out loud

When no `wf-*` connection is active, Claude Code unhides its own `claude.ai Webflow` connector against the same URL. That connector is a *different* grant, scoped by nothing wwm did. So "no Webflow here" is not actually true until it is suppressed.

The only lever that suppresses it is `disableClaudeAiConnectors` in the project's `.claude/settings.json`, and it is all-or-nothing: it disables **every** claude.ai connector in that project — Figma, Linear, Notion, all of them.

`wwm switch --none` asks before writing it when run in a terminal. From inside a Claude Code session there is no TTY, so:

- Do **not** pass `--yes` to answer that question on the user's behalf. It is a consent question about software we were never asked to touch.
- Instead, run `wwm switch --none --json` and relay `connector: "hole open"` if that is what comes back, then ask the user directly. If they agree, re-run with `--suppress-connectors`.

The `connector` field in the JSON tells you what happened: `suppressed`, `restored`, `hole open`, `already suppressed`, or `left alone (not ours)`.

## What you must not do

**Never use `wwm remove` or `claude mcp remove` to deactivate a connection.** Removing a server invalidates its stored OAuth grant globally, at every scope. Remove is for ending an engagement; `switch` is the toggle.

**Never hand-edit `disabledMcpServers` in `~/.claude.json`.** That is the mechanism `switch` uses, but it is keyed to the *resolved* working directory and has to merge with whatever else is already disabled there. Writing the unresolved path silently no-ops — the write succeeds, status reads back what you just wrote, and the next session loads everything anyway.
