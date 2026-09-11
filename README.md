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
| **BARN** | MC1 scheduled tasks: the Historian, Ollama, SyncRepos, the dormant Dolphin tasks | Task Scheduler, plus an HTTP probe of Ollama |
| **STABLE** | the two self-hosted runners | the runners API |

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
token — reads scheduled tasks through PowerShell, and makes two HTTP probes it
knows the URLs of. GitHub paths must sit under the org, task names and
workflow files are validated against a character set, and VISIT opens
`https://github.com/` and nothing else.

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
(task), `runner` (repo, name), `probe` (probe, optional task), `none` (why).
Feed kinds: `workflow`, `task`. `stale` is hours.

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
