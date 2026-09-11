/* ═══════════════════════════════════════════════
   MAGMA//KIT — dom.js

   The three DOM-building primitives every app in this family hand-rolls.
   Nothing app-flavoured lives here — status pills, stat rows and the rest
   stay in the apps that know what their CSS classes mean.
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    const MagmaKit = (window.MagmaKit = window.MagmaKit || {});

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
        return node;
    }

    /** The "— no data —" a card shows instead of fabricating numbers. */
    function noData(text) {
        return el('div', 'no-data', text || '— no data —');
    }

    MagmaKit.dom = { el, clear, noData };
}());
