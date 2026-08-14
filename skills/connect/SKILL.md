---
name: connect
description: Connect a new Webflow client site as its own named MCP server. Use when the user wants to add a client, connect a site, authorize Webflow for a project, or set up a new Webflow client.
---

# Connect a Webflow client

Connect the client named "$ARGUMENTS" as an isolated Webflow MCP connection.

## Before you start

`claude mcp login` needs a real terminal. The Bash tool does not have one, so **`wwm connect` cannot complete authorization from inside this session.** Run:

```
wwm connect <slug> --print-command --json
```

This registers the connection and returns `loginCommand`. Give that command to the user to run in their own terminal. Do not try to run it yourself — it will fail with `stdin isn't a terminal` and you will have burned a rollback.

If the user is already working in a terminal and would rather do the whole thing there, tell them to run `wwm connect <slug>` directly. That path is better: it opens the browser and verifies scope in one flow.

## Steps

1. Derive a slug from "$ARGUMENTS": lowercase, spaces and punctuation to hyphens. `Hatchline Studio` → `hatchline-studio`.
2. Run `wwm connect <slug> --label "$ARGUMENTS" --print-command --json`.
3. **Brief the user on the consent screens before they open the browser.** This click is the only thing enforcing per-client isolation and you cannot do it for them. There are two screens:

   **Screen 1 — `mcp.webflow.com`.** It names the connection: *"Claude Code (wf-<slug>)"*. Tell them to check that name matches the client they meant. They must tick **"I recognize and trust this URL"** for the `localhost` callback before **Continue** becomes clickable. If they miss it, nothing happens and there is no error — they will think it hung.

   **Screen 2 — `webflow.com`.** The site picker.
   - It lists **every site in every workspace** they can reach, not just this client's, and it is **multi-select**.
   - There is a **search box**. On an account with many sites, searching by name is the only sane way to find the right one.
   - **Tick only "$ARGUMENTS"'s site.** Nothing is pre-selected by default, but tell them to untick anything already ticked anyway — checking is free and the default could change.
   - **Do not tick the workspace row.** Each workspace name sits above its sites as its own checkbox. One click there grants every site in that workspace. It is one row from the correct answer, there is no confirmation, and the result looks identical afterwards.
   - Webflow refuses a selection spanning two workspaces. If this client's sites live in two workspaces, they need a second connection — offer it.

4. Tell them to run `wwm verify <slug>` after authorizing, and to report the result back to you. Verification costs about $0.04 and ten seconds, charged to their own Claude account.
5. Read the verify JSON. **If `isolated` is false, lead with that** — name every site that came back and offer to re-authorize. Do not bury it under a success message. An over-scoped grant looks exactly like a correct one until someone reads this line.
6. Remind them that new connections load after Claude Code restarts.

## If they ask what the connection can actually do

Within the ticked site: nearly everything. Create and modify elements via the Designer API, write CMS items, change styles and custom code, manage assets.

Per-site scoping limits **which** site, never **what** may be done to it. Never let "isolated" be heard as "read-only" or "limited".

## Failure handling

If `wwm` reports a preflight failure, relay its message verbatim. **Do not attempt to run `claude mcp` commands directly as a workaround.** The engine owns naming, collision detection, rollback, and state; hand-rolling around it produces connections it cannot manage and cannot clean up.

Exit codes: `3` preflight, `4` name collision, `5` over-scoped, `6` could not verify, `7` output parse failure. `6` is not `5` — "we could not check" is not "we checked and it was fine."
