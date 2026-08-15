---
name: verify
description: Check what a Webflow connection can actually reach. Use when the user asks which sites a client connection can see, whether a connection is scoped the way they intended, or wants to audit Webflow access before doing work.
---

# Verify Webflow connection scope

Check what "$ARGUMENTS" can actually reach. With no argument, check every connection.

## Why this exists

What a connection reaches is decided by the user's ticks on Webflow's consent screen. Nothing in this plugin can see that choice — the token lives in Claude Code's keychain and we deliberately never read it. `verify` asks the live connection what it can see and reports the answer.

**Run it yourself.** `wwm` is on your `PATH` in this session; it is very likely *not* on the user's. Never end a turn by telling them to run `wwm verify` in their terminal.

## Steps

1. Run `wwm verify <slug> --json`, or `wwm verify --json` for all.
2. This spends real money on the user's Claude account — roughly $0.04 and 7–11 seconds per connection. Before verifying more than a handful, say what it will cost and confirm.
3. Read `results[]`. Each entry has `ok`, `sites`, `total`, `singleSite`, `workspaceIds`, and `reason`.

## Reporting

**`ok: true`** — report the site names. That is the whole answer: "reaches 3 sites: A, B, C."

**A connection reaching several sites is normal.** Webflow's picker is multi-select by design, and authorizing a client's five sites — or a whole group — in one grant is a deliberate, common thing to do. Do not call it over-scoped, do not warn about it, and do not offer to re-authorize unless the user says the list is wrong. `singleSite` is available if you need the fact; it is not a grade.

The one useful question is whether these are the sites they *meant*. Ask it once, plainly, and only when there is something to notice — a site name unrelated to the client, or a list much longer than the conversation implied. If the user already told you which sites they authorized, say the result matches and move on.

**`ok: false`** — could not verify. Report the `reason` and stop. **This is not a pass.** Common causes, in order of likelihood:
- The connection is deactivated for this directory, so the credential will not resolve from here. `wwm verify` already runs from a neutral working directory, so if you see this, check `wwm status` for the active flag.
- The model answered from prior context without calling a tool. The parser catches this and refuses to count it — a confident list of site names with no tool call behind it is a hallucination, and it is the exact failure this check is built to reject.
- The transcript was truncated or the tool result could not be read.

**More than one entry in `workspaceIds`** — report it as a platform change, not a user error. Webflow caps a grant at one workspace. If two ever appear, an assumption this plugin rests on has changed and the finding needs to reach the maintainer.

## Staleness

Verification records a timestamp. A result from last month describes last month — the user could have re-authorized since, and the grant could have been changed in Webflow's own app settings. Say how old a cached result is rather than presenting it as current. `wwm verify --max-age 24h` re-checks anything older than a day.
