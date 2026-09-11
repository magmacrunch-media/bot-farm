// app/kit/ and tests/kit/ are vendored byte-copies from magma-kit, shared
// byte-for-byte with every other app in the family. An edit made here instead
// of there is how two of those apps came to be forks of each other.
//
// This verifies them against app/kit/KIT.md, which the kit's sync.mjs wrote
// alongside them. It needs nothing but this repo, which is why it can live in
// `npm run check` — `npm run check:kit` asks the sharper question (am I behind
// the kit?) but needs the magma-kit checkout present, so it stays manual.

import { integritySuite } from './kit/kit-integrity.mjs';
import { test, eq, ok } from './kit/assert.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export default function () {
    integritySuite({ root: ROOT })(test, eq, ok);
}
