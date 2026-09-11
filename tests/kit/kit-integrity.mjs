// Does this app's vendored kit still match what it was vendored from?
//
// app/kit/KIT.md is written by the kit's sync.mjs and records a sha256 for
// every file it copied in. This checks the files on disk against that record.
//
// The point is that it needs NOTHING but this repo — not the magma-kit
// checkout, not the network. `npm run check:kit` answers a different and also
// useful question ("am I behind the kit?") but it needs the sibling present, so
// it cannot live in `npm run check`. This can, and it catches the failure that
// actually re-forks two apps: somebody edits a vendored file in place, in one
// repo, and nothing says so.
//
// It does not catch being BEHIND the kit — KIT.md moves with the files, so an
// old-but-consistent vendoring passes here. That is `check:kit`'s job, and the
// kit's own suite checks its consumers from the other side.
//
// Self-verifying, incidentally: this file is itself in the manifest, so its own
// hash is on the list it reads. That guards against an accident, not against
// somebody determined to edit both.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Must match sync.mjs: CRLF-insensitive, because git and editors differ on
 *  line endings across these repos and a hash that flips on that would cry
 *  drift where there is none. */
function sha256(path) {
    const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
    return createHash('sha256').update(text).digest('hex');
}

/** The `- \`path\` sha256:hex` rows out of a KIT.md. */
export function parseManifest(markdown) {
    return [...markdown.matchAll(/^- `([^`]+)` sha256:([0-9a-f]{64})$/gm)]
        .map(([, file, hash]) => ({ file, hash }));
}

export function kitVersionOf(markdown) {
    const m = markdown.match(/^Kit version:\s*(.+)$/m);
    return m ? m[1].trim() : null;
}

/**
 * @param root  absolute path to the repo root (the directory holding app/)
 * @returns {{version: string|null, checked: number, problems: string[]}}
 */
export function verify(root) {
    const markerPath = join(root, 'app', 'kit', 'KIT.md');
    if (!existsSync(markerPath)) {
        return { version: null, checked: 0, problems: ['app/kit/KIT.md is missing — run `npm run sync-kit`'] };
    }

    const markdown = readFileSync(markerPath, 'utf8');
    const rows = parseManifest(markdown);
    const problems = [];

    if (!rows.length) problems.push('app/kit/KIT.md records no files — it is not a manifest');

    for (const { file, hash } of rows) {
        const path = join(root, file);
        if (!existsSync(path)) { problems.push(`${file} is missing, but KIT.md lists it`); continue; }
        if (sha256(path) !== hash) {
            problems.push(`${file} has been edited in place — kit files are vendored copies, `
                + 'so change it in magma-kit and re-run `npm run sync-kit`');
        }
    }

    return { version: kitVersionOf(markdown), checked: rows.length, problems };
}

/**
 * The suite, for an app's runner: `integritySuite({ root })(test, eq, ok)`.
 *
 * One test per file rather than one for all of them, so a failure names the
 * file rather than handing back a list to read.
 */
export function integritySuite(opts) {
    const { root } = opts;

    return function (test, eq, ok) {
        const result = verify(root);

        test('the vendored kit records where it came from', () => {
            ok(result.version, 'app/kit/KIT.md names a kit version');
            ok(result.checked > 0, `it lists files (${result.checked})`);
        });

        test('no vendored kit file has been edited in place', () => {
            eq(result.problems, [], 'app/kit/ and tests/kit/ match app/kit/KIT.md');
        });
    };
}
