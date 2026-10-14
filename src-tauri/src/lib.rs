// The shell: opens the window, starts the helper, and passes JSON lines between
// them. The window never gets permission to run programs or touch files.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

const MAX_RESTARTS: u32 = 5;

struct Helper {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    restarts: u32,
    started: Option<Instant>,
}

type HelperState = Mutex<Helper>;

#[tauri::command]
fn helper_send(message: serde_json::Value, state: State<'_, HelperState>) -> Result<(), String> {
    if message.get("type").and_then(|t| t.as_str()) == Some("boot") {
        return Err("not allowed".into());
    }
    let mut helper = state.lock().map_err(|_| "busy")?;
    let stdin = helper.stdin.as_mut().ok_or("helper not running")?;
    let line = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    stdin
        .write_all(format!("{line}\n").as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())
}

fn helper_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no exe dir")?;
    let name = if cfg!(windows) { "pia-helper.exe" } else { "pia-helper" };
    Ok(dir.join(name))
}

fn start_helper(app: &AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let workspace = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?
        .join("Pia");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let key = login_key(&data_dir)?;

    let mut command = Command::new(helper_path()?);
    command
        .arg("--data-dir")
        .arg(&data_dir)
        .arg("--workspace")
        .arg(&workspace)
        .current_dir(&data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|e| format!("start helper: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;

    let boot = serde_json::json!({
        "type": "boot",
        "key": key,
        "appVersion": app.package_info().version.to_string(),
    });
    stdin
        .write_all(format!("{boot}\n").as_bytes())
        .map_err(|e| e.to_string())?;

    {
        let state = app.state::<HelperState>();
        let mut helper = state.lock().map_err(|_| "busy")?;
        helper.child = Some(child);
        helper.stdin = Some(stdin);
        helper.started = Some(Instant::now());
    }

    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    let _ = app.emit("helper-message", line);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        on_helper_exit(&app);
    });
    Ok(())
}

fn on_helper_exit(app: &AppHandle) {
    let _ = app.emit("helper-exit", ());
    let restart = {
        let state = app.state::<HelperState>();
        let Ok(mut helper) = state.lock() else { return };
        if let Some(mut child) = helper.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        helper.stdin = None;
        // A helper that ran for a while earns its restarts back.
        if helper.started.map_or(false, |s| s.elapsed() > Duration::from_secs(300)) {
            helper.restarts = 0;
        }
        helper.restarts += 1;
        helper.restarts <= MAX_RESTARTS
    };
    if restart {
        std::thread::sleep(Duration::from_secs(1));
        if let Err(error) = start_helper(app) {
            eprintln!("{error}");
        }
    }
}

fn stop_helper(app: &AppHandle) {
    let state = app.state::<HelperState>();
    let Ok(mut helper) = state.lock() else { return };
    helper.restarts = MAX_RESTARTS + 1;
    helper.stdin = None;
    if let Some(mut child) = helper.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// The key that encrypts the stored ChatGPT login. On Windows it lives in the
/// Credential Manager; elsewhere (development) in a private file.
fn login_key(data_dir: &std::path::Path) -> Result<String, String> {
    #[cfg(windows)]
    {
        let _ = data_dir;
        let entry = keyring::Entry::new("Pia", "anmeldung").map_err(|e| e.to_string())?;
        if let Ok(key) = entry.get_password() {
            if key.len() == 64 {
                return Ok(key);
            }
        }
        let key = new_key()?;
        entry.set_password(&key).map_err(|e| e.to_string())?;
        Ok(key)
    }
    #[cfg(not(windows))]
    {
        let file = data_dir.join("schluessel");
        if let Ok(key) = std::fs::read_to_string(&file) {
            if key.trim().len() == 64 {
                return Ok(key.trim().to_string());
            }
        }
        let key = new_key()?;
        std::fs::write(&file, &key).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
        }
        Ok(key)
    }
}

fn new_key() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(hex::encode(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(Helper { child: None, stdin: None, restarts: 0, started: None }))
        .invoke_handler(tauri::generate_handler![helper_send])
        .setup(|app| {
            if let Err(error) = start_helper(app.handle()) {
                eprintln!("{error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Pia");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_helper(handle);
        }
    });
}
