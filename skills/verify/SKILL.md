---
name: verify
description: Check what a Webflow connection can actually reach. Use when the user asks whether a connection is correctly scoped, which sites a client connection can see, or wants to audit Webflow access before doing work.
---

# Verify Webflow connection scope

Check what "$ARGUMENTS" can actually reach. With no argument, check every connection.

## Why this exists

Per-site isolation is enforced by the user's click on Webflow's consent screen — not by Webflow, and not by this plugin. The only structural guarantee is that one grant cannot span two workspaces.

So `wwm verify` is not a reassurance that a guarantee held. **It is the only enforcement there is.** Treat a skipped verification as an unknown, not a pass.

## Steps

1. Run `wwm verify <slug> --json`, or `wwm verify --json` for all.
2. This spends real money on the user's Claude account — roughly $0.04 and 7–11 seconds per connection. Before verifying more than a handful, say what it will cost and confirm.
3. Read `results[]`. Each entry has `ok`, `isolated`, `sites`, `total`, `workspaceIds`, and `reason`.

## Reporting

**`ok: true, isolated: true`** — scoped to one site. Name it.

**`ok: true, isolated: false`** — over-scoped. Lead with this. List every site in `sites`. The fix is re-authorization, not repair: `wwm remove <slug> --yes` then `wwm connect <slug>`, ticking only the intended site. Say plainly that until then, work in this project can reach every site listed.

**`ok: false`** — could not verify. Report the `reason` and stop. **This is not a pass.** Common causes, in order of likelihood:
- The connection is deactivated for this directory, so the credential will not resolve from here. `wwm verify` already runs from a neutral working directory, so if you see this, check `wwm status` for the active flag.
- The model answered from prior context without calling a tool. The parser catches this and refuses to count it — a confident list of site names with no tool call behind it is a hallucination, and it is the exact failure this check is built to reject.
- The transcript was truncated or the tool result could not be read.

**More than one entry in `workspaceIds`** — report it as a platform change, not a user error. Webflow caps a grant at one workspace. If two ever appear, the assumption this plugin's isolation model rests on has changed and the finding needs to reach the maintainer.

## Staleness

Verification records a timestamp. A result from last month describes last month — the user could have re-authorized since, and the grant could have been changed in Webflow's own app settings. Say how old a cached result is rather than presenting it as current. `wwm verify --max-age 24h` re-checks anything older than a day.
