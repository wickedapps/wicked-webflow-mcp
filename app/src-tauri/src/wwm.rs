//! Shell out to `bin/wwm --json`. Do not reimplement state.json / .claude.json
//! handling here — two writers to those files would drift, and .claude.json's
//! schema belongs to Claude Code.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Where the CLI was found.
#[derive(Serialize, Clone, Debug)]
pub struct Located {
    pub path: String,
    pub source: String,
}

/// A GUI launched from Finder or the Dock inherits a minimal PATH — roughly
/// `/usr/bin:/bin:/usr/sbin:/sbin` — not the one from .zshrc. Anyone running
/// node through nvm (or Homebrew on Apple silicon) has `wwm` somewhere that
/// PATH cannot see, and `wwm` in turn shells out to `claude`, which has the
/// same problem one level down. So we ask the login shell once and hand the
/// answer to every child.
static LOGIN_PATH: Mutex<Option<Option<String>>> = Mutex::new(None);

fn login_path_lock() -> std::sync::MutexGuard<'static, Option<Option<String>>> {
    LOGIN_PATH.lock().unwrap_or_else(|e| e.into_inner())
}

fn compute_login_shell_path() -> Option<String> {
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
}

fn login_shell_path() -> Option<String> {
    let mut guard = login_path_lock();
    if guard.is_none() {
        *guard = Some(compute_login_shell_path());
    }
    (*guard).clone().flatten()
}

fn invalidate_login_path() {
    *login_path_lock() = None;
}

/// Apply the login-shell PATH to a child process.
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

fn path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut add = |raw: &str| {
        for dir in std::env::split_paths(raw) {
            if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    };
    if let Some(path) = login_shell_path() {
        add(&path);
    }
    if let Ok(path) = std::env::var("PATH") {
        add(&path);
    }
    dirs
}

/// Look for `name` on the login-shell PATH, then common install locations.
pub(crate) fn find_bin(name: &str, extras: &[PathBuf], refresh: bool) -> Option<PathBuf> {
    if refresh {
        invalidate_login_path();
    }
    let exe = if cfg!(windows) && !name.contains('.') {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    for dir in path_dirs() {
        let candidate = dir.join(&exe);
        if candidate.is_file() {
            return Some(candidate);
        }
        if cfg!(windows) {
            let cmd = dir.join(format!("{name}.cmd"));
            if cmd.is_file() {
                return Some(cmd);
            }
        }
    }
    extras.iter().find(|p| p.is_file()).cloned()
}

fn wwm_extras() -> Vec<PathBuf> {
    let mut v = vec![
        PathBuf::from("/opt/homebrew/bin/wwm"),
        PathBuf::from("/usr/local/bin/wwm"),
    ];
    if let Some(dir) = home() {
        v.push(dir.join(".local").join("bin").join("wwm"));
        v.push(dir.join(".npm-global").join("bin").join("wwm"));
    }
    v
}

/// Build the command that runs the located CLI.
///
/// An installed copy is executed directly, the way it always has been: npm
/// wrote a `.cmd` shim on Windows, and everywhere else the shebang does the
/// work. A *bundled* copy has neither. It is a plain file that Tauri copied
/// into a read-only app bundle, so the executable bit may not have survived the
/// copy, and on Windows a shebang means nothing at all. So it is handed to
/// `node` explicitly.
///
/// This is why Node stays a real prerequisite even once the CLI ships inside
/// the app: `bin/wwm` is a Node program, and bundling it removes the install
/// step, not the runtime.
fn cli_command(bin: &Located) -> Result<Command, String> {
    if bin.source != "bundled" {
        return Ok(Command::new(&bin.path));
    }

    let node = find_bin("node", &crate::deps::node_extras(), false).ok_or_else(|| {
        "Could not find Node.js, which this app needs to run its bundled command-line tool.\n\n\
         Install Node.js 22 or later, then try again."
            .to_string()
    })?;
    let mut cmd = Command::new(node);
    cmd.arg(&bin.path);
    Ok(cmd)
}

/// The directory a command runs in.
///
/// `status` and `switch` are keyed on cwd. A Finder launch inherits `/`, so
/// without an explicit directory every answer would be about the filesystem
/// root, and the first toggle would write a disable list for `/`.
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
/// `Ok(None)` means it is not installed. `Err` means `WWM_BIN` points at nothing.
pub fn locate(app: &AppHandle) -> Result<Option<Located>, String> {
    if let Ok(raw) = std::env::var("WWM_BIN") {
        let path = PathBuf::from(&raw);
        if path.is_file() {
            return Ok(Some(Located {
                path: raw,
                source: "WWM_BIN".into(),
            }));
        }
        return Err(format!("WWM_BIN is set to {raw}, which is not a file."));
    }

    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("bin").join("wwm");
        if candidate.is_file() {
            return Ok(Some(Located {
                path: candidate.to_string_lossy().into_owned(),
                source: "bundled".into(),
            }));
        }
    }

    Ok(find_bin("wwm", &wwm_extras(), false).map(|path| Located {
        path: path.to_string_lossy().into_owned(),
        source: "PATH".into(),
    }))
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
    /// Human-readable stderr, for when `json` is missing.
    pub stderr: String,
}

/// Run `wwm <args> --json` in `cwd`.
///
/// Commands run *in* the project directory: `--project` exists only on
/// `switch` and `activate`, so a flag would be ignored by `status`.
/// Wrapped in `spawn_blocking` because `claude mcp list` would otherwise
/// freeze the UI thread.
fn run_wwm(app: &AppHandle, args: Vec<String>, cwd: Option<String>) -> Result<Output, String> {
    let bin = locate(app)?.ok_or_else(|| {
        "Could not run `wwm`.\n\nInstall it with `npm install -g wicked-webflow-mcp`, \
         or set WWM_BIN to the path of bin/wwm in a checkout."
            .to_string()
    })?;
    let dir = working_dir(cwd)?;

    let mut argv = args;
    if !argv.iter().any(|a| a == "--json") {
        argv.push("--json".into());
    }

    let mut cmd = cli_command(&bin)?;
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
    let home = home().map(|p| p.to_string_lossy().into_owned());
    let path_env = resolved_path();
    let Some(bin) = locate(app)? else {
        return Ok(serde_json::json!({
            "found": false,
            "path": null,
            "source": "PATH",
            "version": null,
            "schemaVersion": null,
            "path_env": path_env,
            "home": home,
            "stderr": "",
        }));
    };
    let out = run_wwm(app, vec!["version".into()], None)?;
    let version = out
        .json
        .as_ref()
        .and_then(|v| v.get("version"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let schema_version = out
        .json
        .as_ref()
        .and_then(|v| v.get("schemaVersion"))
        .and_then(serde_json::Value::as_u64);

    Ok(serde_json::json!({
        "found": true,
        "path": bin.path,
        "source": bin.source,
        "version": version,
        "schemaVersion": schema_version,
        "path_env": path_env,
        "home": home,
        "stderr": out.stderr,
    }))
}

/// Where the CLI is and what version it reports.
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
fn run_upgrade(app: &AppHandle) -> Result<UpgradeOutput, String> {
    if std::env::var_os("WWM_BIN").is_some() {
        return Err(
            "WWM_BIN is set, so this app is not using a global install. Unset it, or point it at a \
             current checkout."
                .into(),
        );
    }

    // Same reasoning as the WWM_BIN guard: a global install would not be what
    // the app runs next, so doing one would report success and change nothing.
    if let Ok(Some(bin)) = locate(app) {
        if bin.source == "bundled" {
            return Err(
                "This app ships its own copy of the command-line tool, so there is nothing to \
                 install. Update the app itself to get a newer one."
                    .into(),
            );
        }
    }

    let mut cmd = Command::new(npm_bin());
    cmd.args(["install", "-g", NPM_PACKAGE]);
    invalidate_login_path();
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
pub async fn wwm_upgrade(app: AppHandle) -> Result<UpgradeOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_upgrade(&app))
        .await
        .map_err(|e| format!("upgrade task failed: {e}"))?
}
