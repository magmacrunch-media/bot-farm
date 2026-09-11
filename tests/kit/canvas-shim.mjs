// Just enough canvas for a core/ module that composes or reads back a bitmap:
// a flat RGBA buffer and a 2D context that blits into it. Not a canvas
// implementation and not trying to be. From sprite-forge, where core/sheet.js
// carries a four-repo sheet contract that has to be testable without a
// browser.
//
// Exported pieces, not wired in by default: an app that needs these passes
// them to createHarness via `globals` — { ImageData, document: fakeDocument() }
// — and one that does not need them should not have them, because a core
// module that suddenly needs a shim is a module that belongs in ui/.

export class ImageData {
    constructor(w, h) {
        this.width = w; this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
    }
}

class Ctx {
    constructor(canvas) { this.canvas = canvas; }
    _buf() {
        const c = this.canvas;
        if (!c._data || c._w !== c.width || c._h !== c.height) {
            c._data = new Uint8ClampedArray(c.width * c.height * 4);
            c._w = c.width; c._h = c.height;
        }
        return c._data;
    }
    putImageData(img, dx, dy) {
        const buf = this._buf(), W = this.canvas.width;
        for (let y = 0; y < img.height; y++)
            for (let x = 0; x < img.width; x++) {
                const s = (y * img.width + x) * 4, d = ((dy + y) * W + (dx + x)) * 4;
                for (let i = 0; i < 4; i++) buf[d + i] = img.data[s + i];
            }
    }
    getImageData(sx, sy, w, h) {
        const buf = this._buf(), W = this.canvas.width, out = new ImageData(w, h);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const s = ((sy + y) * W + (sx + x)) * 4, d = (y * w + x) * 4;
                for (let i = 0; i < 4; i++) out.data[d + i] = buf[s + i];
            }
        return out;
    }
}

/** A stub canvas, sized. `getContext('2d')` returns the same Ctx every time,
 *  which is what a real canvas does and what putImageData-then-read relies on. */
export function canvas(w = 0, h = 0) {
    const c = { width: w, height: h };
    const ctx = new Ctx(c);
    c.getContext = () => ctx;
    return c;
}

export function fakeDocument() {
    return {
        createElement(tag) {
            if (tag !== 'canvas') throw new Error(`test shim only makes canvases, not <${tag}>`);
            return canvas();
        },
    };
}
