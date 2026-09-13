// The MCP server: the assembly, the protocol, and the two promises it makes —
// that it is read-only, and that it will not serve the tailnet unguarded.
//
// Everything here runs without a built farm-cli and without a network: the
// assembly is checked against app/fixtures/, the protocol against a stub
// reading. What is NOT checked here is farm.rs — it has cargo tests, and the
// whole point of the shim is that there is one copy of those rules to test.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, eq, ok } from './kit/assert.mjs';
import { assemble, loadApp, cliFarm } from '../mcp/walk.mjs';
import { handle, callTool, parseArgs, checkBind } from '../mcp/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const fixture = (n) => JSON.parse(read(join('app', 'fixtures', `${n}.json`)));

const FEED_NAMES = ['runs', 'workflows', 'commits', 'tasks', 'runners', 'probes', 'journals', 'webhooks'];
const fixtureFeeds = () => Object.fromEntries(FEED_NAMES.map((n) => [n, fixture(n)]));

/** `loadApp` wants something in the bridge's place; assembly never calls it. */
const NO_FARM = {};

export default function run() {
    /* ── the assembly ──────────────────────────────────────── */

    test('assembles the fixture feeds into one verdict per bot', () => {
        const App = loadApp(NO_FARM);
        const herd = App.herd.DEFAULT;
        const r = assemble(App, herd, fixtureFeeds(), {}, Date.parse('2026-09-11T12:00:00Z'));

        eq(r.bots.length, herd.length, 'every bot in the herd is reported');
        eq(r.tally.total, herd.length, 'the tally counts them all');
        const states = Object.keys(App.health.STATES);
        for (const b of r.bots) {
            ok(states.includes(b.state), `${b.id} has a real state, not ${b.state}`);
            ok(b.label && b.detail !== undefined, `${b.id} carries a label and a reading`);
        }
        ok(/\d+ grazing/.test(r.report), `report reads like a report: ${r.report}`);
    });

    test('the fields come through in the order the farm draws them', () => {
        const App = loadApp(NO_FARM);
        const r = assemble(App, App.herd.DEFAULT, fixtureFeeds());
        eq(r.fields.map((f) => f.id), ['pasture', 'coop', 'barn', 'stable', 'dovecote']);
    });

    // The website's weekly report printed "active" for eight Pi bots through a
    // two-week outage. A feed that does not load must not be able to do that
    // here, whatever else changes.
    test('a feed that did not load leaves its bots unknown, never grazing', () => {
        const App = loadApp(NO_FARM);
        const feeds = fixtureFeeds();
        delete feeds.runs;
        delete feeds.workflows;
        const r = assemble(App, App.herd.DEFAULT, feeds, { errors: { runs: 'gh not signed in' } });
        const pasture = r.bots.filter((b) => b.field === 'pasture');
        ok(pasture.length > 0, 'there are pasture bots to be wrong about');
        for (const b of pasture) ok(b.state === 'unknown', `${b.id} reads ${b.state}, not unknown`);
    });

    /* ── read-only ─────────────────────────────────────────── */

    test('the MCP path exposes no way to run anything', () => {
        const farm = cliFarm('farm-cli');
        eq(Object.keys(farm).sort(), ['configDir', 'ghApi', 'journal', 'probe', 'tasksList', 'webhook']);
    });

    // farm.rs keeps gh_workflow, task_action and open_url a module away from
    // the shim. Naming one here would hand a chore to a client that cannot
    // confirm it, so the guard is on the source rather than on a convention.
    test('farm-cli reaches none of the write verbs', () => {
        const src = read(join('desktop', 'src-tauri', 'src', 'bin', 'farm-cli.rs'));
        const body = src.slice(src.indexOf('fn dispatch'));
        for (const verb of ['gh_workflow', 'task_action', 'open_url']) {
            ok(!body.includes(verb), `farm-cli dispatch names ${verb}`);
        }
    });

    test('both tools declare themselves read-only', async () => {
        const res = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { version: '0' });
        eq(res.result.tools.map((t) => t.name).sort(), ['farm_bot', 'farm_status']);
        for (const t of res.result.tools) {
            ok(t.annotations.readOnlyHint === true, `${t.name} is annotated read-only`);
            ok(t.inputSchema.additionalProperties === false, `${t.name} takes no stray arguments`);
        }
    });

    /* ── the protocol ──────────────────────────────────────── */

    const ctx = (reading) => ({ version: '9.9.9', reading });

    test('initialize answers, and meets the client on its own version', async () => {
        const ask = (protocolVersion) => handle(
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion } }, ctx(null),
        );
        eq((await ask('2024-11-05')).result.protocolVersion, '2024-11-05', 'an older client is answered in its own version');
        eq((await ask('1999-01-01')).result.protocolVersion, '2025-06-18', 'an unknown one gets ours');
        eq((await ask('2025-06-18')).result.serverInfo.version, '9.9.9', 'the version comes from Cargo.toml');
    });

    test('notifications get no answer and unknown methods do', async () => {
        eq(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx(null)), null);
        const res = await handle({ jsonrpc: '2.0', id: 4, method: 'nonsense' }, ctx(null));
        eq(res.error.code, -32601);
        const bad = await handle({ id: 5, method: 'tools/list' }, ctx(null));
        eq(bad.error.code, -32600, 'a message that is not JSON-RPC 2.0 is refused');
    });

    /* ── the tools ─────────────────────────────────────────── */

    const stubWalk = () => {
        const App = loadApp(NO_FARM);
        const r = assemble(App, App.herd.DEFAULT, fixtureFeeds());
        return async () => r;
    };

    test('farm_status renders every field and filters on request', async () => {
        const reading = stubWalk();
        const all = await callTool(reading, 'farm_status', {});
        const text = all.content[0].text;
        for (const f of ['PASTURE', 'COOP', 'BARN', 'STABLE', 'DOVECOTE']) {
            ok(text.includes(f), `the report names ${f}`);
        }
        ok(/walked .* on MC1/.test(text), 'and says when it looked');

        const barn = await callTool(reading, 'farm_status', { field: 'barn' });
        ok(!barn.content[0].text.includes('PASTURE'), 'a field filter drops the others');
        ok(barn.structuredContent.bots.every((b) => b.field === 'barn'));

        const sick = await callTool(reading, 'farm_status', { state: 'sick' });
        ok(sick.structuredContent.bots.every((b) => b.state === 'sick'));
    });

    test('a failed feed is named in the text, not swallowed', async () => {
        const App = loadApp(NO_FARM);
        const feeds = fixtureFeeds();
        delete feeds.tasks;
        const r = assemble(App, App.herd.DEFAULT, feeds, { errors: { tasks: 'powershell said nothing' } });
        const out = await callTool(async () => r, 'farm_status', {});
        ok(out.content[0].text.includes('powershell said nothing'), 'the reason is in the report');
        ok(out.content[0].text.includes('UNKNOWN rather than healthy'), 'and what it means for the reading');
    });

    test('farm_bot answers by id and says so when there is no such bot', async () => {
        const reading = stubWalk();
        const one = await callTool(reading, 'farm_bot', { id: 'historian' });
        ok(one.content[0].text.includes('Historian'), 'the bot is named');
        eq(one.structuredContent.id, 'historian');

        const missing = await callTool(reading, 'farm_bot', { id: 'no-such-bot' });
        eq(missing.isError, true);
        ok(missing.content[0].text.includes('historian'), 'and the herd is offered instead');
    });

    test('an unknown tool is an invalid-params error, not a crash', async () => {
        let code = null;
        try { await callTool(stubWalk(), 'farm_feed', {}); } catch (e) { code = e.code; }
        eq(code, -32602);
    });

    /* ── serving it ────────────────────────────────────────── */

    // A farm reading names every bot this family runs and which of them are
    // down. Binding the tailnet without a token is the one mistake that turns
    // a status board into a disclosure, and it is too easy to make.
    test('http refuses a non-loopback bind without a token', () => {
        let why = '';
        try { checkBind(parseArgs(['--http', '--host', '100.75.220.87'])); } catch (e) { why = e.message; }
        ok(why.includes('refusing to serve'), `expected a refusal, got: ${why}`);

        const withToken = checkBind(parseArgs(['--http', '--host', '100.75.220.87', '--token', 'hunter2']));
        eq(withToken.token, 'hunter2');
        eq(parseArgs(['--http']).host, '127.0.0.1', 'loopback needs no token and is the default');
        eq(parseArgs([]).mode, 'stdio', 'stdio is the default transport');
    });
}
