use crate::store::{err, Result, Store};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
#[derive(Clone, Deserialize, Serialize)]
pub struct Model {
    pub id: String,
    pub bytes: u64,
    pub sha256: String,
    pub url: String,
    pub license: String,
}
pub fn catalog() -> Vec<Model> {
    serde_json::from_str(include_str!("../models.json")).expect("checked-in model manifest")
}
pub fn model(id: &str) -> Result<Model> {
    catalog()
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| "등록되지 않은 모델이에요.".into())
}
pub fn path(root: &Store, m: &Model) -> PathBuf {
    root.0.join("models").join(format!("ggml-{}.bin", m.id))
}
pub fn verify(p: &Path, m: &Model, check: impl Fn() -> Result<()>) -> Result<()> {
    let mut f = File::open(p).map_err(|_| "모델 관리에서 모델을 먼저 설치해 주세요.")?;
    let bad =
        "모델 무결성 검사에 실패했어요. 모델 관리에서 기존 파일을 삭제한 뒤 다시 받아 주세요.";
    if f.metadata().map_err(err)?.len() != m.bytes {
        return Err(bad.into());
    }
    let mut h = Sha256::new();
    let mut b = vec![0; 262144];
    loop {
        check()?;
        let n = f.read(&mut b).map_err(err)?;
        if n == 0 {
            break;
        }
        h.update(&b[..n]);
    }
    if format!("{:x}", h.finalize()) != m.sha256 {
        return Err(bad.into());
    }
    Ok(())
}
#[derive(Clone, Serialize, Default)]
pub struct Transfer {
    pub id: String,
    pub bytes: u64,
    pub stage: String,
    pub error: String,
}
#[derive(Default)]
pub struct Downloads {
    worker: Mutex<Option<thread::JoinHandle<()>>>,
    pub state: Mutex<Transfer>,
    pub cancel: AtomicBool,
}
impl Downloads {
    pub fn join(&self) {
        if let Some(h) = self.worker.lock().unwrap().take() {
            let _ = h.join();
        }
    }
}
pub fn install(root: Store, d: Arc<Downloads>, id: String) -> Result<()> {
    let m = model(&id)?;
    let mut state = d.state.lock().map_err(err)?;
    if matches!(state.stage.as_str(), "download" | "verify") {
        return Err("다른 다운로드가 진행 중이에요.".into());
    }
    *state = Transfer {
        id,
        stage: "verify".into(),
        ..Default::default()
    };
    d.cancel.store(false, Ordering::Release);
    drop(state);
    let control = d.clone();
    let mut handle = control.worker.lock().map_err(err)?;
    *handle = Some(thread::spawn(move || {
        let update = |s: &str, n: u64| {
            let mut v = d.state.lock().unwrap();
            v.stage = s.into();
            v.bytes = n;
        };
        let check = || {
            if d.cancel.load(Ordering::Acquire) {
                Err("다운로드를 취소했어요.".into())
            } else {
                Ok(())
            }
        };
        let outcome = (|| -> Result<()> {
            let target = path(&root, &m);
            if verify(&target, &m, check).is_ok() {
                return Ok(());
            }
            check()?;
            if fs2::available_space(&root.0).is_ok_and(|v| v < m.bytes + 16_000_000) {
                return Err("모델을 저장할 공간이 부족해요.".into());
            }
            let tmp = tempfile::NamedTempFile::new_in(root.0.join("work")).map_err(err)?;
            let mut curl = Command::new("/usr/bin/curl")
                .args([
                    "-q",
                    "--fail",
                    "--location",
                    "--proto",
                    "=https",
                    "--proto-redir",
                    "=https",
                    "--silent",
                    "--connect-timeout",
                    "20",
                    "--speed-limit",
                    "1024",
                    "--speed-time",
                    "45",
                    "--max-filesize",
                    &m.bytes.to_string(),
                    "--output",
                ])
                .arg(tmp.path())
                .arg(&m.url)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(err)?;
            loop {
                if check().is_err() {
                    let _ = curl.kill();
                    let _ = curl.wait();
                    return check();
                }
                let n = fs::metadata(tmp.path()).map(|v| v.len()).unwrap_or(0);
                update("download", n);
                if let Some(exit) = curl.try_wait().map_err(err)? {
                    if !exit.success() {
                        return Err(
                            "다운로드에 실패했어요. 인터넷 연결과 저장 공간을 확인해 주세요."
                                .into(),
                        );
                    }
                    break;
                }
                thread::sleep(Duration::from_millis(150));
            }
            update("verify", m.bytes);
            verify(tmp.path(), &m, check)?;
            check()?;
            tmp.persist(target).map_err(err)?;
            Ok(())
        })();
        let mut s = d.state.lock().unwrap();
        s.stage = if outcome.is_ok() { "done" } else { "stopped" }.into();
        s.error = outcome.err().unwrap_or_default();
    }));
    Ok(())
}
