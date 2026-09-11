/* ═══════════════════════════════════════════════
   MAGMA//KIT — history.js

   A snapshot-based undo/redo stack. The app owns what a state IS — it hands
   over `snapshot()` (capture the current state) and `restore(state)` (put one
   back), and the stack owns everything else: depth, ordering, and the redo
   branch dying when new work is pushed.

   Merged from three earlier hand-rolled copies (album-art-maker, the
   sprite-forge web build, the sprite-forge desktop editor); the union of what
   they learned:

   - push() takes the PRE-mutation state: snapshot before you change things,
     push that, then mutate. Undo restores it; the state being left is
     captured at undo time.
   - beginStroke()/commitStroke(): a drag snapshots once on mousedown and
     commits only if something actually changed, so one Ctrl+Z undoes the
     whole stroke and no-op clicks don't pollute the stack.
   - `leaving(target)` hook: when the state being restored carries extra
     baggage (sprite-forge's project-wide recolours carry the whole sprite
     list), the state pushed to the other stack may need to carry it too, or
     undoing strands redo with no way back. The default is a plain snapshot.
   - revision() counts every mutation the stack has seen — push, undo, redo —
     which is exactly what dirty-tracking wants to compare against a
     saved-at-revision number.
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    const MagmaKit = (window.MagmaKit = window.MagmaKit || {});

    /**
     * @param opts.cap       max undo depth (default 100); oldest states fall off
     * @param opts.snapshot  () => state — capture the current state, deep enough
     *                       that later mutation cannot reach into it
     * @param opts.restore   (state) => void — make the app show this state
     * @param opts.leaving   optional (target) => state — capture the state being
     *                       left, knowing which state is about to be restored
     */
    function create(opts) {
        const cap = opts.cap || 100;
        const snapshot = opts.snapshot;
        const restore = opts.restore;
        const leaving = opts.leaving || snapshot;

        const undoStack = [];
        const redoStack = [];
        let pending = null;
        let changes = 0;

        /** Push a pre-mutation state. No argument means "snapshot now". */
        function push(state) {
            changes++;
            undoStack.push(state === undefined ? snapshot() : state);
            if (undoStack.length > cap) undoStack.shift();
            redoStack.length = 0;
        }

        /* The pending snapshot is boxed, not held bare: a state that happens
           to be falsy (0, '', null) must still commit.

           IDEMPOTENT, and that is the point. A colour picker fires `input`
           continuously through a drag and a range slider does the same, so
           every consumer drives this from an event that repeats. Re-snapshotting
           on each call would capture the already-dragged state and a single
           drag would become two hundred undo entries — which is why all three
           consuming apps had independently wrapped this in an `inStroke` latch
           before the guard moved here where it belongs. The boxed pending
           already distinguishes "no stroke open" from "a stroke whose state is
           falsy", so the test is exact. */
        function beginStroke() { if (!pending) pending = { state: snapshot() }; }
        function commitStroke() { if (pending) { push(pending.state); pending = null; } }
        function cancelStroke() { pending = null; }

        function undo() {
            if (!undoStack.length) return false;
            changes++;
            const s = undoStack.pop();
            redoStack.push(leaving(s));
            restore(s);
            return true;
        }

        function redo() {
            if (!redoStack.length) return false;
            changes++;
            const s = redoStack.pop();
            undoStack.push(leaving(s));
            restore(s);
            return true;
        }

        function canUndo() { return undoStack.length > 0; }
        function canRedo() { return redoStack.length > 0; }
        function revision() { return changes; }

        function clear() {
            undoStack.length = 0;
            redoStack.length = 0;
            pending = null;
        }

        return {
            push, beginStroke, commitStroke, cancelStroke,
            undo, redo, canUndo, canRedo, revision, clear,
        };
    }

    MagmaKit.history = { create };
}());
