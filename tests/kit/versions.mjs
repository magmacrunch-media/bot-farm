// The version-consistency suite, as a factory. The version of one of these
// apps lives in several files with no build step to reconcile them; this makes
// the drift a test failure instead of a shipped contradiction.
//
// Cargo.toml is the source of truth: it is what CARGO_PKG_VERSION comes from,
// so it is what the running binary reports and what the footer shows.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param opts.root     absolute path to the repo root (the directory holding
 *                      app/, desktop/, package.json)
 * @param opts.pages    ui/ pages to scan for hardcoded versions
 *                      (default ['index.html'])
 * @param opts.slotId   id of the footer element the version is fetched into,
 *                      or null to skip that check (default 'app-version')
 * @param opts.markup   what the markup may say about the version:
 *                      'none' (default) — the page asks the binary, so a
 *                        literal vX.Y.Z anywhere in it is a version that was
 *                        right the day it was written and wrong ever after;
 *                      'must-match' — the app also has a web build, which has
 *                        no binary to ask, so the page carries the version;
 *                        then it must AGREE with Cargo.toml. This is the check
 *                        that stops a hidden footer sitting at an old version
 *                        through several releases.
 * @param opts.manifests npm manifests that must stay private
 *                      (default package.json + desktop/package.json)
 * @returns a suite function for the app's runner: (test, eq, ok) => void
 */
export function versionSuite(opts) {
    const {
        root,
        pages = ['index.html'],
        slotId = 'app-version',
        markup = 'none',
        manifests = [['package.json'], ['desktop', 'package.json']],
    } = opts;
    const read = (...p) => readFileSync(join(root, ...p), 'utf8');

    return function (test, eq, ok) {
        const cargo = read('desktop', 'src-tauri', 'Cargo.toml')
            .match(/^version\s*=\s*"([^"]+)"/m);
        ok(cargo, 'Cargo.toml declares a version');
        const version = cargo[1];

        // THE DRIFT THAT MATTERS. tauri.conf.json's version names the
        // INSTALLER while Cargo.toml's is compiled into the binary and shown
        // in the footer. Let those disagree and you ship an installer whose
        // filename contradicts the app it installs.
        test('the bundle version matches the binary version', () => {
            const conf = JSON.parse(read('desktop', 'src-tauri', 'tauri.conf.json'));
            eq(conf.version, version,
                'tauri.conf.json (names the installer) vs Cargo.toml (compiled into the binary)');
        });

        test('the version is a plain semver', () => {
            ok(/^\d+\.\d+\.\d+$/.test(version), `"${version}" is major.minor.patch`);
        });

        // A hardcoded "vX.Y.Z" is right the day it is written and wrong
        // forever after — unless the app has a web build, which has no binary
        // to ask, in which case the markup carries it and the check becomes
        // "does it still agree".
        if (markup === 'none') {
            test('no version string is hardcoded into the markup', () => {
                for (const page of pages) {
                    const html = read('app', 'ui', page);
                    const hits = html.match(/v\d+\.\d+\.\d+/g) || [];
                    eq(hits, [], `${page} states no version — it asks the binary instead`);
                }
            });
        } else {
            test('the version in the markup matches the binary version', () => {
                for (const page of pages) {
                    const html = read('app', 'ui', page);
                    const hits = [...new Set(html.match(/v\d+\.\d+\.\d+/g) || [])];
                    for (const hit of hits) {
                        eq(hit, `v${version}`,
                            `${page} carries the version for the web build, which has no binary to ask`);
                    }
                }
            });
        }

        if (slotId) {
            test('the footer has somewhere to put the version it fetches', () => {
                ok(read('app', 'ui', pages[0]).includes(`id="${slotId}"`), 'the slot exists');
            });
        }

        // The npm manifests are build tooling. Nothing publishes them and
        // nothing reads their version, so they are NOT asserted against
        // Cargo.toml. Stated here so the next person does not "fix" the
        // inconsistency by wiring them together.
        test('the npm manifests are private build tooling, not a version source', () => {
            for (const p of manifests) {
                const pkg = JSON.parse(read(...p));
                eq(pkg.private, true, `${p.join('/')} is private, so its version is never published`);
            }
        });
    };
}
