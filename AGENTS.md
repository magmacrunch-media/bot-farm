# BOT//FARM — conventions

## Architecture

```
app/          the entire shipped frontend; Tauri's frontendDist
  kit/        VENDORED from magma-kit — GENERATED, do not edit here
  shell/      VENDORED chrome from magmacrunch.com ware/shell
  core/       pure logic: no DOM, no fetch, no Tauri. Tested in Node
  ui/         the DOM and IPC layer
  fonts/      self-hosted (CSP font-src 'self')
desktop/      the Tauri shell only
tests/        dependency-free runner
  kit/        VENDORED from magma-kit — GENERATED, do not edit here
```

## Classic scripts, not ES modules — deliberate, do not convert

Everything in app/ is a classic script attaching to `window.BotFarm`. The
website is buildless and busts caches by stamping `?v=<hash>` onto
`<script src>` tags; an `import` specifier inside a .js file is invisible to
that stamper, so an ES-module core/ would sit behind stale caches with no way
to force a refresh.

Load order in `app/ui/index.html` IS the dependency order, and `tests/run.mjs`
asserts it. `kit/boot.js` is first — it exists to report failures in
everything after it.

## The vendored directories

`app/kit/` and `tests/kit/` come from the sibling magma-kit checkout:

```
npm run sync-kit     # re-vendor
npm run check:kit    # verify nothing drifted
```

Never edit them here — edit magma-kit and re-sync. `app/shell/` comes from the
website repo's `ware/shell/` by byte-copy (see its README); `fonts.css` is the
one file that is deliberately forked, because `url()` resolves against the
stylesheet and `var()` cannot interpolate into it.

## Desktop vs web

`kit/bridge-core.js` detects `window.__TAURI_INTERNALS__` — never a user agent
— and the ABSENCE of `BotFarm.fs` is the feature switch: the same files run
in a plain browser with the desktop-only panels hidden. It also sets
`html.desktop`, which is how CSS drops the shell's website-only chrome.

`@tauri-apps/cli` is pinned to an EXACT version because the kit's bridge rides
`transformCallback`, a Tauri internal. Keep it in step with the other apps.

## Permissions

`capabilities/default.json` grants `core:default` plus the dialog plugin, and
nothing else. Every file operation is a named command in `src/lib.rs` over
`magma_kit::fs` — a named command is a smaller surface than a plugin scope,
and the paths stay explicit.

## The version lives in four places

Cargo.toml is the truth (it is `CARGO_PKG_VERSION`, what the binary reports).
`tauri.conf.json` must match — it names the installer. The two package.json
files are private build tooling and are NOT a version source. The footer asks
the binary; never hardcode a version in markup. `tests/version.test.mjs`
enforces all of this.

## Git

Commit as magmacrunch media <magmacrunchmedia@gmail.com>. No AI attribution.
