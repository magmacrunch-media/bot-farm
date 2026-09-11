import { test, eq, ok } from './kit/assert.mjs';

const H = 3600 * 1000;
const NOW = Date.parse('2026-09-10T12:00:00Z');

export default function (M) {
    const C = M.health;
    const ev = (over) => Object.assign({ found: true, enabled: true, ok: true, at: NOW - H, running: false, detail: 'fine', url: null }, over);
    const bot = (over) => Object.assign({ id: 'b', name: 'B', cadence: 'daily', source: { kind: 'workflow' } }, over);

    test('grazing when all is well', () => {
        const v = C.classify(bot({ stale: 48 }), ev(), NOW);
        eq(v.state, 'grazing');
        eq(v.tone, 'good');
        eq(v.when, '1h ago');
        eq(v.line, 'fine · 1h ago');
    });

    test('hungry when past its stale window', () => {
        const v = C.classify(bot({ stale: 24, cadence: 'Mon 06:00 UTC' }), ev({ at: NOW - 3 * 24 * H }), NOW);
        eq(v.state, 'hungry');
        eq(v.line, 'overdue — expected Mon 06:00 UTC · 3d ago', 'names what was expected, and the age once');
    });

    test('hungry when it has a schedule and no time at all', () => {
        eq(C.classify(bot({ stale: 24 }), ev({ at: null }), NOW).state, 'hungry');
    });

    test('no stale window means never hungry', () => {
        eq(C.classify(bot(), ev({ at: NOW - 400 * 24 * H }), NOW).state, 'grazing');
    });

    test('sick beats hungry', () => {
        const v = C.classify(bot({ stale: 1 }), ev({ ok: false, at: NOW - 100 * H, detail: 'failure by push' }), NOW);
        eq(v.state, 'sick');
        eq(v.detail, 'failure by push');
    });

    test('working beats sick and hungry', () => {
        eq(C.classify(bot({ stale: 1 }), ev({ running: true, ok: false, at: NOW - 100 * H }), NOW).state, 'working');
    });

    test('asleep when disabled, and dormant beats everything', () => {
        const v = C.classify(bot(), ev({ enabled: false, ok: false, detail: 'last run exited 1, disabled' }), NOW);
        eq(v.state, 'asleep');
        ok(v.detail.startsWith('penned'), v.detail);
        eq(C.classify(bot({ dormant: true }), ev({ ok: false, found: false }), NOW).state, 'asleep');
        eq(C.classify(bot({ dormant: true }), undefined, NOW).detail, 'napping on purpose');
    });

    test('strayed when the feed loaded and the bot is not in it', () => {
        const v = C.classify(bot(), ev({ found: false, detail: 'no scheduled task X' }), NOW);
        eq(v.state, 'strayed');
        eq(v.tone, 'bad');
    });

    test('unknown when there is nothing to go on — never grazing', () => {
        eq(C.classify(bot(), undefined, NOW).state, 'unknown');
        eq(C.classify(bot(), ev({ found: null, detail: 'runs not loaded' }), NOW).detail, 'runs not loaded');
        const silent = C.classify(bot({ source: { kind: 'none', why: 'leaves no trace' } }), ev({ detail: 'leaves no trace' }), NOW);
        eq(silent.state, 'unknown');
        eq(silent.detail, 'leaves no trace');
    });

    test('long-running: alive is the question', () => {
        const task = { kind: 'task', task: 'X' };
        eq(C.classify(bot({ longRunning: true, source: task }), ev({ running: true }), NOW).state, 'working');
        // A task that last succeeded and is not running has STOPPED.
        const down = C.classify(bot({ longRunning: true, source: task }), ev({ running: false, ok: true, detail: 'last run succeeded' }), NOW);
        eq(down.state, 'sick');
        eq(down.detail, 'last run succeeded');
        // A probe or a runner is alive when it answered.
        eq(C.classify(bot({ longRunning: true, source: { kind: 'probe', probe: 'p' } }), ev({ ok: true, detail: '8 models' }), NOW).state, 'grazing');
        eq(C.classify(bot({ longRunning: true, source: { kind: 'probe', probe: 'p' } }), ev({ ok: false }), NOW).state, 'sick');
        eq(C.classify(bot({ longRunning: true, source: { kind: 'runner' } }), ev({ ok: true, running: false }), NOW).state, 'grazing');
        eq(C.classify(bot({ longRunning: true, source: { kind: 'runner' } }), ev({ ok: true, running: true }), NOW).state, 'working');
        eq(C.classify(bot({ longRunning: true, source: { kind: 'runner' } }), ev({ ok: false, detail: 'offline' }), NOW).state, 'sick');
    });

    test('ago rounds the way a farmer talks', () => {
        eq(C.ago(NOW - 20 * 1000, NOW), 'just now');
        eq(C.ago(NOW - 5 * 60 * 1000, NOW), '5m ago');
        eq(C.ago(NOW - 90 * 60 * 1000, NOW), '2h ago');
        eq(C.ago(NOW - 47 * H, NOW), '47h ago');
        eq(C.ago(NOW - 49 * H, NOW), '2d ago');
        eq(C.ago(null, NOW), null);
        eq(C.ago(NOW + H, NOW), 'just now', 'a clock skew is not the future');
    });

    test('tally and report', () => {
        const verdicts = {
            a: { state: 'grazing' }, b: { state: 'grazing' }, c: { state: 'hungry' }, d: { state: 'asleep' },
        };
        const t = C.tally(verdicts);
        eq(t.total, 4);
        eq(t.grazing, 2);
        eq(t.sick, 0);
        eq(C.report(t), '2 grazing · 1 hungry · 1 asleep');
        eq(C.report(C.tally({})), 'nobody home');
    });

    test('classifyAll keys by id', () => {
        const herd = [bot({ id: 'x' }), bot({ id: 'y', dormant: true })];
        const all = C.classifyAll(herd, { x: ev() }, NOW);
        eq(all.x.state, 'grazing');
        eq(all.y.state, 'asleep');
    });
}
