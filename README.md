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
wf-hatchline    → https://mcp.webflow.com/mcp   (authorized for Hatchline's site)
wf-copperfox    → https://mcp.webflow.com/mcp   (authorized for Copper & Fox's site)
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
/wwm:connect Hatchline Studio    # register and walk you through authorizing
/wwm:verify hatchline            # what can it actually reach?
/wwm:status                      # everything, at a glance
/wwm:remove hatchline            # end of engagement
```

**Authorizing has one step Claude Code cannot do for you.** `claude mcp login` opens a browser and needs a real terminal; the agent's shell does not have one. So `/wwm:connect` registers the connection, briefs you on the consent screen, and hands you a `claude mcp login wf-<slug>` line to paste into your own terminal. That is the design, not a limitation being worked around — the one irreducibly human step stays with the human.

A new connection is usable immediately — no restart needed. (Measured on Claude Code 2.1.223: a server added and authorized mid-session was callable from an already-running session.)

### Using `wwm` directly from your shell

The plugin puts `wwm` on `PATH` **inside Claude Code sessions only**. If you would rather drive it from your own terminal — which is the nicer path for setting up several clients at once, since it does the whole connect-authorize-verify flow in one command:

```bash
npm install -g wicked-webflow-mcp

wwm connect hatchline --label "Hatchline Studio"
wwm verify hatchline
wwm status
wwm remove hatchline --yes
```

Run `wwm connect` with no name and it asks for one, then shows the server name it will create (`acme client` → `wf-acme-client`) before creating it. It only asks when there is a real terminal to ask in — under `--json`, `--quiet`, `--yes`, or with no TTY, a missing name is still a usage error rather than a hang.

Zero dependencies; that install puts the one file on your `PATH`. Requires Node **22+**.

---

## What "isolated" does and does not mean

This is the part worth reading slowly, because the pitch and the mechanism are not the same thing.

**Webflow guarantees one thing: a single grant cannot span two workspaces.** That is enforced by Webflow's authorization server. Nothing you or this plugin can do will produce a cross-workspace grant. If each client sits in its own workspace, that happens to be exactly the boundary you want — and it holds whether or not anyone is paying attention.

**Per-site scoping is enforced by your click, and nothing else.** Webflow's consent screen lists every site in every workspace you can reach, and it is multi-select. Tick eight sites and you get one connection reaching eight clients — no warning, no error, and a result indistinguishable from a correct one. The workspace name sits above its sites as its own checkbox, so "this client's site" and "every site in this workspace" are one row apart.

That asymmetry is why `wwm verify` exists and why it runs by default. It asks the connection what it can actually see and reports the answer. It is not corroboration of a guarantee — for per-site scoping, **it is the only enforcement there is.** `--no-verify` requires `--yes` for that reason.

**Verify checks how many sites, not which one.** It can prove a grant reaches exactly one site. It cannot know which site you *meant* — a connection labeled `hatchline` authorized against a scratch site passes cleanly. That is why `wwm status` prints site names rather than a count: reading the name is currently the only thing that catches a correctly-isolated grant on the wrong target.

**Isolation limits which site, never what can be done to it.** Within an authorized site the grant covers Designer-API element creation, CMS writes, style and custom-code changes, and asset management. "Isolated per client" does not mean read-only, restricted, or safe. It means a mistake is confined to one client's site instead of all of them.

**This plugin never sees your credentials.** Every connection change is made by shelling out to the `claude` CLI. Tokens live in Claude Code's keychain storage; `wwm` reads connection names and health, and nothing else.

**`remove` destroys the grant.** On Claude Code 2.1.223, removing a server invalidates its stored authorization everywhere, at any scope. There is no way to remove a connection and keep its token, which is why deactivating for one project is a separate operation and not `remove`.

---

## License

[ISC](LICENSE)
