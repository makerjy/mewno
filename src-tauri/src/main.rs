mod engine;
mod models;
mod profile;
mod store;
use engine::Runtime;
use models::{Downloads, Transfer};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use store::{err, Result, Store};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
#[derive(Default)]
struct FinderImports(Mutex<Vec<String>>);
#[tauri::command]
fn take_imports(inbox: State<FinderImports>) -> Result<Vec<String>> {
    Ok(std::mem::take(&mut *inbox.0.lock().map_err(err)?))
}
struct AppState {
    store: Store,
    downloads: Arc<Downloads>,
    stop: Arc<AtomicBool>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}
#[derive(Deserialize)]
struct Options {
    model: String,
    lang: String,
    mode: String,
    hint: String,
    cpu: bool,
}
#[derive(Serialize)]
struct Batch {
    added: usize,
    skipped: usize,
}
fn queue(s: &Store, paths: Vec<String>, o: Options) -> Result<Batch> {
    let m = models::model(&o.model)?;
    if !models::path(s, &m).is_file() {
        return Err("모델 관리에서 사용할 모델을 먼저 받아 주세요.".into());
    }
    if !["auto", "ko", "en", "ja", "zh", "de", "fr", "es"].contains(&o.lang.as_str())
        || !["auto", "wav"].contains(&o.mode.as_str())
        || o.hint.chars().count() > 220
    {
        return Err("언어 또는 고급 설정을 확인해 주세요.".into());
    }
    let mut db = s.db()?;
    let tx = db.transaction().map_err(err)?;
    let mut added = 0;
    let total = paths.len();
    for source in paths {
        let path = fs::canonicalize(&source)
            .map_err(|_| format!("파일 위치를 확인해 주세요: {source}"))?;
        if !path.is_file() {
            return Err("폴더 대신 음성 또는 영상 파일을 선택해 주세요.".into());
        }
        let p = path.to_str().ok_or("파일 경로를 읽을 수 없어요.")?;
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        added+=tx.execute("INSERT INTO jobs(id,path,name,model,lang,mode,hint,cpu,status)
            SELECT ?,?,?,?,?,?,?,?,'queued' WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE path=? AND status NOT IN ('failed','cancelled','completed'))",
            params![uuid::Uuid::new_v4().to_string(),p,name,o.model,o.lang,o.mode,o.hint.trim(),o.cpu,p]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(Batch {
        added,
        skipped: total - added,
    })
}
#[tauri::command]
async fn pick_media(app: tauri::AppHandle) -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("전사할 음성 · 영상 파일 선택")
            .add_filter(
                "음성 · 영상",
                &[
                    "m4a", "mp3", "wav", "aif", "aiff", "caf", "flac", "aac", "mp4", "mov", "m4v",
                    "ogg", "opus", "webm", "mkv", "wma",
                ],
            )
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                p.into_path()
                    .map_err(err)
                    .map(|p| p.to_string_lossy().into_owned())
            })
            .collect()
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn enqueue(state: State<AppState>, paths: Vec<String>, options: Options) -> Result<Batch> {
    queue(&state.store, paths, options)
}
#[tauri::command]
fn snapshot(state: State<AppState>) -> Result<Value> {
    let models: Vec<_> = models::catalog()
        .into_iter()
        .map(|m| {
            let installed = models::path(&state.store, &m)
                .metadata()
                .is_ok_and(|v| v.len() == m.bytes);
            json!({"id":m.id,"bytes":m.bytes,"license":m.license,"installed":installed})
        })
        .collect();
    let transfer: Transfer = state.downloads.state.lock().map_err(err)?.clone();
    Ok(json!({"jobs":state.store.jobs()?,"models":models,"transfer":transfer}))
}
#[tauri::command]
async fn device(state: State<'_, AppState>) -> Result<Value> {
    let root = state.store.0.clone();
    tauri::async_runtime::spawn_blocking(move || profile::detect(&root))
        .await
        .map_err(err)
}
#[tauri::command]
fn install_model(state: State<AppState>, id: String) -> Result<()> {
    models::install(state.store.clone(), state.downloads.clone(), id)
}
#[tauri::command]
fn cancel_download(state: State<AppState>) {
    state.downloads.cancel.store(true, Ordering::Release)
}
#[tauri::command]
fn delete_model(state: State<AppState>, id: String) -> Result<()> {
    let m = models::model(&id)?;
    let transfer = state.downloads.state.lock().map_err(err)?;
    if transfer.id == id && matches!(transfer.stage.as_str(), "download" | "verify") {
        return Err("다운로드가 끝난 뒤 삭제할 수 있어요.".into());
    }
    let busy:bool=state.store.db()?.query_row("SELECT EXISTS(SELECT 1 FROM jobs WHERE model=? AND status NOT IN ('failed','cancelled','completed'))",[id],|r|r.get(0)).map_err(err)?;
    if busy {
        return Err("대기 중이거나 전사 중인 모델이에요.".into());
    }
    fs::remove_file(models::path(&state.store, &m)).map_err(err)
}
#[tauri::command]
fn job_action(state: State<AppState>, id: String, action: String) -> Result<()> {
    change_job(&state.store, &id, &action)
}
fn change_job(store: &Store, id: &str, action: &str) -> Result<()> {
    let sql=match action {
        "cancel"=>"UPDATE jobs SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancelling' END WHERE id=? AND status IN ('queued','analyzing','preprocessing','loading','transcribing')",
        "retry"=>"UPDATE jobs SET status='queued',message='' WHERE id=? AND status IN ('failed','cancelled')",
        "delete"=>"DELETE FROM jobs WHERE id=? AND status IN ('failed','cancelled','completed')",
        _=>return Err("알 수 없는 작업이에요.".into())
    };
    if store.db()?.execute(sql, [id]).map_err(err)? != 1 {
        return Err("작업 상태가 변경됐어요. 목록을 확인해 주세요.".into());
    }
    Ok(())
}
#[tauri::command]
fn result(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<Value> {
    let path = state.store.path(&id)?;
    let completed: bool = state
        .store
        .db()?
        .query_row(
            "SELECT status='completed' FROM jobs WHERE id=?",
            [&id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !completed {
        return Err("전사가 끝난 뒤 결과를 열 수 있어요.".into());
    }
    let identity: Option<String> = state
        .store
        .db()?
        .query_row("SELECT identity FROM sources WHERE job=?", [&id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?;
    let media = if identity.is_some() && store::identity(&path).ok() == identity {
        app.asset_protocol_scope().allow_file(&path).map_err(err)?;
        Some(path)
    } else {
        None
    };
    Ok(json!({"segments":state.store.segments(&id)?,"path":media}))
}
#[tauri::command]
fn edit_segment(state: State<AppState>, id: String, seq: i64, text: String) -> Result<()> {
    state.store.edit(&id, seq, &text)
}
#[tauri::command]
async fn export_md(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> Result<bool> {
    let s = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let job = s
            .jobs()?
            .into_iter()
            .find(|j| j.id == id && j.status == "completed")
            .ok_or("결과를 찾을 수 없어요.")?;
        let Some(dest) = app
            .dialog()
            .file()
            .add_filter("Markdown", &["md"])
            .set_file_name(store::stem(&job.name))
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let p = dest.into_path().map_err(err)?;
        if p.extension() != Some(std::ffi::OsStr::new("md")) {
            return Err("확장자 .md로 저장해 주세요.".into());
        }
        if fs::canonicalize(&p)
            .ok()
            .is_some_and(|c| c == s.path(&id).unwrap_or_default())
        {
            return Err("원본과 다른 이름으로 저장해 주세요.".into());
        }
        let mut tmp =
            tempfile::NamedTempFile::new_in(p.parent().ok_or("저장 폴더를 확인해 주세요.")?)
                .map_err(err)?;
        tmp.write_all(store::markdown(&job, &s.segments(&id)?).as_bytes())
            .map_err(err)?;
        tmp.as_file().sync_all().map_err(err)?;
        tmp.persist(p).map_err(err)?;
        Ok(true)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn preferences(state: State<AppState>) -> Result<Option<String>> {
    state
        .store
        .db()?
        .query_row("SELECT v FROM prefs WHERE k='settings'", [], |r| r.get(0))
        .optional()
        .map_err(err)
}
#[tauri::command]
fn set_preferences(state: State<AppState>, value: String) -> Result<()> {
    state
        .store
        .db()?
        .execute("INSERT OR REPLACE INTO prefs VALUES('settings',?)", [value])
        .map_err(err)?;
    Ok(())
}
fn binary_dir() -> std::io::Result<PathBuf> {
    Ok(std::env::current_exe()?
        .parent()
        .unwrap_or(Path::new("."))
        .to_owned())
}
fn main() {
    tauri::Builder::default()
        .manage(FinderImports::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let store = Store::init(app.path().app_data_dir()?)?;
            let stop = Arc::new(AtomicBool::new(false));
            let rt = Runtime {
                store: store.clone(),
                bin: binary_dir()?,
                stop: stop.clone(),
            };
            let worker = thread::spawn(move || {
                while !rt.stop.load(Ordering::Acquire) {
                    match rt.next() {
                        Ok(true) => continue,
                        Ok(false) => (),
                        Err(e) => eprintln!("작업 목록 읽기 실패: {e}"),
                    }
                    thread::sleep(Duration::from_millis(350))
                }
            });
            app.manage(AppState {
                store,
                downloads: Default::default(),
                stop,
                worker: Mutex::new(Some(worker)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_imports,
            pick_media,
            enqueue,
            snapshot,
            device,
            install_model,
            cancel_download,
            delete_model,
            job_action,
            result,
            edit_segment,
            export_md,
            preferences,
            set_preferences
        ])
        .build(tauri::generate_context!())
        .expect("Mewno 시작 실패")
        .run(|app, event| {
            if let tauri::RunEvent::Opened { ref urls } = event {
                let inbox = app.state::<FinderImports>();
                if let Ok(mut paths) = inbox.0.lock() {
                    paths.extend(
                        urls.iter()
                            .filter_map(|u| u.to_file_path().ok())
                            .filter(|p| p.is_file())
                            .map(|p| p.to_string_lossy().into_owned()),
                    );
                };
            }
            if matches!(event, tauri::RunEvent::Exit) {
                let s = app.state::<AppState>();
                s.stop.store(true, Ordering::Release);
                s.downloads.cancel.store(true, Ordering::Release);
                s.downloads.join();
                if let Some(worker) = s.worker.lock().unwrap().take() {
                    let _ = worker.join();
                };
            }
        });
}

#[cfg(test)]
mod tests;
