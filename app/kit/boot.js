/* ═══════════════════════════════════════════════
   MAGMA//KIT — boot.js

   Loaded FIRST, before anything else, and it does exactly one thing: make sure
   a script error somewhere in the load order ends up in the log file rather
   than in a console nobody can see.

   The load order is a chain of classic scripts. A throw in one does not stop
   the next from loading, but it does stop that module from attaching — and the
   modules after it then fail on the missing dependency, one after another,
   silently. From outside, the window simply sits there showing whatever it had
   painted first. That is a genuinely hard failure to diagnose without this.

   Deliberately dependency-free: it cannot use bridge-core.js, because
   bridge-core.js is one of the files whose failure it exists to report. The
   Rust side must expose a `log_line(kind, message, detail)` command (the kit
   crate's log module is its usual backing).

   The app names its namespace on the root element — <html data-app="MyApp"> —
   so the modules-attached report below knows which window.* object to count.
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    function send(kind, message, detail) {
        const t = window.__TAURI_INTERNALS__;
        if (!t || typeof t.invoke !== 'function') return;
        try {
            t.invoke('log_line', {
                kind,
                message: String(message),
                detail: detail === undefined || detail === null ? null : String(detail),
            });
        } catch { /* a logger that throws is worse than no logger */ }
    }

    window.addEventListener('error', (e) => {
        send('ERROR', `${e.message}`,
            `${e.filename || '?'}:${e.lineno || '?'}:${e.colno || '?'}`
            + (e.error && e.error.stack ? ` | ${e.error.stack}` : ''));
    });

    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        send('ERROR', 'unhandled promise rejection',
            r && r.stack ? r.stack : String(r));
    });

    send('boot', 'page loading', location.pathname);

    // Report which modules actually attached, once everything has had its turn.
    // A gap in this list names the file that broke and, by implication, why
    // everything downstream of it is missing.
    window.addEventListener('DOMContentLoaded', () => {
        const name = document.documentElement.dataset
            && document.documentElement.dataset.app;
        const M = (name && window[name]) || {};
        send('boot', 'modules attached', Object.keys(M).join(',') || '(none)');
    });
}());
