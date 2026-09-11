// core/health.js — evidence in, a farm state out.
//
// Seven states, and the order they are tested in is the order they matter:
//
//   asleep    penned on purpose (dormant) or disabled at the source
//   unknown   nothing to go on — the feed is not loaded, or the bot leaves
//             no trace. Never dressed up as healthy: the website's own
//             report once printed "active" for eight Pi bots through a
//             two-week outage, and this is the state that stops that.
//   strayed   the feed loaded and the bot is not in it
//   working   doing something right now
//   sick      the last thing it did failed, or a long-running one is down
//   hungry    nothing from it inside its `stale` window
//   grazing   fine
//
// Pure: takes `now` so the tests can set the clock.

(function () {
    'use strict';

    const App = (window.BotFarm = window.BotFarm || {});

    const STATES = {
        grazing: { label: 'GRAZING', tone: 'good', word: 'grazing' },
        working: { label: 'WORKING', tone: 'good', word: 'working' },
        hungry: { label: 'HUNGRY', tone: 'warn', word: 'hungry' },
        sick: { label: 'SICK', tone: 'bad', word: 'sick' },
        asleep: { label: 'ASLEEP', tone: 'quiet', word: 'asleep' },
        strayed: { label: 'STRAYED', tone: 'bad', word: 'strayed' },
        unknown: { label: 'UNKNOWN', tone: 'quiet', word: 'unaccounted for' },
    };

    const HOUR = 3600 * 1000;

    /** "3d ago", "2h ago", "just now"; null when there is no time. */
    function ago(at, now) {
        if (!at) return null;
        const d = Math.max(0, now - at);
        const m = Math.round(d / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.round(d / HOUR);
        if (h < 48) return `${h}h ago`;
        return `${Math.round(d / (24 * HOUR))}d ago`;
    }

    function verdict(state, detail, ev, now) {
        const when = ev && ago(ev.at, now);
        return {
            state,
            label: STATES[state].label,
            tone: STATES[state].tone,
            detail,
            when,
            line: when ? `${detail} · ${when}` : detail,
        };
    }

    function classify(bot, ev, now) {
        if (bot.dormant) return verdict('asleep', 'napping on purpose', ev, now);
        if (!ev || ev.found === null) return verdict('unknown', (ev && ev.detail) || 'not checked yet', ev, now);
        if (bot.source && bot.source.kind === 'none') return verdict('unknown', ev.detail, ev, now);
        if (ev.found === false) return verdict('strayed', ev.detail, ev, now);
        if (ev.enabled === false) return verdict('asleep', 'penned — ' + ev.detail, ev, now);
        if (ev.running) return verdict('working', ev.detail, ev, now);
        if (ev.ok === false) return verdict('sick', ev.detail, ev, now);
        if (bot.longRunning) {
            // Alive is the whole question for these. A task is alive only when
            // it is running (handled above — a task that "last succeeded" and
            // is not running has stopped); a probe or a runner is alive when
            // it answered.
            const alive = ev.ok === true && (bot.source || {}).kind !== 'task';
            return alive
                ? verdict('grazing', ev.detail || 'alive', ev, now)
                : verdict('sick', ev.detail || 'not running', ev, now);
        }
        if (bot.stale && ev.at && now - ev.at > bot.stale * HOUR) {
            return verdict('hungry', `overdue — expected ${bot.cadence}`, ev, now);
        }
        if (bot.stale && !ev.at) return verdict('hungry', ev.detail || 'never fed', ev, now);
        return verdict('grazing', ev.detail || 'all well', ev, now);
    }

    /** Verdicts for a whole herd, keyed by bot id. */
    function classifyAll(herd, evidence, now) {
        const out = {};
        for (const b of herd) out[b.id] = classify(b, evidence[b.id], now);
        return out;
    }

    /** { grazing: n, hungry: n, ... } with every state present, plus `total`. */
    function tally(verdicts) {
        const t = { total: 0 };
        for (const s of Object.keys(STATES)) t[s] = 0;
        for (const v of Object.values(verdicts)) { t[v.state]++; t.total++; }
        return t;
    }

    /** One line for the footer: "12 grazing · 2 hungry · 1 sick". Zeros are
     *  left out, except that an empty farm says so. */
    function report(t) {
        const parts = Object.keys(STATES).filter((s) => t[s]).map((s) => `${t[s]} ${STATES[s].word}`);
        return parts.length ? parts.join(' · ') : 'nobody home';
    }

    App.health = { STATES, classify, classifyAll, tally, report, ago };
}());
