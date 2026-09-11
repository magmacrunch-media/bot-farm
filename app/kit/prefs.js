/* ═══════════════════════════════════════════════
   MAGMA//KIT — prefs.js

   localStorage as a preferences store, with every failure swallowed: private
   mode throws on setItem, a corrupt value throws on parse, and neither is a
   reason for the app to stop working. A preference that fails to persist is a
   default, not an error.

   read() returns null — not {} — when there is nothing usable, matching the
   `if (!prefs) return;` idiom every existing caller already has.
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    const MagmaKit = (window.MagmaKit = window.MagmaKit || {});

    function read(key) {
        try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
    }

    function write(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    }

    /** The same pair bound to one key, plus a shallow merge for partial updates. */
    function create(key) {
        return {
            read: () => read(key),
            write: (value) => write(key, value),
            patch: (partial) => write(key, Object.assign(read(key) || {}, partial)),
        };
    }

    MagmaKit.prefs = { read, write, create };
}());
