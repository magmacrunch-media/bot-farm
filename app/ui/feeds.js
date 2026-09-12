// ui/feeds.js — where the raw feeds come from.
//
// Two sources, one shape (see core/evidence.js for the shape):
//
//   desktop  BotFarm.farm — gh, PowerShell and HTTP probes on the Rust side
//   browser  app/fixtures/*.json — the same shape, captured from real data,
//            so `npm run serve` shows a populated farm and the tests read
//            the same files
//
// Every feed is fetched independently and a failure leaves that feed
// `undefined` (with the error kept in `errors`), so one dead source — the
// Pi off the tailnet, gh not signed in — dims its own field and nothing else.

(function () {
    'use strict';

    const App = (window.BotFarm = window.BotFarm || {});

    /** The distinct calls a herd needs, so nothing is fetched twice. */
    function wants(herd) {
        const runs = new Set();
        const repos = new Set();
        const commits = [];
        const seenCommit = new Set();
        const runnerRepos = new Set();
        const probes = new Set();
        const journals = new Set();
        const webhooks = new Set();
        let tasks = false;
        for (const b of herd) {
            const s = b.source || {};
            if (s.kind === 'workflow') { runs.add(App.evidence.runKey(s)); repos.add(s.repo); }
            if (s.kind === 'commit') {
                const k = App.evidence.commitKey(s);
                if (!seenCommit.has(k)) { seenCommit.add(k); commits.push(s); }
            }
            if (s.kind === 'task' || ((s.kind === 'probe' || s.kind === 'journal') && s.task)) tasks = true;
            if (s.kind === 'runner') runnerRepos.add(s.repo);
            if (s.kind === 'probe') probes.add(s.probe);
            if (s.kind === 'journal') journals.add(s.journal);
            if (s.kind === 'webhook') webhooks.add(s.webhook);
            if (b.feed && b.feed.kind === 'workflow') repos.add(b.feed.repo);
            if (b.feed && b.feed.kind === 'task') tasks = true;
        }
        return {
            runs: [...runs], repos: [...repos], commits, tasks,
            runnerRepos: [...runnerRepos], probes: [...probes],
            journals: [...journals], webhooks: [...webhooks],
        };
    }

    function settle(p, onError) {
        return p.catch((e) => { onError(String(e && e.message || e)); return undefined; });
    }

    /* ── desktop ───────────────────────────────────────────── */

    async function live(herd) {
        const F = App.farm;
        const w = wants(herd);
        const errors = {};
        const fail = (key) => (msg) => { errors[key] = msg; };

        const runs = {};
        const workflows = {};
        const commits = {};
        const runners = {};
        const probes = {};
        const journals = {};
        const webhooks = {};

        const jobs = [];

        for (const key of w.runs) {
            const i = key.lastIndexOf('/');
            const repo = key.slice(0, i);
            const file = key.slice(i + 1);
            jobs.push(settle(
                F.ghApi(`repos/${repo}/actions/workflows/${file}/runs?per_page=1`)
                    .then((r) => { runs[key] = (r && r.workflow_runs && r.workflow_runs[0]) || null; }),
                fail('runs:' + key),
            ));
        }
        for (const repo of w.repos) {
            jobs.push(settle(
                F.ghApi(`repos/${repo}/actions/workflows?per_page=100`)
                    .then((r) => { workflows[repo] = (r && r.workflows) || []; }),
                fail('workflows:' + repo),
            ));
        }
        for (const s of w.commits) {
            // The search index is the only GitHub API that finds a commit by
            // its subject without paging a busy repo's whole history. It
            // matches anywhere in the message, so the subject is re-checked.
            const q = encodeURIComponent(`repo:${s.repo} "${s.subject}"`);
            jobs.push(settle(
                F.ghApi(`search/commits?q=${q}&sort=author-date&order=desc&per_page=5`)
                    .then((r) => {
                        const hit = ((r && r.items) || []).map(commitRow)
                            .find((c) => c.subject.startsWith(s.subject));
                        commits[App.evidence.commitKey(s)] = hit || null;
                    }),
                fail('commits:' + s.subject),
            ));
        }
        for (const repo of w.runnerRepos) {
            jobs.push(settle(
                F.ghApi(`repos/${repo}/actions/runners`)
                    .then((r) => { runners[repo] = (r && r.runners) || []; }),
                fail('runners:' + repo),
            ));
        }
        for (const name of w.probes) {
            jobs.push(settle(F.probe(name).then((p) => { probes[name] = p; }), fail('probe:' + name)));
        }
        for (const name of w.journals) {
            jobs.push(settle(F.journal(name).then((j) => { journals[name] = j; }), fail('journal:' + name)));
        }
        for (const name of w.webhooks) {
            jobs.push(settle(F.webhook(name).then((h) => { webhooks[name] = h; }), fail('webhook:' + name)));
        }
        let tasks;
        if (w.tasks) jobs.push(settle(F.tasksList().then((t) => { tasks = t; }), fail('tasks')));

        await Promise.all(jobs);
        return {
            feeds: { runs, workflows, commits, tasks, runners, probes, journals, webhooks },
            errors, source: 'live',
        };
    }

    function commitRow(item) {
        const c = item.commit || {};
        return {
            sha: String(item.sha || '').slice(0, 7),
            date: c.author && c.author.date,
            author: c.author && c.author.name,
            subject: String(c.message || '').split('\n')[0],
            html_url: item.html_url,
        };
    }

    /* ── browser ───────────────────────────────────────────── */

    async function fixtures() {
        const errors = {};
        const get = async (name) => {
            try {
                const r = await fetch(`../fixtures/${name}.json`);
                if (!r.ok) throw new Error(`${r.status}`);
                return await r.json();
            } catch (e) { errors[name] = String(e && e.message || e); return undefined; }
        };
        const names = ['runs', 'workflows', 'commits', 'tasks', 'runners', 'probes', 'journals', 'webhooks'];
        const [runs, workflows, commits, tasks, runners, probes, journals, webhooks] =
            await Promise.all(names.map(get));
        return {
            feeds: { runs, workflows, commits, tasks, runners, probes, journals, webhooks },
            errors, source: 'fixtures',
        };
    }

    App.feeds = { wants, fetch: (herd) => (App.farm ? live(herd) : fixtures()) };
}());
