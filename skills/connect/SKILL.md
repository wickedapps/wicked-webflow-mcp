---
name: connect
description: Connect a new Webflow client site as its own named MCP server. Use when the user wants to add a client, connect a site, authorize Webflow for a project, or set up a new Webflow client.
---

# Connect a Webflow client

Connect the client named "$ARGUMENTS" as its own named Webflow MCP connection.

**If "$ARGUMENTS" is empty, the user invoked this with no client name.** Ask for it and stop — do not guess one from the directory name or from existing connections. Everything below depends on knowing which client this is, including the consent-screen briefing, which names the site they should tick.

**If the connection already exists**, `wwm connect` exits `4` rather than touching it. Someone reconnecting a client they already have almost always wants a different grant under the same name, which is `/wwm:reauth`. Check that before offering to remove anything.

## What you can and cannot do from here

**You can run every `wwm` command except `connect`'s browser step.** `wwm` is on your `PATH` in this session. `wwm verify` and `wwm status` are headless and work fine — run them yourself.

**You cannot run `claude mcp login`.** It needs a real terminal and the Bash tool has none; it fails with `stdin isn't a terminal` and burns a rollback. So authorization is the one step you hand to the user.

**Do not tell the user to run `wwm` in their terminal.** A plugin install puts `wwm` on `PATH` inside Claude Code sessions only, so `wwm verify …` in their shell gives them `command not found`. The only command you hand over is `claude mcp login`, which is on their normal `PATH`. If they want `wwm` in their own shell, tell them to `npm install -g wicked-webflow-mcp` — mention that only if they ask.

## Steps

1. Derive a slug from "$ARGUMENTS": lowercase, spaces and punctuation to hyphens. `Dino Studios` → `dino-studios`.
2. Run `wwm connect <slug> --label "$ARGUMENTS" --print-command --json`.
3. **Brief the user on the consent screens before they open the browser.** These clicks decide what the connection can reach and you cannot make them for the user. There are two screens:

   **Screen 1 — `mcp.webflow.com`.** It names the connection: *"Claude Code (wf-<slug>)"*. Tell them to check that name matches the client they meant. They must tick **"I recognize and trust this URL"** for the `localhost` callback before **Continue** becomes clickable. If they miss it, nothing happens and there is no error — they will think it hung.

   **Screen 2 — `webflow.com`.** The site picker.
   - It lists **every site in every workspace** they can reach, not just this client's, and it is **multi-select**.
   - There is a **search box**. On an account with many sites, searching by name is the only sane way to find the right one.
   - **Tick "$ARGUMENTS"'s site — or sites.** If this client has several sites, ticking all of them is correct and expected; one grant can cover a group. Nothing is pre-selected by default.
   - **Do not tick the workspace row** unless they actually mean the whole workspace. Each workspace name sits above its sites as its own checkbox, and one click there grants every site in it, including other clients'. It is one row from the site rows, there is no confirmation, and the result looks identical afterwards.
   - Webflow refuses a selection spanning two workspaces. If this client's sites live in two workspaces, they need a second connection — offer it.

   Tell them here that you will check the scope automatically once they are done, and that it costs about $0.04 and ten seconds against their own Claude account. Say it now rather than asking permission later — it is part of connecting, and a mid-flow prompt just adds a round trip.

4. Wait for them to say they have authorized. Then **run `wwm verify <slug> --json` yourself.** Never ask the user to run a `wwm` command — see above.
5. Read the verify JSON and **report the site names**: "authorized for 3 sites: A, B, C."

   **Do not treat several sites as a problem.** The picker is multi-select on purpose and clients routinely have more than one site. There is no over-scoped verdict and no exit code for it.

   The question worth asking is whether those are the sites they meant — `verify` can see what the grant reaches, never which sites the client actually owns. Ask once, lightly. If a returned name looks unrelated to the client (a scratch site, a template, someone else's project), point at that specific name. If the list matches what they said they ticked, just confirm it and move on.

6. The connection is usable immediately. Do not tell them to restart Claude Code; measured on 2.1.223, tools from a mid-session connection are callable without one.

## If they ask what the connection can actually do

Within the ticked site: nearly everything. Create and modify elements via the Designer API, write CMS items, change styles and custom code, manage assets.

Per-site scoping limits **which** sites, never **what** may be done to them. Never let "scoped to this client" be heard as "read-only" or "limited".

## Failure handling

If `wwm` reports a preflight failure, relay its message verbatim. **Do not attempt to run `claude mcp` commands directly as a workaround.** The engine owns naming, collision detection, rollback, and state; hand-rolling around it produces connections it cannot manage and cannot clean up.

Exit codes: `3` preflight, `4` name collision, `6` could not verify, `7` output parse failure. Exit `6` means nothing was checked — never report it as a clean result.
