//! farm-cli — the farm's readings on stdout, for a reader that is not the window.
//!
//! The MCP server (see ../../../../mcp/) needs exactly what the webview needs:
//! `gh`, the Task Scheduler, two HTTP probes, one journal, three webhooks. All
//! of that already exists in farm.rs behind its allowlists, and the allowlists
//! are the reason this is a thin argv shim rather than a second implementation
//! in another language. A leak fixed in farm.rs is fixed here by construction.
//!
//! READ-ONLY, and deliberately so. `farm::gh_workflow`, `farm::task_action` and
//! `farm::open_url` exist a module away and are not reachable from here: the
//! app confirms every chore through a dialog and writes it to the log, and an
//! MCP client has neither. tests/mcp.test.mjs asserts this file names none of
//! them, so growing a write verb here is a test failure and not an oversight.
//!
//! One JSON value on stdout, or a message on stderr and a non-zero exit. Feed
//! errors are how the farm says a field is dim, so the caller turns the second
//! into the first rather than giving up on the walk.

use bot_farm_lib::farm;
use serde_json::{json, Value};

const USAGE: &str = "\
farm-cli — read the farm

  gh-api <path>      a GitHub API path under the org
  tasks              this machine's root-folder scheduled tasks
  probe <name>       ollama | pi-status
  journal <name>     historian — readiness events only
  webhook <name>     alerts-pi | alerts-actions | scores-ops — never the URL
  config-dir         where herd.json and webhooks.json live

Read-only. Chores (feed, pen, let out) are the app's, not this.";

/// Where the app keeps herd.json and webhooks.json. This must agree with
/// Tauri's `app_config_dir()`, which on Windows is `%APPDATA%\\<identifier>`;
/// the override exists so a test — or a second machine's copy — can point
/// somewhere else without editing anything.
fn config_dir() -> Option<String> {
    if let Ok(d) = std::env::var("BOT_FARM_CONFIG_DIR") {
        let d = d.trim().to_string();
        if !d.is_empty() {
            return Some(d);
        }
    }
    #[cfg(windows)]
    {
        let base = std::env::var("APPDATA").ok()?;
        return Some(format!(r"{base}\com.magmacrunch.bot-farm"));
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn dispatch(args: &[String], dir: Option<&str>) -> Result<Value, String> {
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let need = |i: usize| -> Result<&str, String> {
        args.get(i)
            .map(String::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("{cmd}: missing argument"))
    };
    match cmd {
        "gh-api" => farm::gh_api(need(1)?),
        "tasks" => farm::tasks_list(),
        "probe" => farm::probe(need(1)?),
        "journal" => farm::journal(need(1)?),
        "webhook" => {
            let secrets = dir.map(|d| format!("{d}/webhooks.json"));
            farm::webhook(need(1)?, secrets.as_deref())
        }
        "config-dir" => Ok(json!(dir)),
        "" | "-h" | "--help" | "help" => Err(USAGE.to_string()),
        other => Err(format!("unknown command: {other}")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = config_dir();
    match dispatch(&args, dir.as_deref()) {
        Ok(v) => println!("{v}"),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn unknown_commands_and_missing_arguments_are_errors() {
        assert!(dispatch(&argv(&["feed"]), None).is_err());
        assert!(dispatch(&argv(&["probe"]), None).is_err());
        assert!(dispatch(&argv(&["probe", ""]), None).is_err());
        assert!(dispatch(&argv(&[]), None).is_err());
    }

    /// The validators are farm.rs's; this only proves the shim reaches them
    /// rather than shelling out on its own.
    #[test]
    fn the_allowlists_still_apply_through_the_shim() {
        let err = dispatch(&argv(&["gh-api", "repos/someone-else/repo"]), None).unwrap_err();
        assert!(err.contains("refusing API path"), "{err}");
        let err = dispatch(&argv(&["probe", "no-such-probe"]), None).unwrap_err();
        assert!(err.contains("unknown probe"), "{err}");
        let err = dispatch(&argv(&["webhook", "no-such-hook"]), None).unwrap_err();
        assert!(err.contains("unknown webhook"), "{err}");
    }

    /// A webhook with nowhere to resolve from reads "no local copy" — a
    /// reading, not a failure, and it must not name a URL.
    #[test]
    fn an_unresolvable_webhook_is_a_reading() {
        let v = dispatch(&argv(&["webhook", "alerts-pi"]), Some(r"Z:\nowhere")).unwrap();
        assert_eq!(v["known"], false);
        assert!(!v.to_string().contains("discord.com/api/webhooks/"));
    }

    #[test]
    fn config_dir_is_reported_as_given() {
        let v = dispatch(&argv(&["config-dir"]), Some(r"C:\somewhere")).unwrap();
        assert_eq!(v, json!(r"C:\somewhere"));
        assert_eq!(dispatch(&argv(&["config-dir"]), None).unwrap(), Value::Null);
    }
}
