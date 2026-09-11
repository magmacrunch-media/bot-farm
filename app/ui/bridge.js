// bridge.js — the app's command catalog over the kit's Tauri substrate.
//
// kit/bridge-core.js decided whether a backend exists; when it did not,
// MagmaKit.tauri is undefined, BotFarm.fs stays undefined too, and that
// absence is the whole feature switch — the page reads fixtures instead.
//
// This file is the ONLY place a Rust command is named. Everything here is
// plumbing; what a bot IS lives in core/.

(function () {
    'use strict';

    window.BotFarm = window.BotFarm || {};

    const T = window.MagmaKit && window.MagmaKit.tauri;
    if (!T) return;

    T.suppressContextMenu();

    window.BotFarm.fs = {
        // ── files ────────────────────────────────────────────
        readText: (path) => T.invoke('read_text', { path }),
        writeText: (path, contents) => T.invoke('write_text', { path, contents }),
        exists: (path) => T.invoke('exists', { path }),

        // ── config / lifecycle ───────────────────────────────
        configDir: () => T.invoke('config_dir'),
        appVersion: () => T.invoke('app_version'),
        quit: () => T.invoke('quit'),

        // ── the log file ─────────────────────────────────────
        // Fire-and-forget: a failure to log must never become a failure to run.
        logLine: (kind, message, detail) =>
            T.invoke('log_line', { kind, message, detail: detail === undefined ? null : String(detail) })
                .catch(() => {}),
        logPath: () => T.invoke('log_path'),
    };

    // ── the farm's feeds and chores ──────────────────────────
    //
    // Every one of these shells out or reaches the network from the Rust
    // side, which is where the allowlists live: gh_api only accepts paths
    // under the org, task names are validated, and open_url opens GitHub and
    // nothing else. The webview never holds a token and the CSP never lets
    // it reach the network itself.
    window.BotFarm.farm = {
        ghApi: (path) => T.invoke('gh_api', { path }),
        ghWorkflow: (action, repo, file) => T.invoke('gh_workflow', { action, repo, file }),
        tasksList: () => T.invoke('tasks_list'),
        taskAction: (action, name) => T.invoke('task_action', { action, name }),
        probe: (name) => T.invoke('probe', { name }),
        openUrl: (url) => T.invoke('open_url', { url }),
        confirm: (message, title) => T.dialog('ask', { message, title: title || 'BOT//FARM' }),
    };
}());
