import { versionSuite } from './kit/versions.mjs';
import { test, eq, ok } from './kit/assert.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export default function () {
    versionSuite({ root: ROOT })(test, eq, ok);
}
