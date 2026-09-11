// Assertion helpers and the result tally. Separate from the runner so the
// suites can import them without forming a cycle with the runner that imports
// them.

export const results = { pass: 0, fail: 0, fails: [] };

export function test(name, fn) {
    try { fn(); results.pass++; }
    catch (e) {
        results.fail++;
        results.fails.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`);
    }
}

/* The async variant, for suites whose subject is async at the seams. Kept
   separate rather than making `test` async, so the synchronous suites stay
   synchronous and a forgotten await there is still a loud failure rather than
   a silent pass. */
test.async = async function (name, fn) {
    try { await fn(); results.pass++; }
    catch (e) {
        results.fail++;
        results.fails.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`);
    }
};

export function eq(actual, expected, what) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${what || 'value'}:\n      got ${a}\n      want ${b}`);
}

export function ok(cond, what) { if (!cond) throw new Error(what || 'expected truthy'); }

export function throws(fn, match, what) {
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    if (!threw) throw new Error(`${what || 'call'}: expected a throw, got none`);
    if (match && !threw.message.includes(match))
        throw new Error(`${what || 'call'}: message ${JSON.stringify(threw.message)} lacks ${JSON.stringify(match)}`);
}
