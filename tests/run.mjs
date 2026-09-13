#!/usr/bin/env node
// Dependency-free test runner. `node tests/run.mjs`.

import { createHarness } from './kit/harness.mjs';
import { results, test, eq, ok } from './kit/assert.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// MUST match the <script> order in app/ui/index.html — asserted below.
export const KIT_ORDER = ['boot.js', 'bridge-core.js', 'keys.js', 'history.js',
    'prefs.js', 'modal.js', 'dom.js'];
export const ORDER = ['herd.js', 'evidence.js', 'health.js'];

export const harness = createHarness({
    appRoot: join(ROOT, 'app'),
    namespace: 'BotFarm',
    // boot.js and bridge-core.js are load-order concerns, not sandbox
    // concerns: they attach listeners and detect Tauri, neither of which a
    // core suite exercises. The pure kit modules load so core/ can lean on
    // them.
    kitFiles: ['keys.js', 'history.js', 'prefs.js', 'modal.js', 'dom.js'],
    coreFiles: ORDER,
});

const M = harness.loadCore();

// Every core module must attach. A file that loads but exports nothing is a
// silent failure the suites below would never reach.
for (const f of ORDER) {
    const mod = f.replace(/\.js$/, '');
    if (!M[mod]) {
        console.error(`core/${f} did not attach to BotFarm.${mod}`);
        process.exit(1);
    }
}

// The load order in the page IS the dependency order. Asserting it here makes
// a reordered <script> list a test failure instead of a runtime crash.
test('index.html loads kit, core and ui in order', () => {
    const srcs = harness.scriptOrder('index.html');
    eq(srcs[0], '../kit/boot.js', 'boot.js loads before anything it might report on');
    const kit = srcs.filter((s) => s.includes('/kit/')).map((s) => s.split('/').pop());
    eq(kit, KIT_ORDER, 'kit scripts in index.html');
    const core = srcs.filter((s) => s.includes('/core/')).map((s) => s.split('/').pop());
    eq(core, ORDER, 'core scripts in index.html');
    const firstUi = srcs.findIndex((s) => s === 'bridge.js');
    const lastCore = srcs.map((s) => s.includes('/core/')).lastIndexOf(true);
    ok(firstUi > lastCore, 'bridge.js loads after every core/ module');
    ok(srcs.indexOf('feeds.js') > firstUi, 'feeds.js needs the bridge');
    eq(srcs[srcs.length - 1], 'main.js', 'main.js is last');
});

const suites = ['./herd.test.mjs', './evidence.test.mjs', './health.test.mjs',
    './version.test.mjs', './kit-integrity.test.mjs',
    './mcp.test.mjs'];
for (const s of suites) {
    await Promise.race([
        (async () => (await import(s)).default(M))(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${s} did not finish in 30s — a promise never settled`)), 30_000)
                .unref()),
    ]);
}

console.log(`${results.pass} passed, ${results.fail} failed`);
if (results.fail) {
    console.log('\n' + results.fails.map((f) => '  FAIL ' + f).join('\n\n'));
    process.exit(1);
}
