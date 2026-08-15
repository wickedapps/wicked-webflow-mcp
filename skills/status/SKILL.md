---
name: status
description: Show every Webflow connection with its health, verified scope, and whether it is active in this project, and say what to do next. Use when the user asks which clients are connected, what is loaded here, where they are, or wants an overview of Webflow access.
---

# Webflow connection status

The front door. Show every connection, its health, its verified scope, whether it is active in this project — and end by naming the next action rather than listing what the plugin can do.

## Steps

1. Run `wwm status --json`. **Once.** It returns health, verified site names, per-project activation and `.wicked-webflow` state together. Do not follow it with `wwm verify`, `claude mcp list`, or a second `status`; everything below comes out of that one call.
2. Read `servers[]`. Each row has `server`, `label`, `health`, `sites`, `workspaceIds`, `singleSite`, `verifiedAt`, and `active`.
3. The `cwd` field is the **resolved** working directory. Activation is keyed to the real path, so a project reached through a symlink is a different project as far as Claude Code is concerned. If the user is surprised by what is active, check this first.

## Render it as a table

| | connection | client | reaches | checked |
| --- | --- | --- | --- | --- |
| ● | `wf-dino` | Dino Studios | Dino | 2d ago |
| ○ | `wf-stonesboots` | Stones & Boots | S&B, S&B EU, S&B Staging | 5d ago |
| ○ | `wf-northgate` | Northgate | — | never |

`●` = active in this project, `○` = authorized but not loaded here. That distinction is the whole point of the plugin; do not flatten it into one list. Say where the activation came from — `activation.source` is `.wicked-webflow`, `plugin state`, or `default (all)` — and if it is `.wicked-webflow`, mention teammates get the same set.

## Reading the fields

**`health`** comes from `claude mcp list` and describes the *connection*: `connected`, `needs_auth`, `failed`, `pending_approval`.

**`active`** is unrelated to health and cannot be read from `claude mcp list` — a deactivated server still prints `✔ Connected`. It comes from the project's `disabledMcpServers`. A connection can be healthy and inactive; that is the normal state for every client you are not currently working on.

**`sites: null`** means never verified — not verified-and-fine. Say "unverified", never "fine", and offer to run `wwm verify` yourself. Do not tell the user to run it; `wwm` is on your `PATH` in this session and very likely not on theirs.

**`sites`** is the list the connection reaches. A connection covering several sites is a normal grant — Webflow's consent screen is multi-select and users authorize groups deliberately. Report the names; do not flag the count.

**`verifiedAt`** is when the scope was last checked. Report the age. A result from six weeks ago describes six weeks ago.

## Then name what is worth doing

Lead with whichever of these the JSON actually shows, and stop at the first two. Do not append a menu of everything else.

1. **`health` is not `connected`** — `needs_auth` means the grant is gone and the client is unreachable until they re-authorize.
2. **`activation.fileConflict: true`** — `.wicked-webflow` lists a different set and wins at session start, so the current set will be undone next session. Offer `/wwm:switch … --write`.
3. **Nothing active and `activation.connectorsSuppressed: false`** — Claude Code can load its own `claude.ai Webflow` connector here instead, a grant this plugin did not scope. Explain it and ask; never write the key on their behalf.
4. **A connection with `sites: null`** — never checked. Say it costs about $0.04 to find out what it reaches, and ask before spending it.
5. **More than a handful active at once.** Every active connection's tools consume context in every session in this project, which is the cost this plugin exists to avoid.

If nothing is connected, say so and offer `/wwm:connect`.

## Cost rules

- **Never verify to build this view.** Everything here is already recorded — reading it must not spend anything.
- If the user asks to check everything, estimate first — count × $0.04 and count × 9s, billed to their own Claude account — and wait for a yes.
- Reuse recent results: `wwm verify --max-age 24h` re-checks only what has gone stale.

## Mention the terminal, once, when it fits

`wwm` with no arguments opens this same dashboard as an interactive menu in the user's own terminal, with arrow-key pickers for switching and verifying. It is the better path for setting up several clients at once, because `claude mcp login` needs a real terminal and the agent's shell does not have one. Say this when they are clearly mid-setup — not on every status check. It requires `npm install -g wicked-webflow-mcp`; the plugin puts `wwm` on `PATH` inside Claude Code sessions only.
