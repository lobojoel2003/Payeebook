//! Payeebook desktop shell.
//!
//! The whole app is the same local-first web app that runs in the browser. The
//! desktop shell adds only what a webview cannot do on its own: a native
//! "Save as" dialog for PDFs, backups and shared books, and opening links in
//! the system browser. No data ever leaves the computer.

use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

/// Show a native save dialog and write the raw bytes sent from the web app.
/// The suggested file name arrives in the `x-file-name` header.
/// Returns `false` when the user cancels.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected the file contents as raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(sanitize_file_name)
        .unwrap_or_else(|| "payeebook-export".to_string());

    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some((_, ext)) = name.rsplit_once('.') {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    let Some(choice) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = choice.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(true)
}

/// Keep suggested names to a safe subset so they can't steer the dialog elsewhere.
fn sanitize_file_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == '-');
    if trimmed.is_empty() {
        "payeebook-export".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("error while running Payeebook");
}

#[cfg(test)]
mod tests {
    use super::sanitize_file_name;

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(sanitize_file_name("report-2026.pdf"), "report-2026.pdf");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "etc-passwd");
        assert_eq!(sanitize_file_name("Zoë's book.sqlite"), "Zo--s-book.sqlite");
        assert_eq!(sanitize_file_name("..."), "payeebook-export");
    }
}
