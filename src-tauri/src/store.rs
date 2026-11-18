use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone)]
pub struct Store(pub PathBuf);
#[derive(Serialize)]
pub struct Job {
    pub id: String,
    pub name: String,
    pub status: String,
    pub model: String,
    pub lang: String,
    pub duration: i64,
    pub message: String,
    pub detected: String,
}
#[derive(Serialize, Debug)]
pub struct Segment {
    pub seq: i64,
    pub start: i64,
    pub end: i64,
    pub raw: String,
    pub edited: String,
    pub encoding_warning: bool,
}
impl Store {
    pub fn init(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("models")).map_err(err)?;
        // A single-instance lock is held before startup. Only our disposable work lives here.
        let work = root.join("work");
        if work.is_dir() {
            fs::remove_dir_all(&work).map_err(err)?;
        }
        fs::create_dir(&work).map_err(err)?;
        let s = Self(root);
        s.db()?.execute_batch("PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,path TEXT NOT NULL,name TEXT NOT NULL,
            model TEXT NOT NULL,lang TEXT NOT NULL,mode TEXT NOT NULL,hint TEXT NOT NULL,cpu INTEGER NOT NULL,
            status TEXT NOT NULL,message TEXT NOT NULL DEFAULT '',duration INTEGER NOT NULL DEFAULT 0,detected TEXT NOT NULL DEFAULT '');
          CREATE TABLE IF NOT EXISTS segments(job TEXT REFERENCES jobs(id) ON DELETE CASCADE,
            seq INTEGER,start INTEGER,end INTEGER,raw TEXT NOT NULL,edited TEXT NOT NULL,PRIMARY KEY(job,seq));
          CREATE TABLE IF NOT EXISTS encoding_errors(job TEXT, seq INTEGER, bytes BLOB NOT NULL, PRIMARY KEY(job,seq),FOREIGN KEY(job,seq) REFERENCES segments(job,seq) ON DELETE CASCADE);
          CREATE TABLE IF NOT EXISTS sources(job TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,identity TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS prefs(k TEXT PRIMARY KEY,v TEXT NOT NULL);
          UPDATE jobs SET status='failed',message='앱 종료로 중단됐어요. 다시 시도할 수 있어요.'
            WHERE status IN ('analyzing','preprocessing','loading','transcribing','cancelling');").map_err(err)?;
        Ok(s)
    }
    pub fn db(&self) -> Result<Connection> {
        let db = Connection::open(self.0.join("mewno.sqlite3")).map_err(err)?;
        db.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        db.execute_batch("PRAGMA foreign_keys=ON").map_err(err)?;
        Ok(db)
    }
    pub fn jobs(&self) -> Result<Vec<Job>> {
        let db = self.db()?;
        let mut stmt=db.prepare("SELECT id,name,status,model,lang,duration,message,detected FROM jobs ORDER BY rowid DESC").map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Job {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    status: r.get(2)?,
                    model: r.get(3)?,
                    lang: r.get(4)?,
                    duration: r.get(5)?,
                    message: r.get(6)?,
                    detected: r.get(7)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)
    }
    pub fn segments(&self, id: &str) -> Result<Vec<Segment>> {
        let db = self.db()?;
        let mut stmt = db
            .prepare("SELECT s.seq,s.start,s.end,s.raw,s.edited,e.seq IS NOT NULL FROM segments s LEFT JOIN encoding_errors e ON e.job=s.job AND e.seq=s.seq WHERE s.job=? ORDER BY s.seq")
            .map_err(err)?;
        let rows = stmt
            .query_map([id], |r| {
                Ok(Segment {
                    seq: r.get(0)?,
                    start: r.get(1)?,
                    end: r.get(2)?,
                    raw: r.get(3)?,
                    edited: r.get(4)?,
                    encoding_warning: r.get(5)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)
    }
    pub fn edit(&self, id: &str, seq: i64, text: &str) -> Result<()> {
        let count = self
            .db()?
            .execute(
                "UPDATE segments SET edited=? WHERE job=? AND seq=?",
                params![text, id, seq],
            )
            .map_err(err)?;
        if count == 1 {
            Ok(())
        } else {
            Err("수정할 구간을 찾을 수 없어요.".into())
        }
    }
    pub fn path(&self, id: &str) -> Result<PathBuf> {
        self.db()?
            .query_row("SELECT path FROM jobs WHERE id=?", [id], |r| {
                r.get::<_, String>(0)
            })
            .map(PathBuf::from)
            .map_err(err)
    }
}
pub fn stamp(ms: i64) -> String {
    let s = ms / 1000;
    format!("{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
}
pub fn markdown(job: &Job, segments: &[Segment]) -> String {
    let mut s = format!(
        "# {}\n\n- 길이 {}\n- 모델 Whisper {}\n",
        job.name,
        stamp(job.duration),
        job.model
    );
    if !job.detected.is_empty() {
        s.push_str(&format!("- 언어 {}\n", job.detected));
    }
    for seg in segments {
        s.push_str(&format!("\n[{}] {}\n", stamp(seg.start), seg.edited));
    }
    s
}
pub fn stem(name: &str) -> String {
    format!(
        "{}_transcript.md",
        Path::new(name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
    )
}

pub fn identity(path: &Path) -> Result<String> {
    use std::os::unix::fs::MetadataExt;
    let m = fs::metadata(path).map_err(err)?;
    Ok(format!(
        "{}:{}:{}:{}:{}",
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec()
    ))
}
