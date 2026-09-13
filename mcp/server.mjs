#!/usr/bin/env node
// mcp/server.mjs — the farm's readings as MCP tools.
//
// Two transports, one handler:
//
//   --stdio            for a client on this machine (the default)
//   --http [--host H]  for a client that is not (a Mac over Tailscale)
//
// Dependency-free, like tests/run.mjs: MCP over stdio is newline-delimited
// JSON-RPC 2.0 and over HTTP is a POST of the same, and a protocol small
// enough to read in one sitting is not worth a node_modules in a Tauri app.
//
// READ-ONLY. Two tools, both of which answer questions; the chores stay in the
// app, where each one confirms through a dialog and is written to the log. An
// MCP client has neither, so "let out the goat" is not on offer here.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findCli, cliFarm, walk } from './walk.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PROTOCOL = '2025-06-18';
const KNOWN_PROTOCOLS = new Set([PROTOCOL, '2025-03-26', '2024-11-05']);

/** Cargo.toml is the one version source (see AGENTS.md); never a literal. */
function version() {
    const toml = readFileSync(join(ROOT, 'desktop', 'src-tauri', 'Cargo.toml'), 'utf8');
    const m = toml.match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : '0.0.0';
}

/* ── the walk, cached ────────────────────────────────────────
 *
 * A walk is a dozen `gh` calls and two HTTP probes — seconds, not
 * milliseconds. A client that asks three questions in a row should not make
 * the farm run three times, and GitHub should not see three bursts, so a
 * reading is reused for a short while and its age is always stated. Anything
 * that says how things ARE says when it looked.
 */

const TTL_MS = 60 * 1000;

function farmSource(cli) {
    const farm = cliFarm(cli);
    let cached = null;
    let inflight = null;
    return async function reading(refresh) {
        const now = Date.now();
        if (!refresh && cached && now - cached.at < TTL_MS) return cached;
        if (inflight) return inflight;
        inflight = walk(farm, Date.now())
            .then((r) => { cached = r; return r; })
            .finally(() => { inflight = null; });
        return inflight;
    };
}

/* ── rendering ───────────────────────────────────────────────
 *
 * The text is the answer. Structured JSON rides along for a client that wants
 * to filter, but a model reading only the text must get the whole farm, and
 * must not be able to mistake UNKNOWN for fine — which is why every state is
 * spelled out rather than reduced to an ok/not-ok.
 */

function pad(s, n) { return String(s).padEnd(n, ' '); }

function agoWords(ms) {
    const s = Math.round(ms / 1000);
    if (s < 5) return 'just now';
    if (s < 90) return `${s}s ago`;
    return `${Math.round(s / 60)}m ago`;
}

function header(r, now) {
    return `BOT//FARM · ${r.report}\nwalked ${agoWords(now - r.at)} on MC1 · live`;
}

function botLine(b) {
    return `  ${pad(b.label, 8)} ${pad(b.id, 22)} ${b.name} — ${b.line}`;
}

function render(r, now, bots) {
    const out = [header(r, now), ''];
    for (const f of r.fields) {
        const own = bots.filter((b) => b.field === f.id);
        if (!own.length) continue;
        out.push(`${f.name} — ${f.tag}`);
        for (const b of own) out.push(botLine(b));
        out.push('');
    }
    if (!bots.length) out.push('(nothing matched)', '');

    const errs = Object.entries(r.errors || {});
    if (errs.length) {
        out.push(`${errs.length} feed(s) did not load — the bots they would have`,
            'spoken for read UNKNOWN rather than healthy:');
        for (const [k, v] of errs) out.push(`  ${k} — ${v}`);
        out.push('');
    }
    for (const d of r.dropped || []) {
        out.push(`herd.json: dropped ${JSON.stringify(d.record).slice(0, 80)} — ${d.problems.join('; ')}`);
    }
    return out.join('\n').trimEnd();
}

function renderBot(r, now, b) {
    return [
        `${b.label} — ${b.name} (${b.id})`,
        '',
        `field     ${b.field}`,
        `does      ${b.does}`,
        `cadence   ${b.cadence || '—'}`,
        `reading   ${b.detail}`,
        `last seen ${b.when || 'never'}`,
        b.url ? `look at   ${b.url}` : null,
        '',
        `walked ${agoWords(now - r.at)} on MC1.`,
    ].filter((l) => l !== null).join('\n');
}

/* ── tools ───────────────────────────────────────────────── */

const STATES = ['grazing', 'working', 'hungry', 'sick', 'asleep', 'strayed', 'unknown'];
const FIELDS = ['pasture', 'coop', 'barn', 'stable', 'dovecote'];

const TOOLS = [
    {
        name: 'farm_status',
        title: 'Walk the farm',
        description:
            'Every bot MC1 watches — GitHub Actions workflows, the Pi cron bots, this '
            + "machine's scheduled tasks, the self-hosted runners and the Discord webhooks "
            + '— with the state each one is in: GRAZING (last run succeeded), WORKING '
            + '(running now), HUNGRY (overdue), SICK (failed or unreachable), ASLEEP '
            + '(disabled on purpose), STRAYED (gone from its feed) or UNKNOWN (nothing to '
            + 'go on — never treat as healthy). Readings are cached for a minute and their '
            + 'age is stated.',
        inputSchema: {
            type: 'object',
            properties: {
                field: { type: 'string', enum: FIELDS, description: 'only this field' },
                state: { type: 'string', enum: STATES, description: 'only bots in this state' },
                refresh: { type: 'boolean', description: 'walk again rather than reuse a cached reading' },
            },
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    },
    {
        name: 'farm_bot',
        title: 'One bot',
        description: 'Everything known about one bot by id, including where to go and look.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'the bot id, e.g. bot-status' },
                refresh: { type: 'boolean' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    },
];

export async function callTool(reading, name, args) {
    const a = args || {};
    if (name === 'farm_status') {
        const r = await reading(a.refresh === true);
        const now = Date.now();
        let bots = r.bots;
        if (a.field) bots = bots.filter((b) => b.field === a.field);
        if (a.state) bots = bots.filter((b) => b.state === a.state);
        return {
            content: [{ type: 'text', text: render(r, now, bots) }],
            structuredContent: { at: r.at, tally: r.tally, report: r.report, bots, errors: r.errors },
        };
    }
    if (name === 'farm_bot') {
        const r = await reading(a.refresh === true);
        const b = r.bots.find((x) => x.id === a.id);
        if (!b) {
            const ids = r.bots.map((x) => x.id).join(', ');
            return {
                content: [{ type: 'text', text: `No bot called "${a.id}". The herd is: ${ids}` }],
                isError: true,
            };
        }
        return {
            content: [{ type: 'text', text: renderBot(r, Date.now(), b) }],
            structuredContent: b,
        };
    }
    throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
}

/* ── JSON-RPC ────────────────────────────────────────────── */

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** One message in, one response out, or null for a notification. */
export async function handle(msg, ctx) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        return err(msg && msg.id !== undefined ? msg.id : null, -32600, 'not a JSON-RPC 2.0 request');
    }
    const { id, method, params } = msg;
    const notification = id === undefined || id === null;

    switch (method) {
        case 'initialize': {
            const want = params && params.protocolVersion;
            return ok(id, {
                protocolVersion: KNOWN_PROTOCOLS.has(want) ? want : PROTOCOL,
                capabilities: { tools: {} },
                serverInfo: { name: 'bot-farm', title: 'BOT//FARM', version: ctx.version },
                instructions:
                    'Read-only. UNKNOWN means nothing could be seen, not that a bot is '
                    + 'fine; say so rather than smoothing it over. Chores (feed, pen, let '
                    + 'out) live in the desktop app and are not available here.',
            });
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
            return null;
        case 'ping':
            return notification ? null : ok(id, {});
        case 'tools/list':
            return ok(id, { tools: TOOLS });
        case 'tools/call': {
            const name = params && params.name;
            try {
                return ok(id, await callTool(ctx.reading, name, params && params.arguments));
            } catch (e) {
                if (e && e.code === -32602) return err(id, -32602, e.message);
                // A walk that failed outright is a tool error, not a protocol
                // error: the client should see why and be able to ask again.
                return ok(id, {
                    content: [{ type: 'text', text: `Could not walk the farm: ${(e && e.message) || e}` }],
                    isError: true,
                });
            }
        }
        default:
            return notification ? null : err(id, -32601, `method not found: ${method}`);
    }
}

/** A single message or a batch. */
async function handleAny(payload, ctx) {
    if (Array.isArray(payload)) {
        if (!payload.length) return err(null, -32600, 'empty batch');
        const out = (await Promise.all(payload.map((m) => handle(m, ctx)))).filter(Boolean);
        return out.length ? out : null;
    }
    return handle(payload, ctx);
}

/* ── transports ──────────────────────────────────────────── */

function serveStdio(ctx) {
    const rl = createInterface({ input: process.stdin });
    // A walk takes seconds, and stdin can close inside one — a client that
    // exits, or a pipe that had a fixed number of lines in it. Exiting on
    // `close` alone drops the answer to a question already asked, so the
    // pending ones are drained first.
    const pending = new Set();
    rl.on('line', (line) => {
        const text = line.trim();
        if (!text) return;
        let payload;
        try { payload = JSON.parse(text); } catch {
            process.stdout.write(JSON.stringify(err(null, -32700, 'parse error')) + '\n');
            return;
        }
        const job = handleAny(payload, ctx)
            .then((res) => { if (res) process.stdout.write(JSON.stringify(res) + '\n'); })
            .finally(() => pending.delete(job));
        pending.add(job);
    });
    rl.on('close', async () => {
        while (pending.size) await Promise.all([...pending]);
        process.exit(0);
    });
}

function readBody(req, limit = 4 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let n = 0;
        const chunks = [];
        req.on('data', (c) => {
            n += c.length;
            if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function serveHttp(ctx, { host, port, token }) {
    // charset spelled out: JSON is UTF-8 by specification, but a client that
    // does not know that falls back to Latin-1 and turns every em dash and
    // middle dot in a farm report into mojibake. Windows PowerShell 5.1 is one
    // such client, and it is the one nearest to hand here.
    const send = (res, code, body, type = 'application/json; charset=utf-8') => {
        const s = typeof body === 'string' ? body : JSON.stringify(body);
        res.writeHead(code, { 'content-type': type, 'content-length': Buffer.byteLength(s) });
        res.end(s);
    };

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        // Unauthenticated and deliberately empty of farm data. MC1 sleeps and
        // wakes all day (see the tree's CLAUDE.md), so "is it up at all?" is a
        // question worth being able to ask without a credential.
        if (req.method === 'GET' && url.pathname === '/health') {
            return send(res, 200, { ok: true, name: 'bot-farm', version: ctx.version });
        }

        if (token) {
            const got = String(req.headers.authorization || '');
            const want = `Bearer ${token}`;
            if (got.length !== want.length || got !== want) {
                return send(res, 401, { error: 'unauthorized' });
            }
        }
        if (url.pathname !== '/mcp') return send(res, 404, { error: 'not found; POST /mcp' });
        if (req.method === 'DELETE') return send(res, 204, '');
        if (req.method !== 'POST') {
            // No server-initiated stream: every response answers a POST.
            return send(res, 405, { error: 'POST /mcp' });
        }

        let payload;
        try { payload = JSON.parse(await readBody(req)); } catch (e) {
            return send(res, 400, err(null, -32700, `parse error: ${e.message}`));
        }
        const out = await handleAny(payload, ctx);
        if (!out) return send(res, 202, '');
        return send(res, 200, out);
    });

    server.listen(port, host, () => {
        process.stderr.write(`bot-farm MCP on http://${host}:${port}/mcp${token ? ' (token required)' : ''}\n`);
    });
    return server;
}

/* ── startup ─────────────────────────────────────────────── */

function loopback(host) {
    return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function parseArgs(argv) {
    // 8787 because the neighbours are taken: 8784 is the Pi's status feeder
    // (see PROBES in farm.rs) and 8785/8786 are portproxies into WSL on this
    // machine, which hold 0.0.0.0 through svchost and fail a bind with EACCES
    // rather than the EADDRINUSE you would expect.
    const opts = { mode: 'stdio', host: '127.0.0.1', port: 8787, token: (process.env.BOT_FARM_MCP_TOKEN || '').trim() };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--stdio') opts.mode = 'stdio';
        else if (a === '--http') opts.mode = 'http';
        else if (a === '--host') opts.host = argv[++i];
        else if (a === '--port') opts.port = Number(argv[++i]);
        else if (a === '--token') opts.token = String(argv[++i] || '').trim();
        else throw new Error(`unknown option: ${a}`);
    }
    if (opts.mode === 'http') {
        if (!opts.host) throw new Error('--host needs a value');
        if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
            throw new Error('--port needs a port number');
        }
    }
    return opts;
}

/**
 * The last word on whether this is safe to serve, after the token has had
 * every chance to arrive.
 *
 * A farm reading names every bot this family runs and which of them are down.
 * On the tailnet that is fine behind a token and not fine without one, and the
 * mistake is too easy to make to leave to a README.
 */
export function checkBind(opts) {
    if (opts.mode !== 'http') return opts;
    if (!loopback(opts.host) && !opts.token) {
        throw new Error(
            `refusing to serve ${opts.host} without a token — pass --token, set `
            + `BOT_FARM_MCP_TOKEN, put one in ${TOKEN_FILE} beside herd.json, or bind 127.0.0.1`,
        );
    }
    return opts;
}

const TOKEN_FILE = 'mcp-token';

/** A token kept where webhooks.json is kept: config, not repo, and never on a
 *  command line where another process could read it. */
async function tokenFromConfig(farm) {
    try {
        const dir = await farm.configDir();
        if (!dir) return '';
        return readFileSync(join(dir, TOKEN_FILE), 'utf8').trim();
    } catch { return ''; }
}

async function main() {
    try {
        const opts = parseArgs(process.argv.slice(2));
        const cli = findCli();
        const farm = cliFarm(cli);
        if (!opts.token) opts.token = await tokenFromConfig(farm);
        checkBind(opts);
        const ctx = { version: version(), reading: farmSource(cli) };
        if (opts.mode === 'http') serveHttp(ctx, opts);
        else serveStdio(ctx);
    } catch (e) {
        process.stderr.write(`${(e && e.message) || e}\n`);
        process.exit(2);
    }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
    main();
}
