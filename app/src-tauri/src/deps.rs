//! Find Node and Claude Code on the login-shell PATH, and open their install pages.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::wwm;

const MIN_NODE_MAJOR: u32 = 22;
const MIN_CLAUDE: (u32, u32, u32) = (2, 1, 186);

pub const NODE_DOWNLOAD: &str = "https://nodejs.org/en/download";
pub const CLAUDE_INSTALL: &str =
    "https://code.claude.com/docs/en/quickstart#step-1-install-claude-code";

#[derive(Serialize, Debug)]
pub struct Probe {
    pub found: bool,
    pub ok: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub required: String,
}

#[derive(Serialize, Debug)]
pub struct Deps {
    pub node: Probe,
    pub claude: Probe,
}

fn missing(required: &str) -> Probe {
    Probe {
        found: false,
        ok: false,
        path: None,
        version: None,
        required: required.into(),
    }
}

pub(crate) fn parse_semver(text: &str) -> Option<(u32, u32, u32)> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            if let Some(ver) = take_semver(&text[i..]) {
                return Some(ver);
            }
        }
        i += 1;
    }
    None
}

fn take_semver(s: &str) -> Option<(u32, u32, u32)> {
    let mut rest = s;
    let major = take_uint(&mut rest)?;
    if !rest.starts_with('.') {
        return None;
    }
    rest = &rest[1..];
    let minor = take_uint(&mut rest)?;
    if !rest.starts_with('.') {
        return None;
    }
    rest = &rest[1..];
    let patch = take_uint(&mut rest)?;
    Some((major, minor, patch))
}

fn take_uint(s: &mut &str) -> Option<u32> {
    let n = s.chars().take_while(|c| c.is_ascii_digit()).count();
    if n == 0 {
        return None;
    }
    let num = s[..n].parse().ok()?;
    *s = &s[n..];
    Some(num)
}

fn node_ok(ver: Option<(u32, u32, u32)>) -> bool {
    ver.is_some_and(|v| v.0 >= MIN_NODE_MAJOR)
}

fn claude_ok(ver: Option<(u32, u32, u32)>) -> bool {
    ver.is_some_and(|v| v >= MIN_CLAUDE)
}

fn run_version(path: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.args(args);
    wwm::apply_env(&mut cmd);
    let out = cmd.output().ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn probe_path(
    path: &Path,
    args: &[&str],
    check: fn(Option<(u32, u32, u32)>) -> bool,
    required: &str,
) -> Probe {
    let output = run_version(path, args);
    let parsed = output.as_deref().and_then(parse_semver);
    let version = parsed.map(|(a, b, c)| format!("{a}.{b}.{c}")).or(output);
    Probe {
        found: true,
        ok: check(parsed),
        path: Some(path.to_string_lossy().into_owned()),
        version,
        required: required.into(),
    }
}

fn probe_named(
    name: &str,
    extras: &[PathBuf],
    args: &[&str],
    check: fn(Option<(u32, u32, u32)>) -> bool,
    required: &str,
    refresh: bool,
) -> Probe {
    match wwm::find_bin(name, extras, refresh) {
        Some(path) => probe_path(&path, args, check, required),
        None => missing(required),
    }
}

fn node_extras() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ]
}

fn claude_extras() -> Vec<PathBuf> {
    let mut v = vec![
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ];
    if let Some(dir) = wwm::home() {
        v.push(dir.join(".local").join("bin").join("claude"));
        v.push(dir.join(".npm-global").join("bin").join("claude"));
    }
    v
}

fn probe_node() -> Probe {
    let required = format!("{MIN_NODE_MAJOR}");
    probe_named(
        "node",
        &node_extras(),
        &["--version"],
        node_ok,
        &required,
        true,
    )
}

fn probe_claude() -> Probe {
    let required = format!("{}.{}.{}", MIN_CLAUDE.0, MIN_CLAUDE.1, MIN_CLAUDE.2);
    if let Ok(pin) = std::env::var("WWM_CLAUDE_BIN") {
        let path = PathBuf::from(&pin);
        if path.is_file() {
            return probe_path(&path, &["--version"], claude_ok, &required);
        }
    }
    probe_named(
        "claude",
        &claude_extras(),
        &["--version"],
        claude_ok,
        &required,
        false,
    )
}

fn collect() -> Deps {
    Deps {
        node: probe_node(),
        claude: probe_claude(),
    }
}

#[tauri::command]
pub async fn deps_check() -> Result<Deps, String> {
    tauri::async_runtime::spawn_blocking(collect)
        .await
        .map_err(|e| format!("deps check failed: {e}"))
}

fn allowed_url(url: &str) -> bool {
    url == NODE_DOWNLOAD || url == CLAUDE_INSTALL
}

fn open_command(url: &str) -> Command {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", url]);
        cmd
    } else if cfg!(target_os = "macos") {
        let mut cmd = Command::new("open");
        cmd.arg(url);
        cmd
    } else {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(url);
        cmd
    }
}

fn open_url_sync(url: &str) -> Result<(), String> {
    if !allowed_url(url) {
        return Err("that URL is not allowed".into());
    }
    let status = open_command(url)
        .status()
        .map_err(|e| format!("could not open {url}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("could not open {url}"))
    }
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_url_sync(&url))
        .await
        .map_err(|e| format!("open url task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_node_version() {
        assert_eq!(parse_semver("v22.14.0\n"), Some((22, 14, 0)));
    }

    #[test]
    fn parse_claude_version() {
        assert_eq!(parse_semver("2.1.223 (Claude Code)"), Some((2, 1, 223)));
    }

    #[test]
    fn parse_rejects_garbage() {
        assert_eq!(parse_semver("not a version"), None);
    }

    #[test]
    fn node_major_gate() {
        assert!(node_ok(Some((22, 0, 0))));
        assert!(node_ok(Some((24, 1, 0))));
        assert!(!node_ok(Some((21, 7, 3))));
        assert!(!node_ok(None));
    }

    #[test]
    fn claude_min_gate() {
        assert!(claude_ok(Some((2, 1, 186))));
        assert!(claude_ok(Some((2, 1, 223))));
        assert!(!claude_ok(Some((2, 1, 185))));
        assert!(!claude_ok(Some((1, 0, 0))));
        assert!(!claude_ok(None));
    }

    #[test]
    fn open_url_allowlist() {
        assert!(allowed_url(NODE_DOWNLOAD));
        assert!(allowed_url(CLAUDE_INSTALL));
        assert!(!allowed_url("https://example.com"));
    }
}
