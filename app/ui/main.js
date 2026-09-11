// main.js — page wiring. Last in the load order; everything is attached.
//
// The loop is: herd -> feeds -> evidence -> verdicts -> draw. core/ owns the
// middle three and is tested in Node; this file owns the DOM, the timer and
// the chores (feed, pen, visit), which are the only things that reach back
// out through the bridge.

(function () {
    'use strict';

    const App = window.BotFarm;
    const { el } = window.MagmaKit.dom;

    const POLL_MS = 5 * 60 * 1000;
    const HERD_FILE = 'herd.json';

    let herd = App.herd.DEFAULT;
    let last = null;          // { feeds, errors, source } from the latest walk
    let dropped = [];         // herd.json records that were not bots
    let walking = false;
    let timer = null;

    const $ = (id) => document.getElementById(id);

    /* ── the herd ──────────────────────────────────────────── */

    /** DEFAULT plus this machine's herd.json, if there is one. */
    async function loadHerd() {
        if (!App.fs) return;
        try {
            const dir = await App.fs.configDir();
            const path = `${dir}/${HERD_FILE}`;
            if (!(await App.fs.exists(path))) return;
            const extras = JSON.parse(await App.fs.readText(path));
            const m = App.herd.merge(extras);
            herd = m.herd;
            dropped = m.dropped;
            if (dropped.length) App.fs.logLine('herd', `${dropped.length} record(s) in ${HERD_FILE} dropped`, JSON.stringify(dropped));
        } catch (e) {
            dropped = [{ record: HERD_FILE, problems: [String(e && e.message || e)] }];
        }
    }

    /* ── walking the farm ──────────────────────────────────── */

    async function walk() {
        if (walking) return;
        walking = true;
        $('check-on').disabled = true;
        try {
            last = await App.feeds.fetch(herd);
        } catch (e) {
            last = { feeds: {}, errors: { walk: String(e && e.message || e) }, source: App.farm ? 'live' : 'fixtures' };
        } finally {
            walking = false;
            $('check-on').disabled = false;
        }
        draw();
    }

    function schedule() {
        if (timer) clearInterval(timer);
        timer = setInterval(walk, POLL_MS);
    }

    /* ── drawing ───────────────────────────────────────────── */

    function clock(ms) {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    /** Which sky to paint: the farm keeps the local clock. */
    function timeOfDay(h) {
        if (h < 5 || h >= 21) return 'night';
        if (h < 7) return 'dawn';
        if (h < 19) return 'day';
        return 'dusk';
    }

    function draw() {
        const now = Date.now();
        const feeds = last ? last.feeds : {};
        const evidence = App.evidence.gatherAll(herd, feeds);
        const verdicts = App.health.classifyAll(herd, evidence, now);

        const farm = $('farm');
        farm.querySelectorAll('.field').forEach((n) => n.remove());
        $('sky').className = `sky t-${timeOfDay(new Date(now).getHours())}`;

        let index = 0;
        for (const { field, bots } of App.herd.byField(herd)) {
            if (!bots.length) continue;
            const sec = el('section', `field field-${field.id}`);
            const head = el('div', 'field-head');
            head.append(
                el('span', 'field-name', field.name),
                el('span', 'field-tag', field.tag),
                el('span', 'field-blurb', field.blurb),
            );
            const own = {};
            for (const b of bots) own[b.id] = verdicts[b.id];
            head.append(el('span', 'field-tally', App.health.report(App.health.tally(own))));
            sec.append(head);

            const pens = el('div', 'pens');
            for (const b of bots) pens.append(pen(b, evidence[b.id], verdicts[b.id], index++));
            sec.append(pens);
            farm.append(sec);
        }

        const report = App.health.report(App.health.tally(verdicts));
        $('report').textContent = report;
        // Every walk goes to the log file, so a launch can be checked from
        // disk: the report line, and which feeds could not be read.
        if (last && App.fs) {
            const errs = Object.keys(last.errors || {});
            App.fs.logLine('walk', report, errs.length ? JSON.stringify(last.errors) : null);
        }
        $('rounds').textContent = last ? `LAST ROUNDS ${clock(now)}` : 'LAST ROUNDS —';
        $('source-chip').textContent = last ? (last.source === 'live' ? 'LIVE' : 'FIXTURES') : '…';
        trouble(last ? last.errors : {});
    }

    function pen(bot, ev, v, index) {
        const card = el('article', `pen tone-${v.tone}`);
        card.dataset.id = bot.id;

        // The pen is a fenced patch of the field's ground: the animal stands
        // in its stall on the left, and a chalkboard nailed to the fence says
        // what it is up to.
        const species = App.herd.SPECIES[bot.species];
        const stall = el('div', `stall ${v.state}`);
        const sprite = el('div', `sprite ${v.state}`, species.sprite);
        sprite.title = `${species.name} — ${v.label.toLowerCase()}`;
        // Grazing animals dip their heads now and then; stagger them so the
        // whole field does not nod in unison.
        sprite.style.animationDelay = `${-((index * 2.3) % 9).toFixed(1)}s`;
        stall.append(sprite);

        const name = el('div', 'name', bot.name);
        name.append(el('span', `state ${v.tone}`, v.label));

        const line = el('div', 'line', v.line);
        const does = el('div', 'does', `${bot.does} · ${bot.cadence}`);

        const chores = el('div', 'chores');
        if (App.farm && bot.feed && !bot.dormant) {
            const b = el('button', 'btn', 'FEED');
            b.title = 'Run it now';
            b.onclick = () => feed(bot);
            chores.append(b);
        }
        const gate = handle(bot);
        if (App.farm && gate && ev && ev.enabled !== null) {
            const penning = ev.enabled;
            const b = el('button', 'btn' + (penning ? ' danger' : ''), penning ? 'PEN' : 'LET OUT');
            b.title = penning ? 'Disable it' : 'Enable it';
            b.onclick = () => pen_(bot, gate, penning);
            chores.append(b);
        }
        const url = (ev && ev.url) || placeToLook(bot);
        if (url) {
            const b = el('button', 'btn', 'VISIT');
            b.title = url;
            b.onclick = () => visit(url);
            chores.append(b);
        }

        const board = el('div', 'board');
        board.append(name, line, does, chores);
        card.append(stall, board);
        return card;
    }

    /** The switch that pens a bot: its own source when that is a workflow
     *  or a task. NOT its feed — the Pi bots are fed through a GitHub
     *  workflow, but disabling that workflow would not touch the Pi's cron. */
    function handle(bot) {
        const s = bot.source || {};
        if (s.kind === 'workflow') return { kind: 'workflow', repo: s.repo, file: s.file };
        if (s.kind === 'task') return { kind: 'task', task: s.task };
        if (s.kind === 'probe' && s.task) return { kind: 'task', task: s.task };
        return null;
    }

    function placeToLook(bot) {
        const s = bot.source || {};
        if (s.kind === 'workflow') return `https://github.com/${s.repo}/actions/workflows/${s.file}`;
        if (s.kind === 'commit') return `https://github.com/${s.repo}/commits/main`;
        const f = bot.feed;
        if (f && f.kind === 'workflow') return `https://github.com/${f.repo}/actions/workflows/${f.file}`;
        return null;
    }

    function trouble(errors) {
        const box = $('trouble');
        box.replaceChildren();
        const rows = Object.entries(errors || {}).map(([k, m]) => `${k}: ${m}`);
        for (const d of dropped) rows.push(`${HERD_FILE}: ${JSON.stringify(d.record && d.record.id || d.record)} — ${d.problems.join('; ')}`);
        for (const r of rows) box.append(el('div', null, r));
        box.hidden = rows.length === 0;
    }

    /* ── chores ────────────────────────────────────────────── */

    async function feed(bot) {
        const f = bot.feed;
        const what = f.kind === 'workflow' ? `${f.file} on ${f.repo}` : `the scheduled task ${f.task}`;
        if (!(await App.farm.confirm(`Feed ${bot.name}?\n\nThis runs ${what} now.`))) return;
        try {
            if (f.kind === 'workflow') await App.farm.ghWorkflow('run', f.repo, f.file);
            else await App.farm.taskAction('start', f.task);
            window.Toast.show(`${bot.name} fed`);
            App.fs.logLine('chore', `fed ${bot.id}`);
            setTimeout(walk, 4000);
        } catch (e) {
            window.Toast.show(`could not feed ${bot.name}: ${e}`);
            App.fs.logLine('chore', `feed ${bot.id} failed`, e);
        }
    }

    async function pen_(bot, gate, penning) {
        const verb = penning ? 'Pen' : 'Let out';
        const what = gate.kind === 'workflow' ? `${penning ? 'disables' : 'enables'} ${gate.file} on ${gate.repo}` : `${penning ? 'disables' : 'enables'} the scheduled task ${gate.task}`;
        if (!(await App.farm.confirm(`${verb} ${bot.name}?\n\nThis ${what}.`))) return;
        const action = penning ? 'disable' : 'enable';
        try {
            if (gate.kind === 'workflow') await App.farm.ghWorkflow(action, gate.repo, gate.file);
            else await App.farm.taskAction(action, gate.task);
            window.Toast.show(`${bot.name} ${penning ? 'penned' : 'let out'}`);
            App.fs.logLine('chore', `${action} ${bot.id}`);
            setTimeout(walk, 1500);
        } catch (e) {
            window.Toast.show(`could not ${verb.toLowerCase()} ${bot.name}: ${e}`);
            App.fs.logLine('chore', `${action} ${bot.id} failed`, e);
        }
    }

    function visit(url) {
        if (App.farm) App.farm.openUrl(url).catch((e) => window.Toast.show(String(e)));
        else window.open(url, '_blank', 'noopener');
    }

    /* ── boot ──────────────────────────────────────────────── */

    $('check-on').onclick = walk;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) walk();
    });

    const slot = $('app-version');
    if (App.fs) App.fs.appVersion().then((v) => { slot.textContent = `v${v}`; }).catch(() => {});
    else slot.textContent = 'web';

    draw();
    loadHerd().then(() => { walk(); schedule(); });
}());
