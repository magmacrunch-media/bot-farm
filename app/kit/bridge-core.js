/* ═══════════════════════════════════════════════
   MAGMA//KIT — bridge-core.js

   The Tauri substrate under every app's own bridge.js: decide whether a
   backend exists at all, and hand the app the three primitives it needs to
   talk to one. The app's bridge.js stays the single place that names its
   commands; this file names none.

   Capability detection is on window.__TAURI_INTERNALS__, never a user-agent.
   When it is absent — a plain browser, opened to work on the CSS —
   MagmaKit.tauri stays undefined and the app degrades instead of throwing.
   The absence of the object IS the feature switch; nothing downstream ever
   asks "are we in Tauri".

   @tauri-apps/api is deliberately NOT a dependency (the house rule from
   sprite-forge). Plugin commands are addressed directly as
   `plugin:<name>|<cmd>`, which is the wire format the package itself uses.

   on() rides transformCallback, an internal: it registers fn on window under a
   generated numeric id and returns that id, which the Rust side resolves when
   it emits. This is exactly what the package's listen() does internally — we
   call it directly rather than take the dependency. Covered by core:default,
   which includes core:event:allow-listen. Because this rides an internal,
   @tauri-apps/cli is pinned to an EXACT version in every consumer's
   desktop/package.json so the shape cannot shift under a patch bump.
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    const MagmaKit = (window.MagmaKit = window.MagmaKit || {});

    const t = window.__TAURI_INTERNALS__;
    if (!t || typeof t.invoke !== 'function') return;

    // Past this point we know we are the desktop build, so say so on <html>.
    // CSS uses it to drop the parts of the vendored shell that only mean
    // something on the website: the back link into the utilities index (a dead
    // path inside a bundle) and the site footer. shell/ itself stays
    // byte-identical — the overrides live in the app's own stylesheet.
    document.documentElement.classList.add('desktop');

    const invoke = (cmd, args) => t.invoke(cmd, args || {});
    const dialog = (cmd, args) => t.invoke(`plugin:dialog|${cmd}`, args || {});

    const on = (event, fn) => {
        const handler = t.transformCallback((e) => fn(e.payload));
        return invoke('plugin:event|listen', {
            event,
            target: { kind: 'Any' },
            handler,
        });
    };

    // Opt-in, because it is a policy decision: WebView2 offers its own
    // right-click menu — Back, Reload, Save as, Print — and in a single-page
    // tool every entry is either meaningless or actively destructive (Reload
    // throws away unsaved work with no prompt). Fields keep theirs, because
    // Cut/Copy/Paste in a text box is the one case where the browser's menu is
    // the right menu.
    const suppressContextMenu = () => {
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('input, textarea')) return;
            e.preventDefault();
        });
    };

    MagmaKit.tauri = { invoke, dialog, on, suppressContextMenu };
}());
