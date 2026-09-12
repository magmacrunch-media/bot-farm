//! The chores: everything the webview may ask this side to do that a browser
//! tab could not — run `gh`, read and poke scheduled tasks, probe HTTP
//! endpoints, read a bot's own journal, open a link.
//!
//! Every function here sits behind an allowlist, and the allowlists are the
//! point. The webview never holds a token (gh's keyring does), never names a
//! URL (only a probe, journal or webhook name, or a GitHub path under the
//! org), never learns a webhook URL even for a webhook it asked about, and
//! never sees a line of the Historian's conversation; and it never passes
//! anything shell-shaped: task names and workflow files are validated against
//! a character set before they go anywhere near a command line. A compromised
//! page could feed a workflow early; it could not read a secret or run a
//! program.
//!
//! Plain functions, no tauri types, so `cargo test` covers the validators
//! without a window.

use serde_json::{json, Value};
use std::process::Command;
use std::time::Duration;

/// The org every GitHub call is confined to.
pub const ORG: &str = "magmacrunch-media";

/// Where the readings come from. Names, never URLs, cross the bridge.
const PROBES: &[(&str, &str)] = &[
    ("ollama", "http://localhost:11434/api/tags"),
    ("pi-status", "http://100.74.172.4:8784/status.json"),
];

/// The journals a long-running bot writes about itself: (name, environment
/// override, default directory, the events that may be read).
///
/// The event list is an allowlist and not a convenience. The Historian's
/// journal records every message anybody sends it; the three lines below are
/// the ones that say whether it can answer at all, and nothing else needs to
/// leave this process.
const JOURNALS: &[(&str, &str, &str, &[&str])] = &[(
    "historian",
    "HISTORIAN_JOURNAL_DIR",
    r"C:\magma\dev\magmacrunch\apps\historian-tui\data\journal",
    &["discord_ready", "ollama_ready", "ollama_unreachable"],
)];

/// How many days back to look for a startup line. A bot that has been up for
/// a week wrote its `discord_ready` a week ago and has said nothing since.
const JOURNAL_DAYS: usize = 14;

/// Never read more than this from one journal file; the tail is what matters.
const JOURNAL_TAIL: usize = 512 * 1024;

/// The Discord webhooks, by name and by where this machine's copy of the URL
/// would be found. A webhook URL is a bearer credential: it is not in the
/// herd, it is not returned to the webview, and it is not written to the log.
/// A name that resolves to nothing reads UNKNOWN, which is the truth — the
/// webhook may be perfectly alive somewhere this machine cannot see.
const WEBHOOKS: &[(&str, &str)] = &[
    ("alerts-pi", "BOT_FARM_WEBHOOK_ALERTS_PI"),
    ("alerts-actions", "BOT_FARM_WEBHOOK_ALERTS_ACTIONS"),
    ("scores-ops", "BOT_FARM_WEBHOOK_SCORES_OPS"),
];

/// The only thing a resolved webhook is allowed to be.
const WEBHOOK_PREFIX: &str = "https://discord.com/api/webhooks/";

// ── process plumbing ────────────────────────────────────────

/// On Windows a child console program flashes a window unless told not to.
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Run and return stdout; a non-zero exit becomes an error carrying stderr,
/// named by the program and its first argument so "gh api: HTTP 404" reads
/// differently from "gh workflow: not signed in".
fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    quiet(&mut cmd);
    let out = cmd.output().map_err(|e| format!("{program}: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if err.is_empty() { stdout.trim().to_string() } else { err };
        let first = args.first().copied().unwrap_or("");
        return Err(format!("{program} {first}: {}", one_line(&msg)));
    }
    Ok(stdout)
}

fn one_line(s: &str) -> String {
    let line = s.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    if line.len() > 200 { format!("{}…", &line[..200]) } else { line.to_string() }
}

/// `gh` is on PATH for a shell; a GUI app launched from a shortcut may have
/// a thinner one, so fall back to where the installer puts it.
fn gh() -> &'static str {
    #[cfg(windows)]
    {
        if Command::new("gh").arg("--version").output().is_err() {
            return r"C:\Program Files\GitHub CLI\gh.exe";
        }
    }
    "gh"
}

// ── validators ──────────────────────────────────────────────

fn plain(s: &str, extra: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
}

/// A GitHub API path the farm may read: anything under the org's repos, or
/// a commit search scoped to one of them. Percent-encoding is allowed (the
/// search query arrives encoded); nothing that could climb or re-aim is.
pub fn valid_api_path(p: &str) -> bool {
    if !plain(p, "-_./?=&%+") || p.contains("..") || p.contains("//") {
        return false;
    }
    let under_org = p.starts_with(&format!("repos/{ORG}/"));
    let search = p.starts_with("search/commits?q=repo%3A")
        && p.contains(&format!("repo%3A{ORG}%2F"));
    under_org || search
}

pub fn valid_repo(r: &str) -> bool {
    match r.split_once('/') {
        Some((owner, name)) => owner == ORG && plain(name, "-_.") && !name.contains(".."),
        None => false,
    }
}

pub fn valid_workflow_file(f: &str) -> bool {
    plain(f, "-_.") && !f.contains("..") && (f.ends_with(".yml") || f.ends_with(".yaml"))
}

pub fn valid_task_name(n: &str) -> bool {
    plain(n, "-_")
}

// ── GitHub ──────────────────────────────────────────────────

pub fn gh_api(path: &str) -> Result<Value, String> {
    if !valid_api_path(path) {
        return Err(format!("refusing API path: {path}"));
    }
    let out = run(gh(), &["api", path])?;
    serde_json::from_str(&out).map_err(|e| format!("gh api {path}: {e}"))
}

pub fn gh_workflow(action: &str, repo: &str, file: &str) -> Result<String, String> {
    if !matches!(action, "run" | "enable" | "disable") {
        return Err(format!("unknown workflow action: {action}"));
    }
    if !valid_repo(repo) {
        return Err(format!("refusing repo: {repo}"));
    }
    if !valid_workflow_file(file) {
        return Err(format!("refusing workflow file: {file}"));
    }
    magma_kit::log::rs("farm", &format!("gh workflow {action} {file} -R {repo}"));
    run(gh(), &["workflow", action, file, "-R", repo]).map(|s| s.trim().to_string())
}

// ── scheduled tasks ─────────────────────────────────────────

fn powershell(script: &str) -> Result<String, String> {
    run(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    )
}

/// The root-folder tasks, dates as ISO-8601 UTC or null. `-InputObject @()`
/// keeps a single task an array rather than a bare object.
const LIST_SCRIPT: &str = r#"$ErrorActionPreference='Stop';
$list = @(Get-ScheduledTask -TaskPath '\' | ForEach-Object {
  $i = $_ | Get-ScheduledTaskInfo;
  $lr = $null; if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $lr = $i.LastRunTime.ToUniversalTime().ToString('o') };
  $nr = $null; if ($i.NextRunTime -and $i.NextRunTime.Year -gt 2000) { $nr = $i.NextRunTime.ToUniversalTime().ToString('o') };
  [pscustomobject]@{ name=$_.TaskName; state=[string]$_.State; enabled=[bool]$_.Settings.Enabled; lastRun=$lr; lastResult=[int64]$i.LastTaskResult; nextRun=$nr }
});
ConvertTo-Json -InputObject $list -Depth 3 -Compress"#;

pub fn tasks_list() -> Result<Value, String> {
    let out = powershell(LIST_SCRIPT)?;
    let v: Value = serde_json::from_str(out.trim()).map_err(|e| format!("tasks: {e}"))?;
    if v.is_array() { Ok(v) } else { Ok(json!([v])) }
}

pub fn task_action(action: &str, name: &str) -> Result<String, String> {
    let verb = match action {
        "start" => "Start-ScheduledTask",
        "enable" => "Enable-ScheduledTask",
        "disable" => "Disable-ScheduledTask",
        _ => return Err(format!("unknown task action: {action}")),
    };
    if !valid_task_name(name) {
        return Err(format!("refusing task name: {name}"));
    }
    magma_kit::log::rs("farm", &format!("{verb} {name}"));
    // The name is validated to [A-Za-z0-9_-], so the single quotes cannot be
    // escaped from; PowerShell treats the literal as data.
    let script = format!("$ErrorActionPreference='Stop'; {verb} -TaskName '{name}' | Out-Null; 'ok'");
    powershell(&script).map(|s| s.trim().to_string())
}

// ── probes ──────────────────────────────────────────────────

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `{ ok, at, detail }` — never an Err: an unreachable probe is a reading,
/// and the reading is "unreachable".
pub fn probe(name: &str) -> Result<Value, String> {
    let Some((_, url)) = PROBES.iter().find(|(n, _)| *n == name) else {
        return Err(format!("unknown probe: {name}"));
    };
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(4))
        .timeout_read(Duration::from_secs(6))
        .build();
    let body = match agent.get(url).call().and_then(|r| r.into_string().map_err(ureq::Error::from)) {
        Ok(b) => b,
        Err(e) => return Ok(json!({ "ok": false, "at": null, "detail": one_line(&e.to_string()) })),
    };
    let v: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => return Ok(json!({ "ok": false, "at": null, "detail": format!("not JSON: {e}") })),
    };
    Ok(match name {
        "ollama" => {
            let n = v["models"].as_array().map(|a| a.len()).unwrap_or(0);
            json!({ "ok": true, "at": now_ms(), "detail": format!("{n} model{}", if n == 1 { "" } else { "s" }) })
        }
        _ => {
            // pi-status: the feeder's own timestamp is the evidence.
            let ts = v["timestamp"].as_u64().unwrap_or(0);
            let services = v["pi"]["services"].as_object();
            let (active, total) = services
                .map(|m| (m.values().filter(|s| s == &"active").count(), m.len()))
                .unwrap_or((0, 0));
            json!({
                "ok": ts > 0,
                "at": if ts > 0 { Value::from(ts * 1000) } else { Value::Null },
                "detail": format!("feeder wrote status.json; {active}/{total} arcade services active"),
            })
        }
    })
}

// ── journals ────────────────────────────────────────────────

/// Keep a journal field only if it cannot carry what somebody said. `text` is
/// the field the conversation lives in; everything else is short and factual,
/// and truncating guards against a long error string all the same.
fn sanitize(record: &Value) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(obj) = record.as_object() {
        for (k, v) in obj {
            if k == "text" {
                continue;
            }
            out.insert(
                k.clone(),
                match v.as_str() {
                    Some(s) if s.chars().count() > 200 => {
                        Value::from(s.chars().take(200).collect::<String>())
                    }
                    _ => v.clone(),
                },
            );
        }
    }
    Value::Object(out)
}

/// The last `cap` bytes of a file, starting at a line boundary.
fn tail(path: &std::path::Path, cap: usize) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let slice = if bytes.len() > cap {
        let start = bytes.len() - cap;
        match bytes[start..].iter().position(|b| *b == b'\n') {
            Some(i) => &bytes[start + i + 1..],
            None => &bytes[start..],
        }
    } else {
        &bytes[..]
    };
    Ok(String::from_utf8_lossy(slice).into_owned())
}

fn mtime_ms(path: &std::path::Path) -> Option<u64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// `{ found, dir, file, at, events }` — the newest record of each allowlisted
/// event, searched backwards through the last `JOURNAL_DAYS` files.
///
/// Never an Err except for a name that is not in the table: a missing journal
/// directory is a reading, and the reading is that the bot has never written
/// one.
pub fn journal(name: &str) -> Result<Value, String> {
    let Some((_, env_var, default_dir, events)) = JOURNALS.iter().find(|(n, ..)| *n == name) else {
        return Err(format!("unknown journal: {name}"));
    };
    let dir = std::env::var(env_var).unwrap_or_else(|_| (*default_dir).to_string());
    let dir = std::path::Path::new(&dir);
    if !dir.is_dir() {
        return Ok(json!({
            "found": false,
            "dir": dir.display().to_string(),
            "detail": format!("no journal directory at {}", dir.display()),
        }));
    }

    // The files are date-named, so the name sorts as the day does.
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "jsonl").unwrap_or(false))
        .collect();
    files.sort();
    files.reverse();

    if files.is_empty() {
        return Ok(json!({
            "found": false,
            "dir": dir.display().to_string(),
            "detail": "journal directory is empty",
        }));
    }

    let newest = files[0].clone();
    let mut found = serde_json::Map::new();
    for path in files.iter().take(JOURNAL_DAYS) {
        if found.len() == events.len() {
            break;
        }
        let Ok(body) = tail(path, JOURNAL_TAIL) else { continue };
        // Backwards, so the first hit for an event is its latest.
        for line in body.lines().rev() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(rec) = serde_json::from_str::<Value>(line) else { continue };
            let Some(event) = rec["event"].as_str() else { continue };
            if events.contains(&event) && !found.contains_key(event) {
                found.insert(event.to_string(), sanitize(&rec));
            }
        }
    }

    Ok(json!({
        "found": true,
        "dir": dir.display().to_string(),
        "file": newest.file_name().map(|f| f.to_string_lossy().into_owned()),
        "at": mtime_ms(&newest),
        "events": Value::Object(found),
    }))
}

// ── webhooks ────────────────────────────────────────────────

/// The reading for a webhook that could not be reached at all.
///
/// Fixed text, and that is the point: ureq's own error Display embeds the URL
/// it was handed, so stringifying a transport error here would write the
/// credential into the window and into the log file. There is nothing in that
/// string the farm needs — "could not reach Discord" is the whole reading.
fn unreachable_reading() -> Value {
    json!({ "known": true, "ok": false, "at": now_ms(), "detail": "could not reach Discord" })
}

/// This machine's copy of a webhook URL, or None. Environment first so a
/// shell can override without editing a file; then `webhooks.json` in the
/// config directory, `{ "<name>": "<url>" }`.
fn webhook_url(name: &str, env_var: &str, secrets: Option<&str>) -> Option<String> {
    if let Ok(v) = std::env::var(env_var) {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return Some(v);
        }
    }
    let path = secrets?;
    let body = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&body).ok()?;
    let url = v.get(name)?.as_str()?.trim().to_string();
    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

/// `{ known, ok, at, detail, name }` for one named webhook.
///
/// The URL goes out and nothing about it comes back. Discord answers a GET on
/// a live webhook with its own name and channel, and a revoked one with 401
/// "Invalid Webhook Token" or 404 "Unknown Webhook" — which is the whole
/// reading. A transport error is reported WITHOUT the error's own text,
/// because ureq puts the URL it was given into that string and the URL is the
/// credential.
pub fn webhook(name: &str, secrets: Option<&str>) -> Result<Value, String> {
    let Some((_, env_var)) = WEBHOOKS.iter().find(|(n, _)| *n == name) else {
        return Err(format!("unknown webhook: {name}"));
    };
    let Some(url) = webhook_url(name, env_var, secrets) else {
        return Ok(json!({
            "known": false,
            "detail": format!("no local copy — set {env_var}, or add \"{name}\" to webhooks.json"),
        }));
    };
    if !url.starts_with(WEBHOOK_PREFIX) {
        return Ok(json!({
            "known": true,
            "ok": false,
            "at": now_ms(),
            "detail": "the configured value is not a Discord webhook URL",
        }));
    }

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(4))
        .timeout_read(Duration::from_secs(6))
        .build();
    match agent.get(&url).call() {
        Ok(resp) => {
            let body = resp.into_string().unwrap_or_default();
            let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            let hook = v["name"].as_str().unwrap_or("").to_string();
            Ok(json!({
                "known": true,
                "ok": true,
                "at": now_ms(),
                "name": if hook.is_empty() { Value::Null } else { Value::from(hook.clone()) },
                "detail": if hook.is_empty() {
                    "Discord accepts it".to_string()
                } else {
                    format!("Discord answers for \"{hook}\"")
                },
            }))
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            let why = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v["message"].as_str().map(|s| one_line(s)))
                .unwrap_or_default();
            Ok(json!({
                "known": true,
                "ok": false,
                "at": now_ms(),
                "detail": if why.is_empty() {
                    format!("Discord refuses it: HTTP {code}")
                } else {
                    format!("Discord refuses it: {code} {why}")
                },
            }))
        }
        // Deliberately not `e.to_string()`: ureq embeds the URL in it.
        Err(_) => Ok(unreachable_reading()),
    }
}

// ── links ───────────────────────────────────────────────────

pub fn open_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://github.com/") || url.contains(|c: char| c.is_whitespace() || c == '"' || c == '\'') {
        return Err(format!("refusing to open: {url}"));
    }
    open::that(url).map_err(|e| format!("open {url}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_paths_stay_under_the_org() {
        assert!(valid_api_path("repos/magmacrunch-media/magmacrunch.com/actions/runners"));
        assert!(valid_api_path("repos/magmacrunch-media/magmacrunch.com/actions/workflows/bot-status.yml/runs?per_page=1"));
        assert!(valid_api_path("search/commits?q=repo%3Amagmacrunch-media%2Fmagmacrunch.com%20%22Update%20TMDB%20cache%22&sort=author-date&order=desc&per_page=5"));
        for bad in [
            "",
            "user",
            "repos/someone-else/repo",
            "repos/magmacrunch-media/../../user",
            "repos/magmacrunch-media//x",
            "https://evil.example/x",
            "search/commits?q=repo%3Asomeone%2Frepo",
            "search/code?q=repo%3Amagmacrunch-media%2Fx",
            "repos/magmacrunch-media/x;rm -rf",
            "repos/magmacrunch-media/x y",
        ] {
            assert!(!valid_api_path(bad), "should reject: {bad}");
        }
    }

    #[test]
    fn repos_and_files_are_plain() {
        assert!(valid_repo("magmacrunch-media/magmacrunch.com"));
        assert!(!valid_repo("magmacrunchmedia/magmacrunch.com"));
        assert!(!valid_repo("magmacrunch-media/"));
        assert!(!valid_repo("magmacrunch-media/a/b"));
        assert!(valid_workflow_file("bot-status.yml"));
        assert!(!valid_workflow_file("bot-status"));
        assert!(!valid_workflow_file("../x.yml"));
        assert!(!valid_workflow_file("x.yml -R other"));
    }

    #[test]
    fn task_names_cannot_escape_their_quotes() {
        assert!(valid_task_name("MagmaCrunchHistorianBot"));
        assert!(valid_task_name("SyncRepos"));
        assert!(!valid_task_name("x'; Remove-Item C:\\ -Recurse; '"));
        assert!(!valid_task_name("OneDrive Reporting Task"));
        assert!(!valid_task_name(""));
    }

    #[test]
    fn actions_are_named_not_passed_through() {
        assert!(gh_workflow("delete", "magmacrunch-media/x", "a.yml").is_err());
        assert!(task_action("stop", "SyncRepos").is_err());
        assert!(task_action("start", "Sync Repos").is_err());
        assert!(probe("http://evil.example").is_err());
    }

    #[test]
    fn links_open_github_only() {
        assert!(open_url("http://github.com/x").is_err());
        assert!(open_url("https://github.com.evil.example/x").is_err());
        assert!(open_url("https://github.com/x y").is_err());
    }

    // ── journals ────────────────────────────────────────────

    // Tests run in parallel and the environment is shared, so each test below
    // owns a different variable and no two touch the same one.

    #[test]
    fn journals_are_named_not_passed_through() {
        assert!(journal(r"C:\Users\magma\.ssh").is_err());
        assert!(journal("../../secrets").is_err());
        assert!(journal("").is_err());
        assert!(JOURNALS.iter().any(|(n, ..)| *n == "historian"), "the herd names it");
    }

    #[test]
    fn what_was_said_never_leaves_the_journal() {
        let rec = json!({
            "event": "discord_user",
            "text": "the thing somebody typed",
            "channel": "1540934838083915907",
        });
        let clean = sanitize(&rec);
        assert!(clean.get("text").is_none(), "the conversation must not cross");
        assert_eq!(clean["channel"], "1540934838083915907");
    }

    #[test]
    fn a_long_field_is_truncated() {
        let rec = json!({ "event": "ollama_unreachable", "detail": "x".repeat(5000) });
        let n = sanitize(&rec)["detail"].as_str().unwrap().chars().count();
        assert_eq!(n, 200);
    }

    #[test]
    fn the_latest_of_each_event_wins_across_days() {
        // First, against the real thing, when this machine has one: a reader
        // that only ever meets lines a test wrote is a reader that agrees
        // with the test's idea of the format rather than the bot's.
        if std::path::Path::new(JOURNALS[0].2).is_dir() {
            let v = journal("historian").unwrap();
            assert_eq!(v["found"], true);
            assert!(
                v["file"].as_str().unwrap_or("").ends_with(".jsonl"),
                "found a journal file: {v}"
            );
            assert!(
                v["events"]["discord_ready"]["bot"].is_string(),
                "the real journal parses: {}",
                v["events"]
            );
            assert!(v["events"]["discord_ready"]["text"].is_null());
        }

        let dir = std::env::temp_dir().join(format!("bot-farm-journal-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        // Tuesday: the bot started and could not reach Ollama.
        std::fs::write(
            dir.join("2026-09-10.jsonl"),
            "{\"event\":\"discord_ready\",\"ts\":\"2026-09-10T01:00:00Z\",\"bot\":\"Historian\"}\n\
             {\"event\":\"ollama_unreachable\",\"ts\":\"2026-09-10T01:00:01Z\",\"where\":\"startup\"}\n",
        )
        .unwrap();
        // Wednesday: it was restarted and Ollama answered. Nothing rewrote
        // discord_ready, so yesterday's is still the latest one there is.
        std::fs::write(
            dir.join("2026-09-11.jsonl"),
            "{\"event\":\"ollama_ready\",\"ts\":\"2026-09-11T02:00:00Z\",\"model_present\":true}\n",
        )
        .unwrap();

        std::env::set_var("HISTORIAN_JOURNAL_DIR", &dir);
        let v = journal("historian").unwrap();
        std::env::remove_var("HISTORIAN_JOURNAL_DIR");
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(v["found"], true);
        assert_eq!(v["file"], "2026-09-11.jsonl");
        assert_eq!(v["events"]["discord_ready"]["bot"], "Historian");
        assert_eq!(v["events"]["ollama_ready"]["model_present"], true);
        assert_eq!(v["events"]["ollama_unreachable"]["where"], "startup");

        // And a journal that is not there at all is a reading, not an error:
        // in the same test because it shares the variable above.
        std::env::set_var("HISTORIAN_JOURNAL_DIR", r"C:\no\such\journal\anywhere");
        let gone = journal("historian").unwrap();
        std::env::remove_var("HISTORIAN_JOURNAL_DIR");
        assert_eq!(gone["found"], false);
    }

    // ── webhooks ────────────────────────────────────────────

    #[test]
    fn webhooks_are_named_not_passed_through() {
        assert!(webhook("https://discord.com/api/webhooks/1/abc", None).is_err());
        assert!(webhook("", None).is_err());
        assert!(webhook("../../secrets", None).is_err());
        for n in ["alerts-pi", "alerts-actions", "scores-ops"] {
            assert!(WEBHOOKS.iter().any(|(k, _)| *k == n), "the herd names {n}");
        }
    }

    #[test]
    fn an_unresolvable_webhook_is_unknown_not_healthy() {
        std::env::remove_var("BOT_FARM_WEBHOOK_ALERTS_ACTIONS");
        let v = webhook("alerts-actions", None).unwrap();
        assert_eq!(v["known"], false);
        assert!(v["ok"].is_null(), "unknown is never ok — that is the whole rule");
    }

    #[test]
    fn a_configured_value_that_is_not_a_webhook_is_never_fetched() {
        std::env::set_var("BOT_FARM_WEBHOOK_SCORES_OPS", "https://evil.example/collect");
        let v = webhook("scores-ops", None).unwrap();
        std::env::remove_var("BOT_FARM_WEBHOOK_SCORES_OPS");
        assert_eq!(v["ok"], false);
        assert!(!v["detail"].as_str().unwrap().contains("evil.example"));
    }

    #[test]
    fn a_webhook_comes_from_the_environment_or_the_secrets_file() {
        let dir = std::env::temp_dir().join(format!("bot-farm-hooks-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("webhooks.json");
        std::fs::write(&file, r#"{ "scores-ops": "https://discord.com/api/webhooks/1/tok" }"#).unwrap();
        let path = file.display().to_string();

        assert_eq!(webhook_url("scores-ops", "BOT_FARM_WEBHOOK_UNSET_ON_PURPOSE", Some(&path)).as_deref(),
                   Some("https://discord.com/api/webhooks/1/tok"));
        // A name with no entry stays unresolved rather than borrowing another's.
        assert_eq!(webhook_url("alerts-pi", "BOT_FARM_WEBHOOK_UNSET_ON_PURPOSE", Some(&path)), None);
        assert_eq!(webhook_url("scores-ops", "BOT_FARM_WEBHOOK_UNSET_ON_PURPOSE", None), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unreachable_webhook_says_nothing_about_the_url() {
        // The branch that would otherwise carry ureq's error string, and the
        // URL ureq puts inside it. Hermetic on purpose: the reading is fixed
        // text precisely so that proving it leaks nothing needs no network.
        let printed = unreachable_reading().to_string();
        assert!(!printed.contains("discord.com"), "leaked: {printed}");
        assert!(!printed.contains("http"), "leaked: {printed}");
        assert_eq!(unreachable_reading()["ok"], false);
    }

    #[test]
    fn a_webhook_url_is_never_echoed_back() {
        // A resolved URL must not come back even in the reading that says it
        // is wrong — this is the one path where the URL is in hand.
        std::env::set_var("BOT_FARM_WEBHOOK_ALERTS_PI", "https://evil.example/s3cr3t-token");
        let v = webhook("alerts-pi", None).unwrap();
        std::env::remove_var("BOT_FARM_WEBHOOK_ALERTS_PI");
        let printed = v.to_string();
        assert!(!printed.contains("s3cr3t-token"), "leaked: {printed}");
        assert!(!printed.contains("evil.example"), "leaked: {printed}");
    }
}
