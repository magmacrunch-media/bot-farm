// core/herd.js — the herd: every bot the farm knows about, and the vocabulary
// for talking about them.
//
// A bot is a record, not code. Where it lives (`field`), what it looks like
// (`species`), where its EVIDENCE comes from (`source`) and how to poke it
// (`feed`) are all data, so adding a bot is adding a row — here for the
// family's own, or in `herd.json` in the config directory for a one-machine
// addition (see README).
//
// The evidence sources are deliberately few:
//
//   workflow  the latest run of a GitHub Actions workflow file
//   commit    the latest commit whose subject starts with a phrase — how the
//             Pi cron bots are seen, since the Pi answers only on Tailscale
//             and every one of them leaves a commit when it succeeds
//   task      a Windows scheduled task on this machine
//   runner    a self-hosted Actions runner
//   probe     a named HTTP check the desktop side knows how to make
//   none      the bot leaves no trace anywhere reachable; say so, do not guess
//
// Nothing here fetches. core/evidence.js turns raw feeds into per-bot
// evidence and core/health.js turns evidence into a farm state.

(function () {
    'use strict';

    const App = (window.BotFarm = window.BotFarm || {});

    const SITE = 'magmacrunch-media/magmacrunch.com';

    /** Where bots live, in the order the farm draws them. */
    const FIELDS = [
        { id: 'pasture', name: 'PASTURE', tag: 'GitHub Actions', blurb: 'workflows grazing in the cloud' },
        { id: 'coop', name: 'COOP', tag: 'Pi cron', blurb: 'the Raspberry Pi — seen by the commits they leave; Pi time is America/New_York' },
        { id: 'barn', name: 'BARN', tag: 'MC1 scheduled tasks', blurb: 'this machine' },
        { id: 'stable', name: 'STABLE', tag: 'self-hosted runners', blurb: 'the workhorses' },
    ];

    const SPECIES = {
        cow: { sprite: '🐄', name: 'cow' },
        sheep: { sprite: '🐑', name: 'sheep' },
        goat: { sprite: '🐐', name: 'goat' },
        bee: { sprite: '🐝', name: 'bee' },
        chicken: { sprite: '🐔', name: 'hen' },
        rooster: { sprite: '🐓', name: 'rooster' },
        duck: { sprite: '🦆', name: 'duck' },
        pig: { sprite: '🐖', name: 'pig' },
        dog: { sprite: '🐕', name: 'dog' },
        cat: { sprite: '🐈', name: 'barn cat' },
        horse: { sprite: '🐴', name: 'horse' },
        owl: { sprite: '🦉', name: 'owl' },
    };

    const DAY = 24;

    /* The family's own bots. `stale` is hours: how long without evidence
       before the animal is called hungry. Absent means the bot has no
       schedule to be late for (push-triggered, long-running, dormant). */
    const DEFAULT = [
        // ── PASTURE: GitHub Actions ─────────────────────────
        {
            id: 'bot-status', name: 'Bot Status Report', species: 'cow', field: 'pasture',
            does: 'posts the weekly bot report to a Discussion', cadence: 'Mon 07:00 UTC', stale: 8 * DAY,
            source: { kind: 'workflow', repo: SITE, file: 'bot-status.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'bot-status.yml' },
        },
        {
            id: 'sync-magmascript', name: 'magmascript playground', species: 'sheep', field: 'pasture',
            does: 're-embeds the magmascript playground', cadence: 'Mon 08:17 UTC', stale: 8 * DAY,
            source: { kind: 'workflow', repo: SITE, file: 'sync-magmascript-playground.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'sync-magmascript-playground.yml' },
        },
        {
            id: 'sync-texastoast', name: 'texastoast playground', species: 'sheep', field: 'pasture',
            does: 're-embeds the texastoast playground', cadence: 'Mon 08:29 UTC', stale: 8 * DAY,
            source: { kind: 'workflow', repo: SITE, file: 'sync-texastoast-playground.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'sync-texastoast-playground.yml' },
        },
        {
            id: 'sync-adenosine', name: 'adenosine playground', species: 'sheep', field: 'pasture',
            does: 're-embeds the adenosine playground', cadence: 'Mon 08:41 UTC', stale: 8 * DAY,
            source: { kind: 'workflow', repo: SITE, file: 'sync-adenosine-playground.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'sync-adenosine-playground.yml' },
        },
        {
            id: 'sync-crunch-c', name: 'crunch-c lessons', species: 'sheep', field: 'pasture',
            does: 'syncs the crunch-c lessons into the site', cadence: 'Tue 08:41 UTC', stale: 8 * DAY,
            source: { kind: 'workflow', repo: SITE, file: 'sync-crunch-c.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'sync-crunch-c.yml' },
        },
        {
            id: 'deploy-pi', name: 'Deploy to Pi', species: 'goat', field: 'pasture',
            does: 'rsyncs arcade/ to the Pi on every push to main', cadence: 'on push',
            source: { kind: 'workflow', repo: SITE, file: 'deploy-pi.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'deploy-pi.yml' },
        },
        {
            id: 'theme-audit', name: 'Theme Audit', species: 'bee', field: 'pasture',
            does: 'audits theme colours and commits the report', cadence: 'on push',
            source: { kind: 'workflow', repo: SITE, file: 'theme-audit.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'theme-audit.yml' },
        },
        {
            id: 'check-archive-format', name: 'Archive Format Check', species: 'bee', field: 'pasture',
            does: 'checks archive HTML formatting and keeps an Issue current', cadence: 'on archive push',
            source: { kind: 'workflow', repo: SITE, file: 'check-archive-format.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'check-archive-format.yml' },
        },
        {
            id: 'generate-stubs', name: 'Archive Stubs', species: 'bee', field: 'pasture',
            does: 'generates archive page stubs from archive-stubs.json', cadence: 'on config push',
            source: { kind: 'workflow', repo: SITE, file: 'generate-stubs.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'generate-stubs.yml' },
        },
        {
            id: 'bake-cache', name: 'Bake Cache', species: 'goat', field: 'pasture',
            does: 'inlines the MusicBrainz cache into the archive pages', cadence: 'after a MusicBrainz backup workflow run, or by hand',
            source: { kind: 'workflow', repo: SITE, file: 'bake-cache.yml' },
            feed: { kind: 'workflow', repo: SITE, file: 'bake-cache.yml' },
        },

        // ── COOP: Pi cron bots ──────────────────────────────
        {
            id: 'pi-musicbrainz', name: 'MusicBrainz Backup', species: 'chicken', field: 'coop',
            does: 'refreshes the MusicBrainz cache and pushes it', cadence: 'Mon 06:00 Pi time', stale: 8 * DAY,
            source: { kind: 'commit', repo: SITE, subject: 'Update MusicBrainz cache' },
            feed: { kind: 'workflow', repo: SITE, file: 'backup-musicbrainz.yml' },
        },
        {
            id: 'pi-tmdb', name: 'TMDB Backup', species: 'chicken', field: 'coop',
            does: 'refreshes the TMDB cache and pushes it', cadence: 'Mon 06:35 Pi time', stale: 8 * DAY,
            source: { kind: 'commit', repo: SITE, subject: 'Update TMDB cache' },
            feed: { kind: 'workflow', repo: SITE, file: 'backup-tmdb.yml' },
        },
        {
            id: 'pi-play-counts', name: 'Play Counts', species: 'chicken', field: 'coop',
            does: 'fetches Last.fm play counts and pushes them', cadence: 'Mon 06:05 Pi time', stale: 8 * DAY,
            source: { kind: 'commit', repo: SITE, subject: 'Update Last.fm play counts' },
            feed: { kind: 'workflow', repo: SITE, file: 'play-counts.yml' },
        },
        {
            id: 'pi-weekly-scores', name: 'Weekly Scores', species: 'chicken', field: 'coop',
            does: 'posts the leaderboard to a Discussion and Discord', cadence: 'Mon 06:10 Pi time', stale: 8 * DAY,
            source: { kind: 'commit', repo: SITE, subject: 'Update score data' },
            feed: { kind: 'workflow', repo: SITE, file: 'weekly-scores.yml' },
        },
        {
            id: 'pi-search-index', name: 'Search Index', species: 'duck', field: 'coop',
            does: 'rebuilds the search index and pushes it', cadence: 'daily 07:05 Pi time', stale: 2 * DAY,
            source: { kind: 'commit', repo: SITE, subject: 'Rebuild search index' },
            feed: { kind: 'workflow', repo: SITE, file: 'rebuild-search-index.yml' },
        },
        {
            id: 'pi-check-links', name: 'Link Checker', species: 'owl', field: 'coop',
            does: 'lychee over every page; files an Issue when links break', cadence: 'Mon 06:15 Pi time',
            source: { kind: 'none', why: 'success leaves no commit — only a failure files an Issue' },
            feed: { kind: 'workflow', repo: SITE, file: 'check-links.yml' },
        },
        {
            id: 'pi-check-services', name: 'Service Health', species: 'rooster', field: 'coop',
            does: 'TCP-checks the arcade ports; crows on Discord when one is down', cadence: 'every 30 min',
            source: { kind: 'none', why: 'success leaves no trace — only a failure posts' },
            feed: { kind: 'workflow', repo: SITE, file: 'check-services.yml' },
        },
        {
            id: 'pi-smoke-test', name: 'Smoke Test', species: 'owl', field: 'coop',
            does: 'Playwright smoke tests; files an Issue on failure', cadence: 'Mon 10:00 Pi time',
            source: { kind: 'none', why: 'success leaves no trace — only a failure files an Issue' },
            feed: { kind: 'workflow', repo: SITE, file: 'smoke-test.yml' },
        },
        {
            id: 'pi-status-feeder', name: 'Status Feeder', species: 'duck', field: 'coop',
            does: 'status.py — writes the JSON the MAGMA//OPS status server serves', cadence: 'every minute', stale: 0.25,
            source: { kind: 'probe', probe: 'pi-status' },
        },
        {
            id: 'pi-mc1-monitor', name: 'MC1 Monitor', species: 'rooster', field: 'coop',
            does: 'pings MC1 and appends to a log on the Pi', cadence: 'every 2 min',
            source: { kind: 'none', why: 'writes only to a log on the Pi; nothing reachable from here' },
        },

        // ── BARN: MC1 scheduled tasks ───────────────────────
        {
            id: 'historian', name: 'Historian', species: 'dog', field: 'barn',
            does: 'the Discord bot — answers questions about the archive', cadence: 'always on', longRunning: true,
            source: { kind: 'task', task: 'MagmaCrunchHistorianBot' },
            feed: { kind: 'task', task: 'MagmaCrunchHistorianBot' },
        },
        {
            id: 'ollama', name: 'Ollama', species: 'pig', field: 'barn',
            does: 'the model server the Historian eats from', cadence: 'always on', longRunning: true,
            source: { kind: 'probe', probe: 'ollama', task: 'MagmaCrunchOllamaServe' },
            feed: { kind: 'task', task: 'MagmaCrunchOllamaServe' },
        },
        {
            id: 'sync-repos', name: 'SyncRepos', species: 'duck', field: 'barn',
            does: 'git fetch --all --prune across the dev tree', cadence: 'hourly', stale: 3,
            source: { kind: 'task', task: 'SyncRepos' },
            feed: { kind: 'task', task: 'SyncRepos' },
        },
        {
            id: 'dolphin-run', name: 'DolphinRun', species: 'cat', field: 'barn',
            does: 'one-shot Dolphin launcher; dormant on purpose', cadence: 'never', dormant: true,
            source: { kind: 'task', task: 'DolphinRun' },
        },
        {
            id: 'dolphin-click', name: 'DolphinClick', species: 'cat', field: 'barn',
            does: 'injects synthetic clicks — re-arming it would pin the machine awake', cadence: 'never', dormant: true,
            source: { kind: 'task', task: 'DolphinClick' },
        },
        {
            id: 'dolphin-keys', name: 'DolphinKeys', species: 'cat', field: 'barn',
            does: 'injects synthetic keystrokes — re-arming it would pin the machine awake', cadence: 'never', dormant: true,
            source: { kind: 'task', task: 'DolphinKeys' },
        },

        // ── STABLE: self-hosted runners ─────────────────────
        {
            id: 'runner-linux', name: 'MC1-linux', species: 'horse', field: 'stable',
            does: 'the WSL2 runner: service checks and smoke tests', cadence: 'on demand', longRunning: true,
            source: { kind: 'runner', repo: SITE, name: 'MC1-linux' },
        },
        {
            id: 'runner-windows', name: 'MC1-runner', species: 'horse', field: 'stable',
            does: 'the Windows runner: the Pi deploy is pinned to it', cadence: 'on demand', longRunning: true,
            source: { kind: 'runner', repo: SITE, name: 'MC1-runner' },
        },
    ];

    const SOURCE_KINDS = ['workflow', 'commit', 'task', 'runner', 'probe', 'none'];
    const FEED_KINDS = ['workflow', 'task'];

    /** Every reason a record is not a bot, or [] when it is one. */
    function problems(bot) {
        const out = [];
        if (!bot || typeof bot !== 'object') return ['not an object'];
        if (!bot.id || !/^[a-z0-9-]+$/.test(bot.id)) out.push('id must be kebab-case');
        if (!bot.name) out.push('name missing');
        if (!SPECIES[bot.species]) out.push(`unknown species: ${bot.species}`);
        if (!FIELDS.some((f) => f.id === bot.field)) out.push(`unknown field: ${bot.field}`);
        const s = bot.source;
        if (!s || !SOURCE_KINDS.includes(s.kind)) out.push('source.kind missing or unknown');
        else if (s.kind === 'workflow' && !(s.repo && s.file)) out.push('workflow source needs repo and file');
        else if (s.kind === 'commit' && !(s.repo && s.subject)) out.push('commit source needs repo and subject');
        else if (s.kind === 'task' && !s.task) out.push('task source needs task');
        else if (s.kind === 'runner' && !(s.repo && s.name)) out.push('runner source needs repo and name');
        else if (s.kind === 'probe' && !s.probe) out.push('probe source needs probe');
        const f = bot.feed;
        if (f !== undefined) {
            if (!f || !FEED_KINDS.includes(f.kind)) out.push('feed.kind missing or unknown');
            else if (f.kind === 'workflow' && !(f.repo && f.file)) out.push('workflow feed needs repo and file');
            else if (f.kind === 'task' && !f.task) out.push('task feed needs task');
        }
        if (bot.stale !== undefined && !(typeof bot.stale === 'number' && bot.stale > 0)) out.push('stale must be hours > 0');
        return out;
    }

    /**
     * The default herd plus a machine's own additions. An extra with an id
     * already in the herd REPLACES that record (so herd.json can retune a
     * `stale` or move a bot to another field); a bad record is dropped and
     * reported, never allowed to take the farm down.
     *
     * Returns { herd, dropped: [{ record, problems }] }.
     */
    function merge(extras) {
        const byId = new Map(DEFAULT.map((b) => [b.id, b]));
        const dropped = [];
        for (const rec of Array.isArray(extras) ? extras : []) {
            const p = problems(rec);
            if (p.length) { dropped.push({ record: rec, problems: p }); continue; }
            byId.set(rec.id, rec);
        }
        return { herd: [...byId.values()], dropped };
    }

    /** Bots grouped by field, in FIELDS order; every field present even if empty. */
    function byField(herd) {
        return FIELDS.map((f) => ({ field: f, bots: herd.filter((b) => b.field === f.id) }));
    }

    App.herd = { FIELDS, SPECIES, DEFAULT, SITE, problems, merge, byField };
}());
