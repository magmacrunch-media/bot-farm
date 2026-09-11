//! The chores: everything the webview may ask this side to do that a browser
//! tab could not — run `gh`, read and poke scheduled tasks, probe two HTTP
//! endpoints, open a link.
//!
//! Every function here sits behind an allowlist, and the allowlists are the
//! point. The webview never holds a token (gh's keyring does), never names a
//! URL (only a probe name or a GitHub path under the org), and never passes
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
}
