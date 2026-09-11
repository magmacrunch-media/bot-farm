// core/evidence.js — raw feeds in, one evidence record per bot out.
//
// The feeds are whatever the desktop side (or the fixtures, in a browser)
// handed over, keyed so a bot can find its own row without searching:
//
//   feeds.runs       { "<repo>/<file>": latestRun | null }
//   feeds.workflows  { "<repo>": [{ name, path, state, html_url }] }
//   feeds.commits    { "<repo>|<subject>": latestCommit | null }
//   feeds.tasks      [{ name, state, enabled, lastRun, lastResult, nextRun }]
//   feeds.runners    { "<repo>": [{ name, status, busy }] }
//   feeds.probes     { "<probe>": { ok, at, detail } }
//
// A feed that is missing entirely (the call failed, or has not been made yet)
// is `undefined`, and the evidence says so — `found: null` — rather than
// pretending the bot has strayed. Absence of a feed is ignorance; absence of
// a row inside a feed that did load is evidence.
//
// The evidence record every source kind produces:
//
//   { found, enabled, ok, at, running, detail, url }
//
//   found    true / false / null (feed not loaded)
//   enabled  true / false / null (the source has no such notion)
//   ok       true / false / null — did the last thing it did succeed
//   at       epoch ms of the last evidence, or null
//   running  true when it is doing something right now
//   detail   one short human line
//   url      somewhere to go and look, or null

(function () {
    'use strict';

    const App = (window.BotFarm = window.BotFarm || {});

    function ms(iso) {
        if (!iso) return null;
        const t = Date.parse(iso);
        return Number.isFinite(t) ? t : null;
    }

    function runKey(src) { return `${src.repo}/${src.file}`; }
    function commitKey(src) { return `${src.repo}|${src.subject}`; }

    function blank(over) {
        return Object.assign(
            { found: null, enabled: null, ok: null, at: null, running: false, detail: '', url: null },
            over,
        );
    }

    /* Each function gets (source, feeds) and returns an evidence record. */
    const BY_KIND = {
        workflow(src, feeds) {
            const runs = feeds.runs;
            if (!runs) return blank({ detail: 'runs not loaded' });
            const key = runKey(src);
            if (!(key in runs)) return blank({ detail: 'runs not loaded' });
            const run = runs[key];
            const wf = (feeds.workflows && feeds.workflows[src.repo] || [])
                .find((w) => w.path && w.path.endsWith('/' + src.file));
            const enabled = wf ? wf.state === 'active' : null;
            const url = run ? run.html_url : (wf ? wf.html_url : null);
            if (!run) {
                // A workflow that exists but has never run is not a stray.
                return blank({ found: !!wf, enabled, url, detail: wf ? 'never run' : 'no such workflow' });
            }
            const running = run.status === 'in_progress' || run.status === 'queued' || run.status === 'waiting';
            const ok = running ? null : run.conclusion === 'success';
            const via = run.event === 'schedule' ? 'on schedule' : `by ${run.event}`;
            const detail = running
                ? `running now (${run.status})`
                : `${run.conclusion || run.status} ${via}${run.run_attempt > 1 ? `, attempt ${run.run_attempt}` : ''}`;
            return blank({ found: true, enabled, ok, at: ms(run.updated_at || run.run_started_at), running, detail, url });
        },

        commit(src, feeds) {
            const commits = feeds.commits;
            if (!commits) return blank({ detail: 'commits not loaded' });
            const key = commitKey(src);
            if (!(key in commits)) return blank({ detail: 'commits not loaded' });
            const c = commits[key];
            if (!c) return blank({ found: false, detail: `no commit "${src.subject}" found` });
            return blank({
                found: true, ok: true, at: ms(c.date), url: c.html_url || null,
                detail: `committed ${c.sha}${c.author ? ` as ${c.author}` : ''}`,
            });
        },

        task(src, feeds) {
            const tasks = feeds.tasks;
            if (!Array.isArray(tasks)) return blank({ detail: 'tasks not loaded' });
            const t = tasks.find((x) => x.name === src.task);
            if (!t) return blank({ found: false, detail: `no scheduled task ${src.task}` });
            return taskEvidence(t);
        },

        runner(src, feeds) {
            const list = feeds.runners && feeds.runners[src.repo];
            if (!Array.isArray(list)) return blank({ detail: 'runners not loaded' });
            const r = list.find((x) => x.name === src.name);
            if (!r) return blank({ found: false, detail: `no runner ${src.name} on ${src.repo}` });
            const online = r.status === 'online';
            return blank({
                found: true, ok: online, running: online && !!r.busy,
                detail: online ? (r.busy ? 'online, working' : 'online, idle') : `offline`,
                url: `https://github.com/${src.repo}/settings/actions/runners`,
            });
        },

        probe(src, feeds) {
            const probes = feeds.probes;
            if (!probes) return blank({ detail: 'probe not made' });
            if (!(src.probe in probes)) return blank({ detail: 'probe not made' });
            const p = probes[src.probe];
            // A probe may ride on a task (Ollama: the server is what is probed,
            // the task is what would restart it). The task lends `enabled`.
            let enabled = null;
            if (src.task && Array.isArray(feeds.tasks)) {
                const t = feeds.tasks.find((x) => x.name === src.task);
                if (t) enabled = !!t.enabled;
            }
            return blank({
                found: true, enabled, ok: !!p.ok, at: p.at || null,
                detail: p.detail || (p.ok ? 'reachable' : 'unreachable'),
            });
        },

        none(src) {
            return blank({ found: true, detail: src.why || 'leaves no trace' });
        },
    };

    /** A Windows scheduled task row -> evidence. Exported for the tests. */
    function taskEvidence(t) {
        const running = t.state === 'Running';
        const enabled = !!t.enabled;
        // LastTaskResult: 0 is success; 267009 (0x41301) is "currently
        // running", which is not a failure; 267011 (0x41303) "has not run".
        const code = Number(t.lastResult);
        const never = code === 267011 || !t.lastRun;
        const ok = never ? null : (code === 0 || code === 267009);
        let detail;
        if (running) detail = 'running now';
        else if (never) detail = 'has not run';
        else if (ok) detail = 'last run succeeded';
        else detail = `last run exited ${hex(code)}`;
        if (!enabled) detail += ', disabled';
        return blank({ found: true, enabled, ok, at: ms(t.lastRun), running, detail });
    }

    function hex(code) {
        if (!Number.isFinite(code)) return String(code);
        return code < 256 ? String(code) : '0x' + (code >>> 0).toString(16).toUpperCase();
    }

    function gather(bot, feeds) {
        const src = bot.source || { kind: 'none' };
        const fn = BY_KIND[src.kind] || BY_KIND.none;
        return fn(src, feeds || {});
    }

    /** Evidence for a whole herd, keyed by bot id. */
    function gatherAll(herd, feeds) {
        const out = {};
        for (const b of herd) out[b.id] = gather(b, feeds);
        return out;
    }

    App.evidence = { gather, gatherAll, taskEvidence, runKey, commitKey };
}());
