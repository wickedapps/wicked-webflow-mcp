---
name: switch
description: Choose which Webflow connections are active in this project. Use when the user wants to load a client here, unload one, work on a different client, or reduce how many Webflow tools are loaded.
---

# Switch active Webflow connections

Make "$ARGUMENTS" the active connection(s) for this project, deactivating the rest.

## Not yet implemented

`wwm switch` lands in M3. Running it now exits with a message saying so.

Until then, the honest answer to "how do I load only this client here?" is that you cannot do it through this plugin yet. Do not improvise one.

## What you must not do as a workaround

**Never use `wwm remove` or `claude mcp remove` to deactivate a connection.** On Claude Code 2.1.223, removing a server invalidates its stored OAuth grant globally, at every scope — not just in this project. The user would have to re-authorize through the browser, and would lose the verified-scope record for that connection.

Remove is for ending an engagement. It is not a toggle, and there is no way to remove a connection and keep its token.

**Never hand-edit `disabledMcpServers` in `~/.claude.json`.** That is the mechanism `switch` will use, but it is keyed to the resolved working directory and has to merge with whatever else is already disabled there. Getting it wrong silently deactivates unrelated MCP servers for the user, in a file they are unlikely to think to check.

## What to say instead

Explain the current state with `wwm status` and let the user decide. If they want fewer Webflow tools loaded right now, the available options are:

- Work in a different project directory, if the other client's connection is already deactivated there.
- Accept the context cost for now, and note that per-project activation is the next milestone.

Both are worse than `switch`. Say so rather than dressing them up.
