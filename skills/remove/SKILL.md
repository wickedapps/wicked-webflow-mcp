---
name: remove
description: Permanently remove a Webflow connection and destroy its authorization. Use when a client engagement ends or the user wants to delete a connection. Not for temporarily unloading a client.
---

# Remove a Webflow connection

Permanently remove "$ARGUMENTS" and destroy its Webflow authorization.

## Check the intent first

**This is not a deactivate.** Removing a server invalidates its stored OAuth grant globally — there is no way to remove it and keep the token. Restoring it means the user walks through Webflow's browser consent flow again.

If the user said anything like "unload", "turn off for now", "switch to another client", or "I'll come back to this one" — they want `/wwm:switch`, not this. Ask before proceeding. The cost of a wrong guess is asymmetric: a needless switch costs nothing, a needless remove costs a browser round-trip and the connection's verification history.

Proceed when the engagement is genuinely over, or the connection was created by mistake.

## Steps

1. Confirm explicitly, naming the client and stating that re-adding requires re-authorization.
2. Run `wwm remove <slug> --yes --json`.
3. Read `steps[]` — `logout` then `remove`, each with an `ok` flag. Report both. A failed `logout` with a successful `remove` leaves a stale credential; say so rather than reporting overall success.

## After removal

Tell the user that `mcp logout` clears the credential **locally**. The authorization may still be listed in Webflow's own app settings under the authorized apps for that workspace. To fully revoke it on Webflow's side, they need to remove it there too.

This matters more than it sounds. A client engagement ending is exactly when someone will later ask whether access was actually revoked, and "we deleted our local copy of the token" is a different answer from "the grant is gone."
