// artstore.js — imported art, kept OFF the document.
//
// EXTRACTED from deck-press/app/core/artstore.js, which was itself written
// from album//art's measurements. Two hand-rolled copies existed before this
// file: album//art's imageStore / imageCache / refByData maps inside its
// canvas.js, and deck-press's module. That is the bar.
//
// An element carries an opaque ref ('img7'). The bytes live here, keyed by
// that ref. This indirection is the single most important decision in any
// import path, and it is not a later optimisation.
//
// album//art measured what happens without it, and wrote the numbers down:
// with the base64 payload ON the element, one 1600x1600 photo cost 11.2 MB per
// undo state, 571 MB across a 50-state stack, and 11.4 ms of JSON.stringify on
// every property tweak — 0.02 ms with a ref, a factor of 572. A deck is 52
// cards inside ONE snapshotted document, so the same mistake there is worse
// again.
//
// NOTHING IS EVER EVICTED from the live store. Undo can resurrect an element
// whose art was cleared, and a store that dropped the bytes on delete would
// restore an element that cannot draw. Pruning happens once, on save, against
// what the document actually references.
//
// Pure: it holds strings and hands them back. Producing those strings — a
// FileReader, an Image to measure with, a DOMParser to sanitise with — is the
// app's ui/ layer's job, because none of it exists in the Node sandbox.
//
// A FACTORY, not a module-level singleton, matching history.create,
// keys.create and prefs.create: one store per document, named by the app that
// owns it. The 'img' prefix stays hardcoded because indexOf()'s regex has to
// agree with it, and an option nobody would ever turn is invention rather than
// extraction.

(function () {
    'use strict';

    const MagmaKit = (window.MagmaKit = window.MagmaKit || {});

    function create() {
        let store = new Map();        // ref -> entry
        let byPayload = new Map();    // payload -> ref, for dedupe
        let seq = 0;

        function reset() {
            store = new Map();
            byPayload = new Map();
            seq = 0;
        }

        function indexOf(ref) {
            const m = /^img(\d+)$/.exec(String(ref));
            return m ? Number(m[1]) : 0;
        }

        /**
         * Take a payload and return the ref that identifies it.
         *
         * `payload` is a data URL for raster art and sanitised SVG SOURCE TEXT
         * for vector — vector has to stay text to stay vector, since inlining
         * is what keeps it real geometry all the way to a print file.
         *
         * Importing the same bytes twice returns the SAME ref and stores one
         * copy, so putting one image on fifty elements costs one payload
         * rather than fifty.
         */
        function register(payload, meta) {
            if (!payload) return null;
            const existing = byPayload.get(payload);
            if (existing) return existing;

            const ref = 'img' + (++seq);
            store.set(ref, Object.assign({
                kind: 'raster', w: 0, h: 0, name: '', bytes: 0, mime: '',
            }, meta || {}, { payload: payload }));
            byPayload.set(payload, ref);
            return ref;
        }

        function get(ref) {
            const entry = store.get(ref);
            return entry ? entry.payload : null;
        }

        function meta(ref) {
            const entry = store.get(ref);
            if (!entry) return null;
            const out = Object.assign({}, entry);
            delete out.payload;      // callers wanting bytes ask for them by name
            return out;
        }

        function has(ref) { return store.has(ref); }
        function refs() { return [...store.keys()]; }
        function size() { return store.size; }

        /** Total payload bytes, for the save-size warning. */
        function weight() {
            let total = 0;
            for (const entry of store.values()) total += entry.payload.length;
            return total;
        }

        /**
         * What goes into the saved file: only what the document still
         * references.
         *
         * The live store keeps everything, deliberately (see the header). The
         * undo stack is not written to disk, so what a saved file needs is
         * exactly the art the saved document points at.
         */
        function serialize(usedRefs) {
            const keep = new Set(usedRefs || refs());
            const out = {};
            for (const [ref, entry] of store) {
                if (keep.has(ref)) out[ref] = Object.assign({}, entry);
            }
            return out;
        }

        /**
         * Adopt the art map from a loaded file.
         *
         * THE COUNTER MUST BE RE-SEEDED above the highest ref in that map. A
         * file holding img1..img9 loaded into a store whose seq is 0 would have
         * the next import allocate img1 — which already exists, so register()
         * would hand back the LOADED art instead, and the element would
         * silently show the wrong picture. That is a data-loss bug, and it is
         * asserted directly.
         */
        function adopt(artMap) {
            reset();
            if (!artMap) return;
            for (const ref of Object.keys(artMap)) {
                const entry = artMap[ref];
                if (!entry || !entry.payload) continue;
                store.set(ref, Object.assign({}, entry));
                if (!byPayload.has(entry.payload)) byPayload.set(entry.payload, ref);
                seq = Math.max(seq, indexOf(ref));
            }
        }

        return {
            register, get, meta, has, refs, size, weight, serialize, adopt, reset,
        };
    }

    MagmaKit.artstore = { create };
}());
