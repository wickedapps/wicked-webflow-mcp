//! `claude mcp login` under a real pty. Pipes fail the controlling-terminal
//! check. A desktop process is the only one here that can open a pty.

use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::wwm;

pub struct Session {
    /// Chosen by the caller, so it can tell its own session's events from
    /// those of a session it replaced. See `login_start`.
    id: String,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct LoginState(pub Mutex<Option<Session>>);

#[derive(Serialize, Clone)]
struct Output {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct Exit {
    id: String,
    code: i32,
}

/// Spawn `claude mcp login <server>` on a pty.
///
/// Output arrives on the frontend as `login:output`, raw bytes, escape codes
/// intact. Feed it straight to xterm. `login:exit` fires when the child is
/// done. Only one session at a time. Starting a second kills the first, since
/// two concurrent OAuth flows against the same browser is not a real workflow.
///
/// Both events carry `id`, and the frontend must drop any that is not its
/// own: killing the previous child emits a real exit, which would otherwise
/// read as the *new* session having died the moment it started.
#[tauri::command]
pub fn login_start(
    app: AppHandle,
    state: State<'_, LoginState>,
    id: String,
    server: String,
    no_browser: bool,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    // Scoped lock. std's Mutex is not reentrant, and this is locked again below.
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
    // Same PATH problem as the CLI bridge. A Finder-launched GUI cannot see a
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

    let thread_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let event = Output {
                        id: thread_id.clone(),
                        data,
                    };
                    if app.emit("login:output", event).is_err() {
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
        let _ = app.emit(
            "login:exit",
            Exit {
                id: thread_id,
                code,
            },
        );
    });

    *state.0.lock().map_err(|_| "login state poisoned")? = Some(Session {
        id,
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

/// Close a session by id. A cleanup that arrives after a newer session has
/// taken over is a no-op rather than killing that newer session.
#[tauri::command]
pub fn login_close(state: State<'_, LoginState>, id: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "login state poisoned")?;
    if guard.as_ref().is_some_and(|s| s.id == id) {
        close_locked(&mut guard);
    }
    Ok(())
}

fn close_locked(guard: &mut Option<Session>) {
    if let Some(mut session) = guard.take() {
        let _ = session.killer.kill();
    }
}
