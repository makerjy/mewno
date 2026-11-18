use crate::{
    models,
    store::{err, Result, Store},
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use std::{
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

const RATE: u64 = 16000;
const CHUNK: usize = 16000 * 300;
pub struct Task {
    pub id: String,
    pub source: PathBuf,
    pub model: String,
    pub lang: String,
    pub mode: String,
    pub hint: String,
    pub cpu: bool,
}
pub struct Runtime {
    pub store: Store,
    pub bin: PathBuf,
    pub stop: Arc<AtomicBool>,
}
#[derive(Deserialize)]
struct Offsets {
    from: i64,
    to: i64,
}
#[derive(Deserialize)]
struct Line {
    offsets: Offsets,
    // Whisper token boundaries occasionally cut through a UTF-8 character.
    #[serde(deserialize_with = "recognizer_bytes")]
    text: Vec<u8>,
}
fn recognizer_bytes<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Vec<u8>, D::Error> {
    struct Bytes;
    impl<'de> serde::de::Visitor<'de> for Bytes {
        type Value = Vec<u8>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a recognizer JSON string")
        }
        fn visit_bytes<E: serde::de::Error>(self, b: &[u8]) -> std::result::Result<Vec<u8>, E> {
            Ok(b.to_vec())
        }
    }
    d.deserialize_bytes(Bytes)
}

#[derive(Deserialize)]
struct Detection {
    language: String,
}
#[derive(Deserialize)]
pub struct Output {
    result: Detection,
    transcription: Vec<Line>,
}
pub trait TranscriptionBackend {
    fn recognize(&self, t: &Task, wav: &Path, prefix: &Path, lang: &str) -> Result<Output>;
}
impl Runtime {
    pub fn check(&self, id: &str) -> Result<()> {
        if self.stop.load(Ordering::Acquire) {
            return Err("앱이 종료됐어요.".into());
        }
        let active: bool = self
            .store
            .db()?
            .query_row(
                "SELECT status NOT IN ('cancelling','cancelled') FROM jobs WHERE id=?",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if active {
            Ok(())
        } else {
            Err("취소했어요.".into())
        }
    }
    fn stage(&self, id: &str, status: &str, msg: &str) -> Result<()> {
        self.check(id)?;
        let n = self
            .store
            .db()?
            .execute(
                "UPDATE jobs SET status=?,message=? WHERE id=? AND status!='cancelling'",
                params![status, msg, id],
            )
            .map_err(err)?;
        if n == 1 {
            Ok(())
        } else {
            Err("취소했어요.".into())
        }
    }
    fn run_child(&self, id: &str, cmd: &mut Command) -> Result<bool> {
        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(err)?;
        loop {
            if let Err(e) = self.check(id) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
            if let Some(exit) = child.try_wait().map_err(err)? {
                return Ok(exit.success());
            }
            thread::sleep(Duration::from_millis(140));
        }
    }
    fn decode(&self, t: &Task, raw: &Path) -> Result<()> {
        if t.mode == "wav" {
            let mut reader = hound::WavReader::open(&t.source)
                .map_err(|_| "수동 모드는 16 kHz 모노 PCM16 WAV 파일을 사용해요.")?;
            let spec = reader.spec();
            if spec.channels != 1
                || spec.sample_rate != 16000
                || spec.bits_per_sample != 16
                || spec.sample_format != hound::SampleFormat::Int
            {
                return Err("16 kHz 모노 PCM16 WAV가 아니에요. 자동 인식을 선택해 주세요.".into());
            }
            let mut out = std::io::BufWriter::new(File::create(raw).map_err(err)?);
            for (n, s) in reader.samples::<i16>().enumerate() {
                if n % 65536 == 0 {
                    self.check(&t.id)?
                }
                out.write_all(&s.map_err(err)?.to_le_bytes()).map_err(err)?
            }
            out.flush().map_err(err)
        } else {
            let ok = self.run_child(
                &t.id,
                Command::new(self.bin.join("mewno-decode"))
                    .arg(&t.source)
                    .arg(raw),
            )?;
            if ok {
                Ok(())
            } else {
                Err("오디오 트랙을 읽을 수 없어요. 코덱 미지원, 손상, 암호화 또는 저장 공간 부족을 확인해 주세요.".into())
            }
        }
    }
    pub fn process(&self, t: &Task) -> Result<()> {
        let w = tempfile::tempdir_in(self.store.0.join("work")).map_err(err)?;
        self.stage(&t.id, "analyzing", "")?;
        if !t.source.is_file() {
            return Err(
                "원본 파일이 이동되거나 삭제됐어요. 원본 위치를 복원한 뒤 다시 시도해 주세요."
                    .into(),
            );
        }
        let m = models::model(&t.model)?;
        models::verify(&models::path(&self.store, &m), &m, || self.check(&t.id))?;
        self.stage(&t.id, "preprocessing", "")?;
        let raw = w.path().join("audio.pcm");
        let source_identity = crate::store::identity(&t.source)?;
        self.decode(t, &raw)?;
        if crate::store::identity(&t.source)? != source_identity {
            return Err("변환 중 원본이 바뀌었어요. 다시 시도해 주세요.".into());
        }
        let frames = fs::metadata(&raw).map_err(err)?.len() / 2;
        let duration = (frames * 1000 / RATE) as i64;
        let mut input = BufReader::new(File::open(raw).map_err(err)?);
        let mut offset = 0u64;
        let mut lines = Vec::new();
        let mut lang = t.lang.clone();
        let mut detected = String::new();
        let wav = w.path().join("chunk.wav");
        let prefix = w.path().join("result");
        while offset < frames {
            self.check(&t.id)?;
            let n = (frames - offset).min(CHUNK as u64) as usize;
            let mut bytes = vec![0; n * 2];
            input.read_exact(&mut bytes).map_err(err)?;
            let samples = || {
                bytes
                    .chunks_exact(2)
                    .map(|b| i16::from_le_bytes([b[0], b[1]]))
            };
            if samples().any(|s| s.unsigned_abs() > 4) {
                let mut writer = hound::WavWriter::create(
                    &wav,
                    hound::WavSpec {
                        channels: 1,
                        sample_rate: RATE as u32,
                        bits_per_sample: 16,
                        sample_format: hound::SampleFormat::Int,
                    },
                )
                .map_err(err)?;
                for s in samples() {
                    writer.write_sample(s).map_err(err)?
                }
                writer.finalize().map_err(err)?;
                self.stage(
                    &t.id,
                    "loading",
                    &format!(
                        "{} / {} 구간",
                        offset / CHUNK as u64 + 1,
                        frames.div_ceil(CHUNK as u64)
                    ),
                )?;
                let result = self.recognize(t, &wav, &prefix, &lang)?;
                if !result.transcription.is_empty() && !result.result.language.is_empty() {
                    detected = result.result.language;
                    if lang == "auto" {
                        lang = detected.clone()
                    }
                }
                let base = (offset * 1000 / RATE) as i64;
                let limit = (n as i64) * 1000 / RATE as i64;
                for l in result.transcription {
                    if !String::from_utf8_lossy(&l.text).trim().is_empty() {
                        let start = l.offsets.from.clamp(0, limit);
                        let end = l.offsets.to.clamp(start, limit);
                        lines.push((base + start, base + end, l.text));
                    }
                }
            }
            offset += n as u64;
        }
        if lines.is_empty() {
            return Err("인식된 음성이 없어요. 무음 여부와 오디오 트랙을 확인해 주세요.".into());
        }
        let mut db = self.store.db()?;
        let tx = db.transaction().map_err(err)?;
        let n=tx.execute("UPDATE jobs SET status='completed',message='',duration=?,detected=? WHERE id=? AND status!='cancelling'",params![duration,detected,t.id]).map_err(err)?;
        if n != 1 {
            return Err("취소했어요.".into());
        }
        tx.execute(
            "INSERT OR REPLACE INTO sources VALUES(?,?)",
            params![t.id, source_identity],
        )
        .map_err(err)?;
        for (i, (start, end, bytes)) in lines.iter().enumerate() {
            let raw = String::from_utf8_lossy(bytes);
            tx.execute(
                "INSERT INTO segments VALUES(?,?,?,?,?,?)",
                params![t.id, i, start, end, raw.as_ref(), raw.trim()],
            )
            .map_err(err)?;
            if matches!(raw, std::borrow::Cow::Owned(_)) {
                tx.execute(
                    "INSERT INTO encoding_errors VALUES(?,?,?)",
                    params![t.id, i, bytes],
                )
                .map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }
    pub fn next(&self) -> Result<bool> {
        let db = self.store.db()?;
        let task=db.query_row("SELECT id,path,model,lang,mode,hint,cpu FROM jobs WHERE status='queued' ORDER BY rowid LIMIT 1",[],|r|Ok(Task{id:r.get(0)?,source:PathBuf::from(r.get::<_,String>(1)?),model:r.get(2)?,lang:r.get(3)?,mode:r.get(4)?,hint:r.get(5)?,cpu:r.get(6)?})).optional().map_err(err)?;
        let Some(t) = task else { return Ok(false) };
        if db
            .execute(
                "UPDATE jobs SET status='analyzing' WHERE id=? AND status='queued'",
                [&t.id],
            )
            .map_err(err)?
            == 0
        {
            return Ok(true);
        }
        if let Err(e) = self.process(&t) {
            db.execute("UPDATE jobs SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'failed' END,message=? WHERE id=?",params![e,t.id]).map_err(err)?;
        }
        Ok(true)
    }
}
impl TranscriptionBackend for Runtime {
    fn recognize(&self, t: &Task, wav: &Path, prefix: &Path, lang: &str) -> Result<Output> {
        let model = models::path(&self.store, &models::model(&t.model)?);
        let mut attempts = vec![t.cpu];
        if !t.cpu {
            attempts.push(true)
        }
        for cpu in attempts {
            self.check(&t.id)?;
            let mut cmd = Command::new(self.bin.join("whisper-cli"));
            cmd.arg("-m")
                .arg(&model)
                .arg("-f")
                .arg(wav)
                .args(["-l", lang, "-oj", "-of"])
                .arg(prefix);
            if cpu {
                cmd.arg("-ng");
            }
            if !t.hint.is_empty() {
                cmd.args(["--prompt", &t.hint]);
            }
            self.stage(&t.id, "transcribing", if cpu { "CPU" } else { "자동 가속" })?;
            if self.run_child(&t.id, &mut cmd)? {
                let json = prefix.with_extension("json");
                if json.is_file() {
                    let parsed =
                        serde_json::from_reader(File::open(&json).map_err(err)?).map_err(err);
                    fs::remove_file(json).map_err(err)?;
                    return parsed;
                }
            }
        }
        Err("전사 엔진 실행에 실패했어요. 작은 모델로 다시 시도해 주세요.".into())
    }
}

#[cfg(test)]
mod encoding_tests {
    use super::*;
    #[test]
    fn retains_non_utf8_token_bytes() {
        let mut json=br#"{"result":{"language":"ko"},"transcription":[{"offsets":{"from":0,"to":1000},"text":"a"#.to_vec();
        json.extend_from_slice(&[0xed, 0x95]);
        json.extend_from_slice(br#"b"}]}"#);
        let parsed: Output = serde_json::from_reader(&json[..]).unwrap();
        assert_eq!(parsed.transcription[0].text, b"a\xed\x95b");
        assert_eq!(
            String::from_utf8_lossy(&parsed.transcription[0].text),
            "a�b"
        );
    }
}
