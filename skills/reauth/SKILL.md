---
name: reauth
description: Replace a Webflow connection's authorization in place, keeping its name. Use when a connection reaches the wrong sites, needs a different site or workspace, or has stopped being authorized. Not for adding a new client.
---

# Reauthorize a Webflow connection

Replace the grant behind "$ARGUMENTS" with a new one, keeping the same server name.

## Check the intent first

**This is not `remove`, and it is not `switch`.** The name, the label, the verification history and which projects load the connection all survive a reauthorization. What it replaces is the grant — which sites the connection can reach.

Three things bring someone here, and all three are this command:
- **The reach is wrong.** They ticked the workspace row, or the wrong site, or the client added a site the grant does not cover.
- **The reach needs to move.** A different workspace, most often. Webflow caps a grant at one workspace, so this is the only way.
- **The grant is gone.** `health` is `needs_auth` and the connection is unreachable.

If they want the connection gone for good, that is `/wwm:remove`. If they want it out of *this project* but kept, that is `/wwm:switch`.

## The new grant replaces the old one

Say this before anything happens, because it is the mistake people make. Webflow's consent screen is not an editor for the existing grant — it builds a fresh one. **Anything left unticked is dropped, including sites the connection reaches today.** Someone adding a fourth site has to re-tick the three they already had.

There is also no undo. The old credential is destroyed by the first step, so between that and a finished browser round-trip the connection reaches nothing.

## What you can and cannot do from here

**You cannot run `claude mcp login` or `claude mcp logout` for the user.** Login needs a real terminal and the Bash tool has none. So `wwm reauth` in this session does not revoke anything — it hands back the two commands and changes nothing, on purpose. A revocation done here on the strength of a command the user might never paste would cost them a working connection and buy them nothing.

**You can run `wwm verify` and `wwm status`.** They are headless. Run them yourself.

**Do not tell the user to run `wwm` in their terminal.** A plugin install puts `wwm` on `PATH` inside Claude Code sessions only. The only commands you hand over are `claude mcp logout` and `claude mcp login`, which are on their normal `PATH`.

## Steps

1. Run `wwm status --json` first and report what the connection reaches **now**. This is the last cheap moment to catch "that is not the connection I meant", and after the logout the old list is history.
2. Run `wwm reauth <slug> --json`. It returns `logoutCommand` and `loginCommand` and does nothing else. Confirm `revoked` is `false` before telling the user nothing has changed yet.
3. Hand over **both** commands, together, and say the first one is the destructive half:

   ```
   claude mcp logout wf-<slug>
   claude mcp login wf-<slug>
   ```

   Both are needed. `claude mcp login` on its own reuses the OAuth client already registered for that server, and Webflow can wave it through on the grant it already has on file — the site picker never appears and nothing changes. The logout is what deletes that registration, so the next login arrives as a first-time client and the consent screen is shown properly. (The Claude Code behaviour is measured against 2.1.231; that Webflow skips the picker for a returning client is inferred from it, which is why the reporting step below checks rather than assumes.)
4. Brief them on the consent screen, and lead with the replacement rule from above. It lists every site in every workspace they can reach and it is multi-select; tick everything the client should reach **from now on**. Do not tick the workspace row unless they mean the whole workspace.
5. Wait for them to say they authorized it, then run `wwm verify <slug> --json` yourself.

## Reporting the result

Report the new site list, then compare it to the old one — the reason someone reauthorized is almost always that the old list was wrong, so "did it change" is the actual question.

**If the list came back identical**, do not report success. Webflow re-approved the grant it already had rather than showing the picker, which happens when the logout was skipped or when the app is still authorized on Webflow's side. Tell them to revoke it in Webflow's own app settings — under the authorized apps for that workspace — and then run the two commands again. A consent screen has nothing to wave through once the app is no longer authorized there.

**If verification fails**, the reauthorization is not confirmed. Exit `6` means nothing was checked, not that it is fine. The server entry is untouched, so the fix is to re-run the login, not to reauthorize again.

Exit codes: `2` no such connection (use `/wwm:connect`), `3` preflight, `6` could not verify, `7` output parse failure.
