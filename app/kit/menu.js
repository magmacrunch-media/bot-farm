// menu.js — a menu bar drawn in the page.
//
// EXTRACTED from sprite-forge/app/ui/menu.js after album//art wrote the second
// copy. Its reasoning, which is the reason this is not a native menu:
//
//   "Drawn in the page, not by Windows. A native menu bar is rendered by the
//    OS in the OS font, and this app is Press Start 2P and Courier Prime on a
//    scanline; a strip of Segoe UI across the top of it would look like a
//    different program wearing the window."
//
// IT OWNS NO BEHAVIOUR, and that is the whole design. Every item names an
// action and the app's `actions` map routes it to something that already
// exists. Items that mirror a control carry `data-toggles="<id>"` and are
// dispatched by CLICKING that control, so a menu can never become a second
// implementation of a toggle and then drift from it.
//
// The MARKUP and the CSS stay in the app: the bar's look is the app's
// typography, and the kit does not ship chrome. What the kit owns is the
// open/close/hover/sync behaviour that all of it needs and none of it should
// write twice.

(function () {
    'use strict';

    const MagmaKit = (window.MagmaKit = window.MagmaKit || {});

    /**
     * create(bar, opts) -> { open, close, sync, isOpen }
     *
     *   bar          the <nav> containing .menu > .menu-title + .menu-drop
     *   opts.actions { 'action:name': (item) => void } — the app's dispatch
     *   opts.state   optional (action, item) => { disabled?, checked? }, asked
     *                for every item each time a menu opens
     *
     * Anything opts.state does not answer for falls back to the data-toggles
     * rule: an item mirrors the `.active` class of the element it names.
     */
    function create(bar, opts) {
        if (!bar) return null;
        const o = opts || {};
        const actions = o.actions || {};
        let open = null;

        /** The control an item stands for, if it names one. */
        function proxied(item) {
            return document.getElementById(item.dataset.toggles || '');
        }

        function close() {
            if (!open) return;
            open.classList.remove('open');
            open = null;
        }

        function show(menu) {
            if (open === menu) { close(); return; }
            close();
            sync();
            menu.classList.add('open');
            open = menu;
        }

        /* Item state is read FRESH every time a menu opens rather than kept in
           step: undo depth, selection and every toggle change from under us,
           and a menu that subscribed to all of them would be a second copy of
           each. */
        function sync() {
            for (const item of bar.querySelectorAll('[data-action]')) {
                const action = item.dataset.action;
                const s = o.state ? o.state(action, item) : null;

                if (s && typeof s.disabled === 'boolean') item.disabled = s.disabled;

                if (s && typeof s.checked === 'boolean') {
                    item.classList.toggle('checked', s.checked);
                } else {
                    const target = proxied(item);
                    if (target) item.classList.toggle('checked', target.classList.contains('active'));
                }
            }
        }

        /* Wired one menu at a time so each listener closes over exactly one
           `menu` rather than a loop variable. */
        function wire(menu) {
            const title = menu.querySelector('.menu-title');
            if (title) {
                title.addEventListener('click', function (e) {
                    e.stopPropagation();
                    show(menu);
                });
            }
            /* Once one menu is open, sliding across the bar switches between
               them without another click — the one behaviour every real menu
               bar has and no plain <details> gives you for free. */
            menu.addEventListener('mouseenter', function () {
                if (open && open !== menu) show(menu);
            });
        }

        for (const menu of bar.querySelectorAll('.menu')) wire(menu);

        bar.addEventListener('click', function (e) {
            const item = e.target.closest('[data-action]');
            if (!item || item.disabled) return;
            // Closed BEFORE the action runs: an action that opens a dialog
            // would otherwise leave the menu hanging over it.
            close();
            const fn = actions[item.dataset.action];
            if (fn) fn(item);
        });

        document.addEventListener('click', close);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') close();
        });

        return {
            open: show,
            close: close,
            sync: sync,
            isOpen: function () { return open; },
        };
    }

    MagmaKit.menu = { create };
}());
