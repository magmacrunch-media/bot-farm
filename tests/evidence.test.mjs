// The fixtures under app/fixtures/ are captured from real data and are what a
// plain browser shows, so the same files prove the normalizers here.

import { test, eq, ok } from './kit/assert.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'fixtures');
const fixture = (name) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8'));

export default function (M) {
    const E = M.evidence;
    const H = M.herd;
    const feeds = {
        runs: fixture('runs'), workflows: fixture('workflows'), commits: fixture('commits'),
        tasks: fixture('tasks'), runners: fixture('runners'), probes: fixture('probes'),
        journals: fixture('journals'), webhooks: fixture('webhooks'),
    };
    const bot = (id) => H.DEFAULT.find((b) => b.id === id);

    test('every fixture the default herd needs is present', () => {
        for (const b of H.DEFAULT) {
            const s = b.source;
            if (s.kind === 'workflow') ok(E.runKey(s) in feeds.runs, `runs fixture has ${E.runKey(s)}`);
            if (s.kind === 'commit') ok(E.commitKey(s) in feeds.commits, `commits fixture has ${E.commitKey(s)}`);
            if (s.kind === 'probe') ok(s.probe in feeds.probes, `probes fixture has ${s.probe}`);
            if (s.kind === 'journal') ok(s.journal in feeds.journals, `journals fixture has ${s.journal}`);
            if (s.kind === 'webhook') ok(s.webhook in feeds.webhooks, `webhooks fixture has ${s.webhook}`);
        }
    });

    test('a workflow run becomes evidence', () => {
        const ev = E.gather(bot('bot-status'), feeds);
        eq(ev.found, true);
        eq(ev.ok, true);
        eq(ev.enabled, true, 'workflow state active');
        ok(ev.at > Date.parse('2026-09-01'), 'timestamp parsed');
        ok(ev.url.startsWith('https://github.com/'), 'links to the run');
        ok(ev.detail.includes('on schedule'), ev.detail);
    });

    test('a failed run is ok:false', () => {
        const ev = E.gather(bot('check-archive-format'), feeds);
        eq(ev.ok, false);
        ok(ev.detail.startsWith('failure'), ev.detail);
    });

    test('a workflow that never ran is found but has no time', () => {
        const ev = E.gather({ source: { kind: 'workflow', repo: H.SITE, file: 'play-counts.yml' } }, feeds);
        eq(ev.found, true, 'the workflow exists');
        eq(ev.at, null);
        eq(ev.detail, 'never run');
    });

    test('an in-progress run is running with no verdict yet', () => {
        const key = `${H.SITE}/bot-status.yml`;
        const f = { runs: { [key]: Object.assign({}, feeds.runs[key], { status: 'in_progress', conclusion: null }) } };
        const ev = E.gather(bot('bot-status'), f);
        eq(ev.running, true);
        eq(ev.ok, null);
    });

    test('a commit-keyed bot is seen by its latest commit, or not at all', () => {
        const seen = E.gather(bot('pi-tmdb'), feeds);
        eq(seen.found, true);
        eq(seen.ok, true);
        ok(seen.at > 0);
        ok(seen.detail.startsWith('committed '), seen.detail);
        const unseen = E.gather(bot('pi-play-counts'), feeds);
        eq(unseen.found, false, 'no such commit in the search results');
    });

    test('scheduled tasks: running, succeeded, disabled, failed, never', () => {
        const T = E.taskEvidence;
        const base = { name: 'x', state: 'Ready', enabled: true, lastRun: '2026-09-10T00:00:00Z', lastResult: 0 };
        eq(T(Object.assign({}, base, { state: 'Running', lastResult: 267009 })).running, true);
        eq(T(base).ok, true);
        eq(T(Object.assign({}, base, { enabled: false })).enabled, false);
        const failed = T(Object.assign({}, base, { lastResult: 2147942402 }));
        eq(failed.ok, false);
        ok(failed.detail.includes('0x80070002'), failed.detail);
        const small = T(Object.assign({}, base, { lastResult: 128 }));
        ok(small.detail.includes('exited 128'), small.detail);
        const never = T(Object.assign({}, base, { lastRun: null, lastResult: 267011 }));
        eq(never.ok, null);
        eq(never.at, null);
    });

    test('the dolphins are idle', () => {
        const cat = E.gather(bot('dolphin-run'), feeds);
        eq(cat.found, true);
        eq(cat.running, false);
    });

    test('the historian is read from its journal, both halves', () => {
        const ev = E.gather(bot('historian'), feeds);
        eq(ev.found, true);
        eq(ev.ok, true);
        eq(ev.enabled, true, 'the task lends enabled');
        ok(ev.at > Date.parse('2026-09-01'), 'the startup line is the time');
        ok(ev.detail.includes('Discord'), ev.detail);
        ok(ev.detail.includes('Ollama reachable'), ev.detail);
    });

    test('the historian is sick when either half is', () => {
        const j = feeds.journals.historian;
        const only = (events) => ({
            tasks: feeds.tasks,
            journals: { historian: Object.assign({}, j, { events }) },
        });

        // The failure that ran for eleven days: the gateway is up, the model
        // server is not, and the scheduled task reads perfectly healthy.
        const noOllama = E.gather(bot('historian'), only({
            discord_ready: j.events.discord_ready,
            ollama_unreachable: { ts: '2026-09-11T18:00:00Z', event: 'ollama_unreachable', where: 'startup' },
        }));
        eq(noOllama.ok, false);
        ok(noOllama.detail.includes('Ollama unreachable'), noOllama.detail);

        // A newer ollama_ready outranks an older ollama_unreachable.
        const recovered = E.gather(bot('historian'), only({
            discord_ready: j.events.discord_ready,
            ollama_unreachable: { ts: '2026-09-11T10:00:00Z', event: 'ollama_unreachable', where: 'startup' },
            ollama_ready: { ts: '2026-09-11T17:26:18Z', event: 'ollama_ready', model_present: true },
        }));
        eq(recovered.ok, true, 'the later line is the reading');

        // Ollama answers but the model it wants is not loaded.
        const noModel = E.gather(bot('historian'), only({
            discord_ready: j.events.discord_ready,
            ollama_ready: { ts: '2026-09-11T17:26:18Z', event: 'ollama_ready', model: 'magmacrunch-historian', model_present: false },
        }));
        eq(noModel.ok, false);
        ok(noModel.detail.includes('missing'), noModel.detail);

        // Never reached Discord at all.
        const noDiscord = E.gather(bot('historian'), only({ ollama_ready: j.events.ollama_ready }));
        eq(noDiscord.ok, false);
        ok(noDiscord.detail.includes('no Discord connection'), noDiscord.detail);
    });

    test('a journal is history — the task says whether it is still true', () => {
        const stopped = feeds.tasks.map((t) =>
            (t.name === 'MagmaCrunchHistorianBot' ? Object.assign({}, t, { state: 'Ready' }) : t));
        const ev = E.gather(bot('historian'), { tasks: stopped, journals: feeds.journals });
        eq(ev.ok, false, 'a healthy startup line proves nothing once the process is gone');
        ok(ev.detail.startsWith('process not running'), ev.detail);
    });

    test('a webhook with no local copy is unknown, never healthy', () => {
        const ev = E.gather(bot('hook-alerts-pi'), feeds);
        eq(ev.found, null, 'ignorance, not a stray — it may be alive on the Pi');
        eq(ev.ok, null);
        ok(ev.detail.includes('no local copy'), ev.detail);
    });

    test('a webhook Discord refuses is sick, and one it answers for is not', () => {
        const w = (hook) => ({ webhooks: { 'alerts-actions': hook } });
        const dead = E.gather(bot('hook-alerts-actions'),
            w({ known: true, ok: false, at: 1789147578737, detail: 'Discord refuses it: 401 Invalid Webhook Token' }));
        eq(dead.found, true);
        eq(dead.ok, false);
        const live = E.gather(bot('hook-alerts-actions'),
            w({ known: true, ok: true, at: 1789147578737, name: 'magmacrunch alerts' }));
        eq(live.ok, true);
        ok(live.detail.includes('magmacrunch alerts'), live.detail);
    });

    test('a probe reads ok and borrows enabled from its task', () => {
        const ev = E.gather(bot('ollama'), feeds);
        eq(ev.found, true);
        eq(ev.ok, true);
        eq(ev.enabled, true, 'MagmaCrunchOllamaServe is enabled');
        ok(ev.detail.includes('models'), ev.detail);
        const pi = E.gather(bot('pi-status-feeder'), feeds);
        eq(pi.enabled, null, 'no task behind it');
        ok(pi.at > 0);
    });

    test('runners are online or not', () => {
        const ev = E.gather(bot('runner-linux'), feeds);
        eq(ev.found, true);
        eq(ev.ok, true);
        ok(ev.url.includes('/settings/actions/runners'));
        const gone = E.gather({ source: { kind: 'runner', repo: H.SITE, name: 'MC1-mac' } }, feeds);
        eq(gone.found, false);
    });

    test('a missing feed is ignorance, not a stray', () => {
        for (const id of ['bot-status', 'pi-tmdb', 'historian', 'ollama', 'runner-linux',
            'hook-alerts-pi', 'dolphin-run']) {
            const ev = E.gather(bot(id), {});
            eq(ev.found, null, `${id} with no feeds`);
            ok(/not (loaded|made|read|checked)/.test(ev.detail), ev.detail);
        }
    });

    test('no-trace bots are found and say why', () => {
        const ev = E.gather(bot('pi-check-links'), feeds);
        eq(ev.found, true);
        eq(ev.ok, null);
        ok(ev.detail.length > 10);
    });

    test('gatherAll covers the herd', () => {
        const all = E.gatherAll(H.DEFAULT, feeds);
        eq(Object.keys(all).length, H.DEFAULT.length);
    });
}
