/* ═══════════════════════════════════════════════
   MAGMA//KIT — keys.js

   The keyboard map, as data. The app supplies a bindings table — each entry
   {key, ctrl, shift, action} — and gets back a resolver that turns a
   KeyboardEvent into an action NAME, or null. What that action does is the
   app's business, which is why two windows can share one table and still do
   different things with the same name.

   Pure event → name. Nothing here binds a listener, prevents a default, or
   knows what any action means.

   `ctrl` also means Cmd on macOS — the event carries metaKey there, and both
   map to the same intent.

   Nothing sensible binds a bare letter without a guard: text inputs exist, and
   a bare "r" that fires a command while someone is typing a hostname is worse
   than no shortcut at all — `isTyping` below is that guard, applied to every
   unmodified binding automatically.
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    const MagmaKit = (window.MagmaKit = window.MagmaKit || {});

    /* Keys that cannot produce a character, so a text field has no claim on
       them. Escape is deliberately NOT here: in a field it conventionally
       means "cancel what I am doing", and the field should keep it. */
    const NEVER_A_CHARACTER = /^F\d{1,2}$/;

    /**
     * Is the user typing? Then a bare key is a character, not a command.
     *
     * Ctrl-modified bindings still fire: Ctrl+R while in a text field is
     * unambiguous, and refusing it would be surprising.
     */
    function isTyping(target) {
        if (!target) return false;
        const tag = (target.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            // A checkbox is not text; space and letters mean nothing in it.
            const type = (target.type || '').toLowerCase();
            return !(tag === 'INPUT' && (type === 'checkbox' || type === 'radio'));
        }
        return !!target.isContentEditable;
    }

    /**
     * Build a resolver over a bindings table.
     *
     * @param bindings  [{key, ctrl?, shift?, action}] — single characters
     *                  match case-insensitively; longer names ('F5', 'Escape',
     *                  'ArrowLeft') match event.key exactly.
     */
    function create(bindings) {
        /**
         * Resolve a KeyboardEvent to an action name, or null.
         *
         * @param available  optional list of action names this page handles,
         *                   so a binding another window has no use for
         *                   resolves to null rather than being swallowed.
         */
        function resolve(event, available) {
            if (!event) return null;

            const ctrl = !!(event.ctrlKey || event.metaKey);

            // Alt is not used by any binding, and an Alt combination usually
            // belongs to the OS or a menu.
            if (event.altKey) return null;

            for (const b of bindings) {
                if (b.key.length === 1) {
                    if ((event.key || '').toLowerCase() !== b.key.toLowerCase()) continue;
                } else if (event.key !== b.key) {
                    continue;
                }
                if (!!b.ctrl !== ctrl) continue;
                if (!!b.shift !== !!event.shiftKey) continue;

                // A bare binding while typing is a character, not a command —
                // unless it is a key that cannot be one. F5 is F5 wherever
                // the caret happens to be.
                if (!b.ctrl && !NEVER_A_CHARACTER.test(b.key) && isTyping(event.target)) return null;

                if (available && !available.includes(b.action)) return null;
                return b.action;
            }
            return null;
        }

        return { bindings, resolve, isTyping };
    }

    MagmaKit.keys = { create, isTyping };
}());
