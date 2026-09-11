// Loads classic scripts into a fake window so the browser IIFEs can be tested
// in Node.
//
// The apps in this family are plain classic scripts by design (see each app's
// AGENTS.md), so there is nothing to import. This evaluates them in order
// against a stub global, which also proves the load order in ui/index.html is
// the real dependency order: drop a file, or reorder two, and the next one
// throws here before it ever reaches a browser.
//
// Two layers:
//
//   baseSandbox / runScript — the raw materials, used by the kit's own suite.
//   createHarness           — the consumer-facing factory: an app describes
//                             its layout once and gets back the loadCore /
//                             coreSandbox / loadUI / scriptOrder quartet its
//                             suites import.
//
// No shims are provided by default — an app whose core/ needs one passes it
// via `globals` (sprite-forge hands in the canvas shim from canvas-shim.mjs).
// If a module needs a shim you did not expect, that is the signal it belongs
// in ui/ instead.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/** A vm context posing as a window. `globals` is spread in last, so a suite
 *  can stub anything — localStorage, document, __TAURI_INTERNALS__. */
export function baseSandbox(globals = {}) {
    const sandbox = {
        console,
        // boot.js subscribes to window events at load time; nothing in a test
        // dispatches them unless the suite replaces this with a recorder.
        addEventListener: () => {},
        location: { pathname: '/test' },
        ...globals,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    return sandbox;
}

/** Evaluate one classic script into a sandbox. */
export function runScript(sandbox, path, filename) {
    vm.runInContext(readFileSync(path, 'utf8'), sandbox, { filename: filename || path });
}

/**
 * @param opts.appRoot   absolute path to the app/ directory
 * @param opts.namespace the app's window.* name ('SpriteForge', 'MagmaOps')
 * @param opts.kitFiles  basenames under app/kit/ to load first, in order —
 *                       usually just the pure ones a core module could lean on
 *                       (keys.js, history.js, prefs.js)
 * @param opts.coreFiles paths under app/core/ in load order. MUST match the
 *                       <script> order in ui/index.html; assert that with
 *                       scriptOrder in the app's runner.
 * @param opts.globals   extra sandbox globals (shims, stubs)
 */
export function createHarness(opts) {
    const { appRoot, namespace, kitFiles = [], coreFiles = [], globals = {} } = opts;

    /** The full fake window, for suites that need more than the namespace. */
    function coreSandbox(extra = {}) {
        const sandbox = baseSandbox({ ...globals, ...extra });
        for (const f of kitFiles)
            runScript(sandbox, join(appRoot, 'kit', f), `kit/${f}`);
        for (const f of coreFiles)
            runScript(sandbox, join(appRoot, 'core', f), `core/${f}`);
        return sandbox;
    }

    function loadCore() { return coreSandbox()[namespace]; }

    /** Evaluate a ui/ file into a sandbox from coreSandbox(). */
    function loadUI(sandbox, file) {
        runScript(sandbox, join(appRoot, 'ui', file), `ui/${file}`);
    }

    /** The <script src="..."> paths from a ui/ page, in document order. */
    function scriptOrder(page) {
        const html = readFileSync(join(appRoot, 'ui', page), 'utf8');
        return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
    }

    return { coreSandbox, loadCore, loadUI, scriptOrder };
}
