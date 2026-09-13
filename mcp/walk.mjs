// mcp/walk.mjs — one walk of the farm, headless.
//
// The window's loop is herd -> feeds -> evidence -> verdicts -> draw. This is
// the same loop with the last step removed, and it is the SAME CODE: core/ and
// ui/feeds.js are evaluated here exactly as the page evaluates them, through
// the harness the test suite already uses. Nothing about what a bot is, or
// when it is sick, is restated in this directory.
//
// The one substitution is the bottom of the stack. In the app `BotFarm.farm`
// is Tauri's bridge into farm.rs; here it is farm-cli, which is farm.rs behind
// the same allowlists. So a reading that reaches an MCP client has passed
// through the same validators, the same journal event allowlist, and the same
// webhook path that never returns a URL.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHarness } from '../tests/kit/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** MUST match tests/run.mjs, which asserts it matches ui/index.html. */
const CORE = ['herd.js', 'evidence.js', 'health.js'];

const EXE = process.platform === 'win32' ? 'farm-cli.exe' : 'farm-cli';

/** The transport binary: an override, then release, then a debug build. */
export function findCli() {
    const override = (process.env.BOT_FARM_CLI || '').trim();
    if (override) {
        if (!existsSync(override)) throw new Error(`BOT_FARM_CLI is set but not there: ${override}`);
        return override;
    }
    const target = join(ROOT, 'desktop', 'src-tauri', 'target');
    for (const profile of ['release', 'debug']) {
        const p = join(target, profile, EXE);
        if (existsSync(p)) return p;
    }
    throw new Error(
        'farm-cli not built. From desktop/src-tauri: cargo build --release --bin farm-cli',
    );
}

/** farm-cli, once. Rejects with its stderr, which is what a feed error is. */
function cli(exe, args, timeout) {
    return new Promise((resolve, reject) => {
        execFile(exe, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
            (err, stdout, stderr) => {
                if (err) {
                    const why = String(stderr || err.message || '').trim().split('\n')[0];
                    reject(new Error(why || `farm-cli ${args[0]} failed`));
                    return;
                }
                try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`farm-cli ${args[0]}: ${e.message}`)); }
            });
    });
}

/** The object ui/bridge.js builds over Tauri, built over farm-cli instead.
 *  Read-only: no ghWorkflow, no taskAction, no openUrl, and farm-cli has no
 *  command for any of them either. */
export function cliFarm(exe, timeout = 45000) {
    const call = (...args) => cli(exe, args, timeout);
    return {
        ghApi: (path) => call('gh-api', path),
        tasksList: () => call('tasks'),
        probe: (name) => call('probe', name),
        journal: (name) => call('journal', name),
        webhook: (name) => call('webhook', name),
        configDir: () => call('config-dir'),
    };
}

/** core/ plus ui/feeds.js in a sandbox, with `farm` in the place the bridge
 *  would occupy. Returns the app's own `BotFarm` namespace. */
export function loadApp(farm) {
    const harness = createHarness({
        appRoot: join(ROOT, 'app'),
        namespace: 'BotFarm',
        kitFiles: ['keys.js', 'history.js', 'prefs.js', 'modal.js', 'dom.js'],
        coreFiles: CORE,
    });
    const sandbox = harness.coreSandbox();
    // Before feeds.js, because its `fetch` branches on the farm's presence the
    // way the page does: no farm means fixtures, and fixtures are the browser
    // mode's business, not this one's.
    sandbox.BotFarm.farm = farm;
    harness.loadUI(sandbox, 'feeds.js');
    return sandbox.BotFarm;
}

/** DEFAULT plus this machine's herd.json, exactly as ui/main.js does it. */
async function loadHerd(App, farm) {
    try {
        const dir = await farm.configDir();
        if (!dir) return { herd: App.herd.DEFAULT, dropped: [] };
        const path = join(dir, 'herd.json');
        if (!existsSync(path)) return { herd: App.herd.DEFAULT, dropped: [] };
        return App.herd.merge(JSON.parse(await readFile(path, 'utf8')));
    } catch (e) {
        return {
            herd: App.herd.DEFAULT,
            dropped: [{ record: 'herd.json', problems: [String((e && e.message) || e)] }],
        };
    }
}

/**
 * Feeds in, the answer out. Separate from the fetching so the suite can hand
 * it app/fixtures/ — the same captured feeds browser mode draws — and check
 * the assembly without a farm, a network or a built binary.
 */
export function assemble(App, herd, feeds, { errors = {}, dropped = [] } = {}, now = Date.now()) {
    const evidence = App.evidence.gatherAll(herd, feeds);
    const verdicts = App.health.classifyAll(herd, evidence, now);
    const tally = App.health.tally(verdicts);

    const bots = herd.map((b) => {
        const v = verdicts[b.id];
        const ev = evidence[b.id] || {};
        return {
            id: b.id,
            name: b.name,
            field: b.field,
            species: b.species,
            does: b.does,
            cadence: b.cadence,
            state: v.state,
            label: v.label,
            detail: v.detail,
            when: v.when,
            line: v.line,
            at: ev.at === undefined ? null : ev.at,
            url: ev.url || null,
        };
    });

    return {
        at: now,
        fields: App.herd.FIELDS,
        bots,
        tally,
        report: App.health.report(tally),
        errors,
        dropped,
    };
}

/**
 * One complete walk.
 *
 * `errors` is per-feed and never fatal — the Pi off the tailnet dims the coop
 * and nothing else — which is the same contract ui/feeds.js gives the page.
 */
export async function walk(farm, now = Date.now()) {
    const App = loadApp(farm);
    const { herd, dropped } = await loadHerd(App, farm);
    const { feeds, errors } = await App.feeds.fetch(herd);
    return assemble(App, herd, feeds, { errors, dropped }, now);
}
