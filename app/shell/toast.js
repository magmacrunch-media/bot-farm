/* ═══════════════════════════════════════════════
    magmacrunch media — ware toast
    ware/shell/toast.js

    One transient status line, shared by media-search and album-art-maker.

    media-search had two copies of this and they had drifted: the one in
    lightbox.js omitted the stacking offset, so a "URL COPIED" landed exactly
    on top of whatever was already showing. album-art-maker had none at all
    and used alert(), which blocks the page and looks nothing like the rest
    of it.

    The stacking counter is why this is shared state rather than a helper
    each caller keeps: two callers in one page have to agree on how many
    toasts are currently up, or they draw on top of each other.

    Pair with ware/shell/toast.css.

    Exposes window.Toast = { show }.
    ═══════════════════════════════════════════════ */

(function () {
    /* Matches the total animation time in toast.css: 0.3s in, --toast-hold
       on screen, 0.3s out. Kept as a constant rather than read back from
       computed style because a mismatch only ever means a toast lingers
       invisibly or vanishes mid-fade, and neither is worth a reflow. */
    const LIFETIME_MS = 2500;
    const STACK_GAP_PX = 40;
    const BASE_OFFSET_PX = 20;

    let showing = 0;

    /* Show `msg` for the toast lifetime. Returns the element so a caller can
       dismiss it early if it ever needs to; nothing does today. */
    function show(msg) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        toast.style.bottom = (BASE_OFFSET_PX + showing * STACK_GAP_PX) + 'px';
        document.body.appendChild(toast);
        showing++;

        setTimeout(() => {
            toast.remove();
            // Guard the floor: a caller removing a toast by hand would
            // otherwise drive this negative and stack the next one off-screen.
            showing = Math.max(0, showing - 1);
        }, LIFETIME_MS);

        return toast;
    }

    window.Toast = { show };
})();
