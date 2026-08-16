//! `claude mcp login` under a real terminal.
//!
//! This is the app's reason to exist. From an agent shell or the Bash tool
//! there is no TTY, so `wwm connect --json` can only hand back a command
//! string for the user to paste elsewhere (bin/wwm:1726). Pipes do not help —
//! the check is for a controlling terminal. A pty is the only fix, and a
//! desktop process is the only one of the three surfaces that can open one.

use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::wwm;

pub struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct LoginState(pub Mutex<Option<Session>>);

#[derive(Serialize, Clone)]
struct Exit {
    code: i32,
}

/// Spawn `claude mcp login <server>` on a pty.
///
/// Output arrives on the frontend as `login:output` (raw bytes, escape codes
/// intact — feed it straight to xterm), and `login:exit` when the child is
/// done. Only one session at a time; starting a second kills the first, since
/// two concurrent OAuth flows against the same browser is not a real workflow.
#[tauri::command]
pub fn login_start(
    app: AppHandle,
    state: State<'_, LoginState>,
    server: String,
    no_browser: bool,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    // Scoped: std's Mutex is not reentrant, and this is locked again below.
    {
        let mut guard = state.0.lock().map_err(|_| "login state poisoned")?;
        close_locked(&mut guard);
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("could not open a pty: {e}"))?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.args(["mcp", "login", &server]);
    if no_browser {
        cmd.arg("--no-browser");
    }
    // Same PATH problem as the CLI bridge: a Finder-launched GUI cannot see a
    // node installed through nvm, and `claude` usually lives beside it.
    if let Some(path) = wwm::resolved_path() {
        cmd.env("PATH", path);
    }
    cmd.env("TERM", "xterm-256color");
    // Login is a user-scope operation; the project directory is irrelevant to
    // it, and HOME is somewhere that reliably exists.
    if let Some(home) = wwm::home() {
        cmd.cwd(home);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("could not start `claude mcp login {server}`: {e}"))?;
    // The slave handle must go before the reader will ever see EOF.
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("could not read from the pty: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("could not write to the pty: {e}"))?;

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    if app.emit("login:output", chunk).is_err() {
                        break;
                    }
                }
            }
        }
        let code = child
            .wait()
            .ok()
            .and_then(|s| i32::try_from(s.exit_code()).ok())
            .unwrap_or(-1);
        let _ = app.emit("login:exit", Exit { code });
    });

    *state.0.lock().map_err(|_| "login state poisoned")? = Some(Session {
        writer,
        master: pair.master,
        killer,
    });
    Ok(())
}

/// Keystrokes from the frontend terminal.
#[tauri::command]
pub fn login_write(state: State<'_, LoginState>, data: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "login state poisoned")?;
    let session = guard.as_mut().ok_or("no login session is running")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

/// Keep the child's idea of the window in step with the xterm view, so
/// anything that draws a box draws it at the right width.
#[tauri::command]
pub fn login_resize(state: State<'_, LoginState>, rows: u16, cols: u16) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "login state poisoned")?;
    let Some(session) = guard.as_ref() else {
        return Ok(());
    };
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn login_close(state: State<'_, LoginState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "login state poisoned")?;
    close_locked(&mut guard);
    Ok(())
}

fn close_locked(guard: &mut Option<Session>) {
    if let Some(mut session) = guard.take() {
        let _ = session.killer.kill();
    }
}
