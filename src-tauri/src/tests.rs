use super::*;
use std::path::PathBuf;
fn options(lang: &str, mode: &str, cpu: bool) -> Options {
    Options {
        model: "base".into(),
        lang: lang.into(),
        mode: mode.into(),
        cpu,
        hint: String::new(),
    }
}
fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(name)
}
#[test]
fn queue_recovery_and_deletion() {
    let root = tempfile::tempdir().unwrap();
    let s = Store::init(root.path().into()).unwrap();
    let m = models::model("base").unwrap();
    fs::write(models::path(&s, &m), b"bad weights").unwrap();
    let file = fixture("tests/fixtures/greetings.mp3")
        .display()
        .to_string();
    let b = queue(&s, vec![file.clone(), file], options("ko", "auto", true)).unwrap();
    assert_eq!((b.added, b.skipped), (1, 1));
    let id = s.jobs().unwrap().remove(0).id;
    change_job(&s, &id, "cancel").unwrap();
    assert_eq!(s.jobs().unwrap()[0].status, "cancelled");
    change_job(&s, &id, "retry").unwrap();
    assert!(models::verify(&models::path(&s, &m), &m, || Ok(())).is_err());
    s.db()
        .unwrap()
        .execute("UPDATE jobs SET status='transcribing'", [])
        .unwrap();
    let s = Store::init(root.path().into()).unwrap();
    assert_eq!(s.jobs().unwrap()[0].status, "failed");
    change_job(&s, &id, "delete").unwrap();
    assert!(s.jobs().unwrap().is_empty());
    assert!(fixture("tests/fixtures/greetings.mp3").exists());
}
#[test]
fn batch_is_atomic() {
    let root = tempfile::tempdir().unwrap();
    let s = Store::init(root.path().into()).unwrap();
    fs::write(models::path(&s, &models::model("base").unwrap()), b"x").unwrap();
    assert!(queue(
        &s,
        vec![
            fixture("tests/fixtures/greetings.mp3")
                .display()
                .to_string(),
            root.path().join("missing.mp3").display().to_string()
        ],
        options("auto", "auto", false)
    )
    .is_err());
    assert!(s.jobs().unwrap().is_empty())
}
#[test]
fn manifest_and_timestamps() {
    let catalog = models::catalog();
    assert_eq!(catalog.len(), 3);
    for m in catalog {
        assert!(m
            .url
            .starts_with("https://huggingface.co/ggerganov/whisper.cpp/resolve/"));
        assert_eq!(m.sha256.len(), 64)
    }
    assert_eq!(store::stamp(3622080), "01:00:22");
    assert_eq!(store::stem("긴 녹음.1.m4a"), "긴 녹음.1_transcript.md")
}
#[test]
#[ignore = "requires packaged sidecars, verified Base weights and generated public audio fixtures"]
fn real_recordings() {
    let root = tempfile::tempdir().unwrap();
    let s = Store::init(root.path().into()).unwrap();
    fs::hard_link(
        fixture(".build/ggml-base.bin"),
        models::path(&s, &models::model("base").unwrap()),
    )
    .unwrap();
    let bin = std::env::var_os("MEWNO_TEST_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            fixture("src-tauri/target/release/bundle/macos/Mewno.app/Contents/MacOS")
        });
    let rt = Runtime {
        store: s.clone(),
        bin,
        stop: Default::default(),
    };
    for (file, lang, mode, cpu) in [
        ("tests/fixtures/greetings.mp3", "auto", "auto", false),
        (".build/greetings.m4a", "ko", "auto", true),
        (".build/greetings.wav", "ko", "wav", true),
        (".build/test-video.mp4", "auto", "auto", false),
        (".build/hour.wav", "ko", "wav", true),
    ] {
        let src = fixture(file);
        queue(
            &s,
            vec![src.display().to_string()],
            options(lang, mode, cpu),
        )
        .unwrap();
        assert!(rt.next().unwrap());
        let job = s.jobs().unwrap().remove(0);
        assert_eq!(job.status, "completed", "{file}: {}", job.message);
        let seg = s.segments(&job.id).unwrap();
        assert_eq!(job.detected, "ko");
        assert!(seg
            .iter()
            .any(|s| s.raw.contains("반갑습니다") || s.raw.contains("안녕")));
        assert!(seg.windows(2).all(|p| p[0].start <= p[1].start));
        assert!(seg.last().unwrap().end <= job.duration);
        if file.contains("hour") {
            assert!(seg.first().unwrap().start >= 3600000)
        }
        println!(
            "{file} → {} ms, {} segments, first offset {}",
            job.duration,
            seg.len(),
            seg[0].start
        );
        s.edit(&job.id, 0, "수정된 한국어 문장").unwrap();
        let reopened = Store::init(root.path().into()).unwrap();
        let saved = reopened.segments(&job.id).unwrap();
        assert_eq!(saved[0].raw, seg[0].raw);
        assert!(store::markdown(&job, &saved).contains("수정된 한국어 문장"));
    }
    let silent = root.path().join("silent.wav");
    let mut w = hound::WavWriter::create(
        &silent,
        hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )
    .unwrap();
    for _ in 0..16000 {
        w.write_sample(0i16).unwrap()
    }
    w.finalize().unwrap();
    queue(
        &s,
        vec![silent.display().to_string()],
        options("ko", "wav", true),
    )
    .unwrap();
    rt.next().unwrap();
    assert!(s.jobs().unwrap()[0].message.contains("무음"));
    let source = fixture("tests/fixtures/greetings.mp3");
    queue(
        &s,
        vec![source.display().to_string()],
        options("ko", "auto", true),
    )
    .unwrap();
    let id = s.jobs().unwrap().remove(0).id;
    thread::scope(|scope| {
        let worker = scope.spawn(|| rt.next().unwrap());
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while s.jobs().unwrap()[0].status != "transcribing" {
            assert!(
                std::time::Instant::now() < deadline,
                "job never entered inference"
            );
            thread::sleep(Duration::from_millis(10));
        }
        change_job(&s, &id, "cancel").unwrap();
        assert!(worker.join().unwrap());
    });
    assert_eq!(s.jobs().unwrap()[0].status, "cancelled");
    assert!(s.segments(&id).unwrap().is_empty());
    change_job(&s, &id, "retry").unwrap();
    rt.next().unwrap();
    assert_eq!(s.jobs().unwrap()[0].status, "completed");
}
