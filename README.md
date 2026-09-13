# BOT//FARM

A Tauri v2 desktop app for keeping an eye on every bot the family runs, drawn
as a farm: each place bots live is a field, each bot is an animal in a pen,
and each animal is grazing, working, hungry, sick, asleep, strayed or
unaccounted for.

Built on [magma-kit](../../engines/magma-kit).

## The farm

| Field | What lives there | How it is seen |
|---|---|---|
| **PASTURE** | GitHub Actions workflows on `magmacrunch.com` | the latest run of each workflow |
| **COOP** | the eight Pi cron bots (`arcade/scripts/bot-*.sh`) | the commit each leaves when it succeeds — the Pi answers only on Tailscale, and three of them leave no trace at all, which the farm says rather than guesses |
| **BARN** | MC1 scheduled tasks: the Historian, Ollama, SyncRepos, the dormant Dolphin tasks | Task Scheduler, plus an HTTP probe of Ollama — and for the Historian, the journal it writes about itself |
| **STABLE** | the two self-hosted runners | the runners API |
| **DOVECOTE** | the three Discord webhooks everything else posts through | a GET on the webhook, when this machine holds a copy of its URL |

A bot goes in the field that says where it runs — PASTURE is GitHub Actions,
BARN is this machine's scheduled tasks — with one exception: the DOVECOTE is
a category rather than a place, because a webhook runs nowhere and belongs
beside the other webhooks.

The pasture is every workflow on the site, which it had not been: `ci.yml`
and `backup-private.yml` were added on 2026-09-11, both failing at the time
and neither watched by anything. The site's own `bot-status.yml` reports on
six workflows and lists *itself* among them, so it is also the one thing
that cannot report its own silence — which this app can.

Every state has a rule, and the rules live in one file
([`app/core/health.js`](app/core/health.js)) so they can be read:

| State | Means |
|---|---|
| GRAZING | last thing it did succeeded, within its window |
| WORKING | running right now |
| HUNGRY | nothing from it inside its `stale` window — a weekly bot with no evidence for 8 days |
| SICK | the last run failed, a probe is unreachable, or a long-running bot is not running |
| ASLEEP | disabled at the source, or dormant on purpose (the Dolphin tasks) |
| STRAYED | the feed loaded and the bot is not in it |
| UNKNOWN | nothing to go on — feed not loaded, or the bot leaves no trace. Never dressed up as healthy |

The website's own weekly report once printed "active" for every Pi bot
through a two-week outage, because it checked nothing. UNKNOWN exists so this
app cannot do that: a bot only reads well when something it did can be seen.

### The Historian is read from its journal, not from its task

The scheduled task is the reading that misleads. `MagmaCrunchHistorianBot`
runs, the bot holds its Discord gateway, and it answers every message with
"I couldn't reach Ollama just now" — which is what it did from 2026-08-24 to
2026-09-04 while every signal anybody had said it was up.

So the Historian's evidence is the JSONL journal it writes at startup:
`discord_ready`, then `ollama_ready` (with `model_present`) or
`ollama_unreachable`. Three separate things have to be true for it to graze
— the gateway connected, Ollama answered, the model is loaded — and any one
of them failing is a bot that is running and useless. The task is still read
alongside, because a journal is history: a perfect startup line proves
nothing once the process has gone.

Only those three events cross the bridge. The journal also records every
message anybody sends the bot, and `farm.rs` reads an allowlist of event
names and drops any `text` field it meets.

### The dovecote

A webhook is not a bot, but a dead one is the quietest failure on the farm:
the alert is accepted by nobody and every bot involved still reads healthy.
`weekly-scores.yml` posted into a 403 from 2026-08-08 and the only record is
a comment somebody had to notice and write.

A webhook URL is a bearer credential, so the herd names one and never holds
one. `farm.rs` resolves the name at probe time — environment first, then
`webhooks.json` beside herd.json in the config directory — GETs it, and
reports the name Discord answers with, or its 401 / 404. The URL never
crosses the bridge, is never returned even in the reading that says it is
wrong, and is never written to the log; the transport-error path returns
fixed text rather than ureq's message, because ureq puts the URL into it.

```json
{ "alerts-pi": "https://discord.com/api/webhooks/..." }
```

A name that resolves to nothing reads UNKNOWN, which is the truth — the
webhook may be perfectly alive on the Pi, where the only valid copy of the
alerts URL actually lives. As it stands MC1 holds none of the three, so all
three pigeons are unaccounted for until somebody writes that file.

## Chores

- **FEED** — run it now. `gh workflow run` for anything with a
  `workflow_dispatch` (the Pi bots kept theirs), `Start-ScheduledTask` for
  the barn.
- **PEN / LET OUT** — disable or enable it, at the source. A Pi bot cannot be
  penned from here: its feed is a GitHub workflow, but its schedule is a
  crontab on the Pi, and disabling the one would not touch the other.
- **VISIT** — open it on GitHub.

Every chore confirms first and is written to the log file.

## Where the readings come from

Nothing crosses the bridge but names. The Rust side (`desktop/src-tauri/src/farm.rs`)
runs `gh` — so the app has whatever `gh auth login` has, and never holds a
token — reads scheduled tasks through PowerShell, makes HTTP probes it knows
the URLs of, and reads one allowlisted journal directory. GitHub paths must
sit under the org, task names and workflow files are validated against a
character set, and VISIT opens `https://github.com/` and nothing else.

The two additions of 2026-09-11 keep that rule rather than bending it: the
webview asks about a journal or a webhook *by name*, and gets back neither a
webhook URL nor a line of the Historian's conversation. Both are tested for,
because both are the kind of thing that leaks by accident — through an error
string, or through a field nobody thought about.

Feeds are fetched independently: the Pi being off the tailnet dims the coop
and nothing else, and the header strip says which feed failed.

## Adding a bot

The herd is data, in [`app/core/herd.js`](app/core/herd.js). For a bot the
whole family should see, add a row there. For one machine's own, put a
`herd.json` in the config directory (`%APPDATA%\com.magmacrunch.bot-farm\`),
an array of the same records; an `id` already in the herd replaces that
record, and a record that is not a bot is dropped and named in the header
strip.

```json
[
  {
    "id": "my-task", "name": "My Task", "species": "owl", "field": "barn",
    "does": "what it does", "cadence": "nightly", "stale": 30,
    "source": { "kind": "task", "task": "MyTask" },
    "feed": { "kind": "task", "task": "MyTask" }
  }
]
```

Source kinds: `workflow` (repo, file), `commit` (repo, subject), `task`
(task), `runner` (repo, name), `probe` (probe, optional task), `journal`
(journal, optional task), `webhook` (webhook), `none` (why).
Feed kinds: `workflow`, `task`. `stale` is hours.

A source may not carry a URL, and a record that does is dropped with that
reason. `journal` and `webhook` name something the desktop side knows how to
resolve, so a new one of either means a row in `JOURNALS` or `WEBHOOKS` in
[`farm.rs`](desktop/src-tauri/src/farm.rs) too — a name it does not know is
an error, not a fetch.

## Reading the farm from somewhere else (MCP)

`mcp/` serves the same readings as MCP tools, so a client that is not this
window — opencode on a Mac, Claude Code, anything that speaks MCP — can ask how
the farm is doing. Two tools, `farm_status` and `farm_bot`, and no others:
**it is read-only**. The chores stay in the app, where each one confirms
through a dialog and is written to the log, and an MCP client has neither.

Nothing about a bot is restated in that directory. `mcp/walk.mjs` evaluates
`app/core/` and `ui/feeds.js` exactly as the page does, through the same
harness the test suite uses, and substitutes one thing at the bottom:
`BotFarm.farm` becomes `farm-cli` instead of Tauri's bridge.

`farm-cli` is a second binary in the desktop crate
([`src/bin/farm-cli.rs`](desktop/src-tauri/src/bin/farm-cli.rs)) that prints
one JSON value from the same `farm::*` functions the window calls. That is the
whole reason it exists rather than having Node shell out to `gh` and PowerShell
itself: the org-prefix check on API paths, the task-name character set, the
journal's event allowlist and the webhook path that never returns a URL are all
in farm.rs, they all have tests, and a second implementation would be a second
thing to get wrong. `gh_workflow`, `task_action` and `open_url` sit one module
away and are unreachable from the shim — `tests/mcp.test.mjs` fails if this
file so much as names one.

```bash
cd desktop/src-tauri && cargo build --release --bin farm-cli
```

### On this machine

```bash
node mcp/server.mjs --stdio
```

That is what a local client wants. In Claude Code, `.mcp.json`:

```json
{ "mcpServers": { "bot-farm": { "command": "node", "args": ["C:/magma/dev/magmacrunch/apps/bot-farm/mcp/server.mjs", "--stdio"] } } }
```

### From another machine

`node mcp/server.mjs --http` speaks the same protocol over `POST /mcp`. It
binds `127.0.0.1` by default and **refuses to bind anything else without a
token**, because a farm reading names every bot this family runs and which of
them are down.

`mcp/install.ps1` writes a token to `%APPDATA%\com.magmacrunch.bot-farm\mcp-token`
— beside `herd.json` and `webhooks.json`, for the same reasons — and registers
`MagmaCrunchBotFarmMCP`, a logon task that keeps the server up through
`serve.vbs` → `serve.bat`. The server finds the token on its own, so it never
appears on a command line. No elevation: the task runs as the logged-on user,
which is the only account that can see that directory or the `gh` keyring the
readings depend on.

```powershell
.\mcp\install.ps1
Start-ScheduledTask -TaskName MagmaCrunchBotFarmMCP
```

Then reach it over Tailscale, either by publishing the loopback listener
through tailscaled —

```powershell
tailscale serve --bg --http=8787 http://127.0.0.1:8787
```

— which needs no firewall rule and leaves nothing listening on a real
interface, or by binding the tailnet address directly with
`.\mcp\install.ps1 -Tailnet`, which does need one (the script prints it).

On the Mac, in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bot-farm": {
      "type": "remote",
      "url": "http://mc1.tail83d36d.ts.net:8787/mcp",
      "enabled": true,
      "headers": { "Authorization": "Bearer <the token install.ps1 printed>" }
    }
  }
}
```

**MC1 sleeps constantly and something wakes it a minute later** — see the tree's
CLAUDE.md — so the server being unreachable usually means the machine is
asleep, not that anything is broken. `GET /health` answers without a token and
is there to tell those apart; `wakeonlan` from `magmacrunch-server` is the way
back in.

Two more things worth knowing. A reading is cached for a minute and its age is
always stated, because a walk is a dozen `gh` calls and a client asking three
questions should not make the farm run three times; pass `refresh: true` to
force one. And the task's paths are absolute, so **moving this repo breaks it**
— the same trap as `MagmaCrunchHistorianBot`. Re-run `install.ps1` after a move.

```bash
node tests/run.mjs
```

covers the assembly against `app/fixtures/`, the protocol, the read-only
guarantee and the refusal to serve the tailnet unguarded — all without a
network or a built binary.

## Build

```bash
cd desktop && npm install
```
```bash
npm run dev
```
```bash
npm run build
```

Bundles land in `desktop/src-tauri/target/release/bundle/{msi,nsis}/`. Needs
the sibling `magma-kit` checkout (see the junction note in the tree's
CLAUDE.md) and `gh` signed in.

## Test

```bash
npm install && npm run check
```

`npm run check` is lint plus `node tests/run.mjs`: the herd, the evidence
normalizers and the health rules, run against the same fixtures the browser
mode shows. The Rust validators have their own:

```bash
cd desktop/src-tauri && cargo test
```

## Browser mode

```bash
npm run serve
```

then open `http://localhost:3300/ui/`. With no Tauri backend the page reads
`app/fixtures/*.json` — captured from real data — and shows FIXTURES in the
header. Chores are hidden; VISIT works.
