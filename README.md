# Wicked Webflow MCP

**Keep every client's Webflow MCP connection authorized at once, and load only the ones each project needs.**

A Claude Code plugin for agencies and freelancers running Webflow work across several clients.

---

## The problem

Webflow's MCP server is one endpoint, `https://mcp.webflow.com/mcp`, and Claude Code's built-in connector registers it once. Authorize it for client A, then authorize it for client B, and you have replaced the first grant. Every switch between clients is a browser round-trip.

The workaround people land on — approve every site in one grant — means every session can reach every client you have.

## How it works

Claude Code keys MCP servers by **name**, not URL. Register the same Webflow endpoint under twenty different names and you get twenty independent OAuth grants, each with its own token, each live simultaneously:

```
wf-dino         → https://mcp.webflow.com/mcp   (authorized for Dino Studios' site)
wf-stonesboots  → https://mcp.webflow.com/mcp   (authorized for Stones & Boots' site)
wf-northgate    → https://mcp.webflow.com/mcp   (authorized for Northgate's site)
```

All three stay connected. None of them needs re-authorizing to use another.

That is the whole mechanic. This plugin does the naming, the collision checking, and the scope verification.

## Install

```bash
claude plugin marketplace add wickedapps/wicked-webflow-mcp
claude plugin install wwm@wicked-webflow-mcp
```

Requires Claude Code **2.1.186+** and Node **22+**. Run `wwm doctor` to check.

## Use

From inside Claude Code:

```
/wwm:connect Dino Studios     # register and walk you through authorizing
/wwm:verify dino              # what can it actually reach?
/wwm:status                   # everything, at a glance
/wwm:switch dino              # load only this client in this project
/wwm:remove dino              # end of engagement
```

**Authorizing has one step Claude Code cannot do for you.** `claude mcp login` opens a browser and needs a real terminal; the agent's shell does not have one. So `/wwm:connect` registers the connection, briefs you on the consent screen, and hands you a `claude mcp login wf-<slug>` line to paste into your own terminal. That is the design, not a limitation being worked around — the one irreducibly human step stays with the human.

A new connection is usable immediately — no restart needed. (Measured on Claude Code 2.1.223: a server added and authorized mid-session was callable from an already-running session.)

### Using `wwm` directly from your shell

The plugin puts `wwm` on `PATH` **inside Claude Code sessions only**. If you would rather drive it from your own terminal — which is the nicer path for setting up several clients at once, since it does the whole connect-authorize-verify flow in one command:

```bash
npm install -g wicked-webflow-mcp
```

Run `wwm` with no arguments and you get a dashboard and a menu:

```
  wwm 0.5.1                                  ~/work/dino-site

  ●  wf-dino        Dino Studios       1 site · Dino                   2d ago
  ○  wf-stonesboots Stones & Boots     3 sites · S&B, S&B EU, +1       5d ago
  ○  wf-northgate   Northgate          never checked

  1 of 3 active here · from .wicked-webflow

  ⚠ Never checked: wf-northgate.

  ❯ Check what it reaches
    Switch which clients load here
    Connect a new client
    Verify what a connection can reach
    Remove a connection
    Doctor

  ↑↓ move · enter select · r refresh · esc quit
```

`●` is active in this project, `○` is authorized but not loaded here. When something needs attention — a `.wicked-webflow` that will undo your last switch, an unverified connection, the connector hole below — the dashboard leads with it and the fix becomes the first row.

Every command still works with arguments, and every interactive action prints the command that would have done it (`→ wwm switch dino --write`), so the menu is training wheels rather than a dependency:

```bash
wwm connect dino --label "Dino Studios"
wwm verify dino
wwm status
wwm switch dino --write
wwm remove dino --yes
```

Three of them open a picker when you leave the arguments off:

- **`wwm switch`** — a checkbox list, pre-ticked to what is active now, so confirming without changes is a no-op and it is safe to open just to look. It prints the per-connection tool cost underneath, because that is what you are actually choosing between.
- **`wwm verify`** — pre-ticked to the connections that are stale or have never been checked, with a running `about $0.08 · about 20s` that moves as you toggle. Anything verified in the last week starts unticked, so the default is the cheap correct one.
- **`wwm remove`** — shows what each connection currently reaches in the list, offers `switch` first, and asks you to type the name. It destroys the grant, so it is deliberately harder than everything else.

**Interactive only means interactive.** Piped, scripted, `--json`, `--quiet`, `--yes`, or with no TTY, every command behaves exactly as it did before — bare `wwm` prints usage and exits 2, and bare `wwm verify` still means `--all`. Nothing automated can start hanging on a prompt. If your terminal renders the redrawing pickers badly, `WWM_NO_RAW=1` switches them to numbered lists with the same choices.

Zero dependencies; that install puts the one file on your `PATH`. Requires Node **22+**.

---

## Per-project activation

Twenty authorized connections means twenty full tool schemas competing for the context window, and Webflow's server exposes around thirty tools. Tool search makes that survivable; it does not make it good. The value of connection 21 is negative if it degrades every session.

So keep every client authorized, and load only the ones a project needs:

```bash
wwm switch dino           # only Dino Studios loads in this directory
wwm switch dino --write   # …and commit that choice as .wicked-webflow
wwm switch --all          # everything, here
wwm switch --none         # no Webflow connections here
```

Connections stay authorized either way. `switch` never removes anything — it writes the per-project disable list Claude Code already reads, the same one the `/mcp` menu toggles, merged so your own disabled servers keep their settings.

Three things to know, all of which are consequences of how Claude Code starts:

**It applies from your next session.** MCP connections are resolved and started before any hook or command can write anything, so the session you run `switch` in keeps whatever it already loaded. Start a new session to see the change.

**`.wicked-webflow` is what makes it a team thing.** Commit it and a teammate who clones the repo gets the same set from their second session onward, having installed nothing and configured nothing — the plugin's `SessionStart` hook applies it for them. Their *first* session is unfiltered, because the per-project disable list lives in `~/.claude.json` and a clone cannot carry it.

**`--none` means no *wwm* connection, not no Webflow.** With no `wf-*` connection loaded, Claude Code's own `claude.ai Webflow` connector can load in that project instead — a separate connection with its own authorization, not one this plugin scoped. That is worth knowing, and it is not a fault: using the built-in connector in a project is a perfectly reasonable thing to want, and `wwm` states the situation rather than warning about it.

If you would rather it did not load there, `wwm switch --none` offers the choice before writing anything. Turning it off means `disableClaudeAiConnectors` in the project's `.claude/settings.json`, which is all-or-nothing — it disables *every* claude.ai connector in that project, Figma and Linear and Notion included. `wwm status` tells you which state you are in. It is never written silently, and never by the hook.

---

## What a connection can reach

This is the part worth reading slowly, because the pitch and the mechanism are not the same thing.

**A grant covers exactly the sites you tick.** Webflow's consent screen lists every site in every workspace you can reach, and it is multi-select. Tick one site and the connection sees one site; tick a client's five and it sees those five. Both are correct — plenty of clients have more than one site, and a grant covering a group is a normal thing to authorize, not a mistake. `wwm` reports what a connection reaches and leaves the judgment to you.

**Webflow guarantees one thing: a single grant cannot span two workspaces.** That is enforced by Webflow's authorization server. Nothing you or this plugin can do will produce a cross-workspace grant. If each client sits in its own workspace, that happens to be exactly the boundary you want — and it holds whether or not anyone is paying attention.

**The click worth being careful about is the workspace row.** Each workspace name sits above its sites as its own checkbox, and one click there grants every site in it — including other clients'. It is one row from the site rows, there is no confirmation, and the result looks identical afterwards. That is the mis-tick `wwm verify` is good at catching: the site list comes back longer than the client you had in mind.

**`wwm verify` shows you what a connection actually reaches**, by asking the live connection rather than trusting anyone's assumptions — including ours. It runs by default after `connect`, and `--no-verify` requires `--yes`, because a connection nothing has ever checked is an unknown rather than a clean one.

**It reports which sites, and cannot know which you meant.** A connection labeled `dino` authorized against a scratch site verifies cleanly. That is why `wwm status` prints site names rather than a count — reading the names is the only thing that catches a grant pointed at the wrong target.

**Scoping limits which sites, never what can be done to them.** Within an authorized site the grant covers Designer-API element creation, CMS writes, style and custom-code changes, and asset management. "Scoped to this client" does not mean read-only, restricted, or safe. It means a mistake is confined to that client's sites instead of every client you have.

**This plugin never sees your credentials.** Every connection change is made by shelling out to the `claude` CLI. Tokens live in Claude Code's keychain storage; `wwm` reads connection names and health, and nothing else.

**`remove` destroys the grant.** On Claude Code 2.1.223, removing a server invalidates its stored authorization everywhere, at any scope. There is no way to remove a connection and keep its token, which is why deactivating for one project is `wwm switch` and never `remove`.

---

## License

[ISC](LICENSE)
