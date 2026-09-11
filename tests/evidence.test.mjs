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
    };
    const bot = (id) => H.DEFAULT.find((b) => b.id === id);

    test('every fixture the default herd needs is present', () => {
        for (const b of H.DEFAULT) {
            const s = b.source;
            if (s.kind === 'workflow') ok(E.runKey(s) in feeds.runs, `runs fixture has ${E.runKey(s)}`);
            if (s.kind === 'commit') ok(E.commitKey(s) in feeds.commits, `commits fixture has ${E.commitKey(s)}`);
            if (s.kind === 'probe') ok(s.probe in feeds.probes, `probes fixture has ${s.probe}`);
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

    test('the historian is running and the dolphins are idle', () => {
        eq(E.gather(bot('historian'), feeds).running, true);
        const cat = E.gather(bot('dolphin-run'), feeds);
        eq(cat.found, true);
        eq(cat.running, false);
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
        for (const id of ['bot-status', 'pi-tmdb', 'historian', 'ollama', 'runner-linux']) {
            const ev = E.gather(bot(id), {});
            eq(ev.found, null, `${id} with no feeds`);
            ok(/not (loaded|made)/.test(ev.detail), ev.detail);
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
