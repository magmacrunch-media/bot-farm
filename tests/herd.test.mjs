import { test, eq, ok } from './kit/assert.mjs';

export default function (M) {
    const H = M.herd;

    test('every default bot is a valid record', () => {
        for (const b of H.DEFAULT) eq(H.problems(b), [], `${b.id}`);
    });

    test('ids are unique', () => {
        const ids = H.DEFAULT.map((b) => b.id);
        eq(new Set(ids).size, ids.length, 'duplicate id in DEFAULT');
    });

    test('every field is drawn and every bot lands in one', () => {
        const groups = H.byField(H.DEFAULT);
        eq(groups.map((g) => g.field.id), H.FIELDS.map((f) => f.id), 'fields in order');
        const placed = groups.reduce((n, g) => n + g.bots.length, 0);
        eq(placed, H.DEFAULT.length, 'every bot in exactly one field');
        for (const g of groups) ok(g.bots.length > 0, `${g.field.id} has bots`);
    });

    test('the Pi bots are watched by commit and fed by workflow', () => {
        for (const b of H.DEFAULT.filter((x) => x.field === 'coop' && x.source.kind === 'commit')) {
            ok(b.feed && b.feed.kind === 'workflow', `${b.id} is fed through its workflow_dispatch`);
            ok(b.stale > 0, `${b.id} has a stale window`);
        }
    });

    test('bots that leave no trace say why', () => {
        for (const b of H.DEFAULT.filter((x) => x.source.kind === 'none')) {
            ok(b.source.why, `${b.id} explains its silence`);
            ok(!b.stale, `${b.id} cannot be hungry — nothing could ever feed it`);
        }
    });

    test('no source carries a URL — webhooks are named, not held', () => {
        const withUrl = (s) => H.problems({ id: 'x', name: 'X', species: 'pigeon', field: 'dovecote', source: s });
        ok(withUrl({ kind: 'webhook', webhook: 'a', url: 'https://discord.com/api/webhooks/1/tok' })
            .some((p) => p.includes('may not carry a URL')), 'a herd.json cannot smuggle one in');
        ok(withUrl({ kind: 'webhook', webhook: 'a', webhookUrl: 'https://discord.com/api/webhooks/1/tok' })
            .some((p) => p.includes('may not carry a URL')), 'nor under another name');
        eq(withUrl({ kind: 'webhook', webhook: 'a' }), []);
        for (const b of H.DEFAULT) {
            ok(!b.source.url && !b.source.webhookUrl, `${b.id} names its source, it does not hold it`);
        }
    });

    test('the journal and webhook sources name what they read', () => {
        eq(H.problems({ id: 'x', name: 'X', species: 'dog', field: 'barn', source: { kind: 'journal' } }),
            ['journal source needs journal']);
        eq(H.problems({ id: 'x', name: 'X', species: 'pigeon', field: 'dovecote', source: { kind: 'webhook' } }),
            ['webhook source needs webhook']);
    });

    test('problems() names each thing wrong', () => {
        const p = H.problems({ id: 'Bad Id', species: 'dragon', field: 'moon', source: { kind: 'magic' }, feed: {}, stale: -1 });
        ok(p.some((x) => x.includes('kebab')), 'id');
        ok(p.some((x) => x.includes('name')), 'name');
        ok(p.some((x) => x.includes('species')), 'species');
        ok(p.some((x) => x.includes('field')), 'field');
        ok(p.some((x) => x.includes('source.kind')), 'source');
        ok(p.some((x) => x.includes('feed.kind')), 'feed');
        ok(p.some((x) => x.includes('stale')), 'stale');
        eq(H.problems(null), ['not an object']);
        eq(H.problems({ id: 'x', name: 'X', species: 'cow', field: 'barn', source: { kind: 'workflow', repo: 'o/r' } }),
            ['workflow source needs repo and file']);
    });

    test('merge adds, replaces by id, and drops bad records with reasons', () => {
        const extra = { id: 'my-bot', name: 'My Bot', species: 'owl', field: 'barn', source: { kind: 'task', task: 'MyTask' } };
        const retune = Object.assign({}, H.DEFAULT[0], { stale: 999 });
        const bad = { id: 'nope' };
        const m = H.merge([extra, retune, bad]);
        eq(m.herd.length, H.DEFAULT.length + 1, 'one added, one replaced');
        eq(m.herd.find((b) => b.id === H.DEFAULT[0].id).stale, 999, 'replaced in place');
        eq(m.herd.findIndex((b) => b.id === H.DEFAULT[0].id), 0, 'replacement keeps its position');
        eq(m.dropped.length, 1);
        eq(m.dropped[0].record, bad);
        ok(m.dropped[0].problems.length > 0);
    });

    test('merge tolerates garbage', () => {
        eq(H.merge(undefined).herd.length, H.DEFAULT.length);
        eq(H.merge('not a list').herd.length, H.DEFAULT.length);
        eq(H.merge([null, 42]).dropped.length, 2);
    });

    test('DEFAULT is not mutated by merge', () => {
        const before = JSON.stringify(H.DEFAULT);
        H.merge([{ id: H.DEFAULT[1].id, name: 'Imposter', species: 'cat', field: 'stable', source: { kind: 'none' } }]);
        eq(JSON.stringify(H.DEFAULT), before);
    });
}
