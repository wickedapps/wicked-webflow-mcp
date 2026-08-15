---
name: status
description: Show every Webflow connection with its health, verified scope, and whether it is active in this project. Use when the user asks which clients are connected, what is loaded here, or wants an overview of Webflow access.
---

# Webflow connection status

Show every connection, its health, its verified scope, and whether it is active in this project.

## Steps

1. Run `wwm status --json`.
2. Read `servers[]`. Each row has `server`, `label`, `health`, `sites`, `workspaceIds`, `singleSite`, `verifiedAt`, and `active`.
3. The `cwd` field is the **resolved** working directory. Activation is keyed to the real path, so a project reached through a symlink is a different project as far as Claude Code is concerned. If the user is surprised by what is active, check this first.

## Reading the fields

**`health`** comes from `claude mcp list` and describes the *connection*: `connected`, `needs_auth`, `failed`, `pending_approval`.

**`active`** is unrelated to health and cannot be read from `claude mcp list` — a deactivated server still prints `✔ Connected`. It comes from the project's `disabledMcpServers`. A connection can be healthy and inactive; that is the normal state for every client you are not currently working on.

**`sites: null`** means never verified — not verified-and-fine. Say "unverified", never "fine", and offer to run `wwm verify` yourself. Do not tell the user to run it; `wwm` is on your `PATH` in this session and very likely not on theirs.

**`sites`** is the list the connection reaches. A connection covering several sites is a normal grant — Webflow's consent screen is multi-select and users authorize groups deliberately. Report the names; do not flag the count.

**`verifiedAt`** is when the scope was last checked. Report the age. A result from six weeks ago describes six weeks ago.

## What to flag

Lead with anything actionable rather than listing rows neutrally:

- Any connection whose `health` is not `connected` — `needs_auth` means the grant is gone and the client is unreachable until they re-authorize.
- Any connection that has never been verified. Offer to check it.
- More than a handful active at once. Every active connection's tools consume context in every session in this project, which is the cost this plugin exists to avoid.

If nothing is connected, say so and offer `/wwm:connect`.
