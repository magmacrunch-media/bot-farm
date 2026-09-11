/* ═══════════════════════════════════════════════
   MAGMA//KIT — modal.js

   The native <dialog> idioms, written once. Two shapes:

   wire(dlg)  — a plain modal with the same three ways out every modal in
                these apps offers: the × (.modal-close), any button passed in
                `closers`, and a click on the backdrop.

   asker(dlg) — a modal that ANSWERS: ask() returns a promise resolving to
                whatever the populate callback settles, or null on any
                dismissal. Deliberately NOT driven by the dialog's own close
                event. That event is the obvious hook and it is one dependency
                too many: settling a promise on it means any environment that
                does not raise it leaves the caller waiting for an answer that
                never comes, with the dialog already gone from the screen.
                Closing is ours to do here, so the answer is ours to deliver
                too. The promise is settled exactly once no matter which way
                out the user takes.

   showModal() on an already-open dialog throws, and a second caller would be
   answered by the first one's content — both open() and ask() guard on .open.
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    const MagmaKit = (window.MagmaKit = window.MagmaKit || {});

    function closersOf(dlg, opts) {
        const found = [];
        const x = dlg.querySelector('.modal-close');
        if (x) found.push(x);
        for (const c of (opts && opts.closers) || []) {
            const btn = typeof c === 'string' ? document.getElementById(c) : c;
            if (btn) found.push(btn);
        }
        return found;
    }

    /** Three-ways-out wiring for a plain modal. Returns {open, close}. */
    function wire(dlg, opts) {
        const close = () => dlg.close();
        for (const btn of closersOf(dlg, opts)) btn.addEventListener('click', close);
        dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
        return {
            open: () => { if (!dlg.open) dlg.showModal(); },
            close,
        };
    }

    /** Question-shaped modal. Returns {ask, dismiss}. */
    function asker(dlg, opts) {
        // Whoever is waiting on the dialog, or null when it is not up. Every
        // way out goes through it.
        let answer = null;
        const dismiss = () => { if (answer) answer(null); };

        for (const btn of closersOf(dlg, opts)) btn.addEventListener('click', dismiss);
        dlg.addEventListener('click', (e) => { if (e.target === dlg) dismiss(); });
        // Escape closes a <dialog> natively and fires cancel first. Both are
        // handled: cancel for the normal path, keydown for anything that
        // closes without raising it.
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); dismiss(); });
        dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(); } });

        /**
         * @param populate  optional (settle) => void — fill the dialog and wire
         *                  its choice controls to settle(value)
         * @returns {Promise<*>} the settled value, or null if dismissed
         */
        function ask(populate) {
            if (dlg.open) return Promise.resolve(null);
            return new Promise((resolve) => {
                const settle = (value) => { answer = null; dlg.close(); resolve(value); };
                answer = settle;
                if (populate) populate(settle);
                dlg.showModal();
            });
        }

        return { ask, dismiss };
    }

    MagmaKit.modal = { wire, asker };
}());
