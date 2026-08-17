//! Shell out to `bin/wwm --json`. Do not reimplement state.json / .claude.json
//! handling here — two writers to those files would drift, and .claude.json's
//! schema belongs to Claude Code.

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Where the CLI was found. Surfaced in the UI so a stale global install or a
/// shadowed PATH is diagnosable without guesswork.
#[derive(Serialize, Clone, Debug)]
pub struct Located {
    pub path: String,
    pub source: String,
}

/// The user's real PATH, as their login shell would build it.
///
/// A GUI launched from Finder or the Dock inherits a minimal PATH — roughly
/// `/usr/bin:/bin:/usr/sbin:/sbin` — not the one from .zshrc. Anyone running
/// node through nvm (or Homebrew on Apple silicon) has `wwm` somewhere that
/// PATH cannot see, and `wwm` in turn shells out to `claude`, which has the
/// same problem one level down. So we ask the login shell once and hand the
/// answer to every child.
fn login_shell_path() -> Option<String> {
    static CACHE: OnceLock<Option<String>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            if cfg!(windows) {
                return None;
            }
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            // -i so interactive-only rc files (where nvm usually lives) run.
            let out = Command::new(shell)
                .args(["-ilc", "printf %s \"$PATH\""])
                .output()
                .ok()?;
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if path.is_empty() {
                None
            } else {
                Some(path)
            }
        })
        .clone()
}

/// Apply the resolved PATH to a child process. Also used by the pty module.
pub fn apply_env(cmd: &mut Command) {
    if let Some(path) = login_shell_path() {
        cmd.env("PATH", path);
    }
}

pub fn resolved_path() -> Option<String> {
    login_shell_path()
}

pub fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// The directory a command runs in.
///
/// `status` and `switch` are per-project: they read and write
/// `~/.claude.json`'s `projects[<resolved cwd>].disabledMcpServers`. An app
/// launched from Finder inherits `/` as its cwd, so without this every
/// activation answer would silently be about the filesystem root — and the
/// first toggle would write a disable list for `/`.
///
/// So the frontend always names the directory, and a stale one (a folder since
/// moved, deleted, or on an unmounted volume — all reachable from a persisted
/// recents list) fails here with something readable instead of an errno.
fn working_dir(cwd: Option<String>) -> Result<PathBuf, String> {
    let Some(raw) = cwd else {
        return home().ok_or_else(|| "Could not determine a home directory.".to_string());
    };
    let dir = PathBuf::from(&raw);
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(format!(
            "{raw} is not a directory. It may have been moved or deleted, or be on a volume \
             that is not mounted."
        ))
    }
}

/// `WWM_BIN` -> bundled sidecar -> PATH.
///
/// The sidecar path is unused today: `wwm` already needs the `claude` CLI, so
/// anyone using this app has a developer environment. Bundling node only
/// matters if this ever ships to people who do not.
pub fn locate(app: &AppHandle) -> Result<Located, String> {
    if let Ok(raw) = std::env::var("WWM_BIN") {
        let path = PathBuf::from(&raw);
        if path.is_file() {
            return Ok(Located {
                path: raw,
                source: "WWM_BIN".into(),
            });
        }
        return Err(format!("WWM_BIN is set to {raw}, which is not a file."));
    }

    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("bin").join("wwm");
        if candidate.is_file() {
            return Ok(Located {
                path: candidate.to_string_lossy().into_owned(),
                source: "bundled".into(),
            });
        }
    }

    Ok(Located {
        path: "wwm".into(),
        source: "PATH".into(),
    })
}

#[derive(Serialize, Debug)]
pub struct Output {
    /// The CLI's exit code. Non-zero is meaningful, not merely failure —
    /// see the EXIT map in bin/wwm (2 usage, 3 preflight, 4 collision,
    /// 6 verify failed, 7 parse).
    pub code: i32,
    /// Parsed stdout. Present even on failure: every error path emits
    /// `{ok: false, error, detail, exitCode}` under --json.
    pub json: Option<serde_json::Value>,
    /// Human-readable half. Worth showing when `json` is None.
    pub stderr: String,
}

/// Run `wwm <args> --json` in `cwd` and hand back the parsed result.
///
/// Running the CLI *in* the project directory rather than passing it a flag is
/// deliberate: `--project` exists only on `switch` and `activate`, so a flag
/// would be silently ignored by `status` and the list would describe a
/// different directory than the toggles wrote to.
///
/// This is the blocking half. The Tauri commands wrap it in `spawn_blocking`:
/// a sync `#[tauri::command]` runs on the UI thread, and `Command::output()`
/// waiting on `claude mcp list` would freeze the window until the child exited.
fn run_wwm(app: &AppHandle, args: Vec<String>, cwd: Option<String>) -> Result<Output, String> {
    let bin = locate(app)?;
    let dir = working_dir(cwd)?;

    let mut argv = args;
    if !argv.iter().any(|a| a == "--json") {
        argv.push("--json".into());
    }

    let mut cmd = Command::new(&bin.path);
    cmd.args(&argv);
    cmd.current_dir(&dir);
    apply_env(&mut cmd);

    let out = cmd.output().map_err(|e| {
        if bin.source == "PATH" {
            format!(
                "Could not run `wwm` ({e}).\n\nInstall it with `npm install -g wicked-webflow-mcp`, \
                 or set WWM_BIN to the path of bin/wwm in a checkout."
            )
        } else {
            format!("Could not run {} (from {}): {e}", bin.path, bin.source)
        }
    })?;

    let code = out.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let json = serde_json::from_str::<serde_json::Value>(stdout.trim()).ok();

    Ok(Output { code, json, stderr })
}

#[tauri::command]
pub async fn wwm_run(
    app: AppHandle,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<Output, String> {
    tauri::async_runtime::spawn_blocking(move || run_wwm(&app, args, cwd))
        .await
        .map_err(|e| format!("wwm task failed: {e}"))?
}

fn locate_full(app: &AppHandle) -> Result<serde_json::Value, String> {
    let bin = locate(app)?;
    // No cwd: `version` is not per-project, and this runs before the user has
    // chosen a directory.
    let out = run_wwm(app, vec!["version".into()], None)?;
    let version = out
        .json
        .as_ref()
        .and_then(|v| v.get("version"))
        .and_then(|v| v.as_str())
        .map(String::from);
    // Absent on any wwm predating the contract. The frontend enforces the
    // match; this is here so the diagnostic banner can name the number.
    let schema_version = out
        .json
        .as_ref()
        .and_then(|v| v.get("schemaVersion"))
        .and_then(serde_json::Value::as_u64);

    Ok(serde_json::json!({
        "path": bin.path,
        "source": bin.source,
        "version": version,
        "schemaVersion": schema_version,
        "path_env": resolved_path(),
        // So the UI can abbreviate project paths to `~/…` without a second
        // round trip or a path-API permission.
        "home": home().map(|p| p.to_string_lossy().into_owned()),
        "stderr": out.stderr,
    }))
}

/// Where the CLI is and what version it reports. The UI calls this at startup
/// so a missing or mismatched install is one clear message, not five failures.
#[tauri::command]
pub async fn wwm_locate(app: AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || locate_full(&app))
        .await
        .map_err(|e| format!("wwm locate task failed: {e}"))?
}

const NPM_PACKAGE: &str = "wicked-webflow-mcp";

#[derive(Serialize, Debug)]
pub struct UpgradeOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

fn npm_bin() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

/// `npm install -g wicked-webflow-mcp`, using the same login-shell PATH as
/// every other child so nvm / Homebrew node is visible from a Dock launch.
///
/// Refused when `WWM_BIN` is set: that pin is deliberate, and a global install
/// would not be what the app runs next.
fn run_upgrade() -> Result<UpgradeOutput, String> {
    if std::env::var_os("WWM_BIN").is_some() {
        return Err(
            "WWM_BIN is set, so this app is not using a global install. Unset it, or point it at a \
             current checkout."
                .into(),
        );
    }

    let mut cmd = Command::new(npm_bin());
    cmd.args(["install", "-g", NPM_PACKAGE]);
    apply_env(&mut cmd);
    if let Some(dir) = home() {
        cmd.current_dir(dir);
    }

    let out = cmd.output().map_err(|e| {
        format!(
            "Could not run `npm` ({e}).\n\nInstall Node, then run `npm install -g {NPM_PACKAGE}` \
             in a terminal."
        )
    })?;

    Ok(UpgradeOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

#[tauri::command]
pub async fn wwm_upgrade() -> Result<UpgradeOutput, String> {
    tauri::async_runtime::spawn_blocking(run_upgrade)
        .await
        .map_err(|e| format!("upgrade task failed: {e}"))?
}
