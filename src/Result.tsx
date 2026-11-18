import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";
import { clock, type Job, type Segment } from "./types";
type Data = { path: string | null; segments: Segment[] };
export function Result({
  job,
  back,
  notify,
  guard,
}: {
  job: Job;
  back: () => void;
  notify: (s: string) => void;
  guard: React.MutableRefObject<() => Promise<boolean>>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [raw, setRaw] = useState(false),
    [status, setStatus] = useState(""),
    [time, setTime] = useState(0),
    [playError, setPlayError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null),
    chain = useRef(Promise.resolve()),
    pending = useRef(new Map<number, string>());
  const viewport = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const rows = useVirtualizer({
    count: data?.segments.length ?? 0,
    getScrollElement: () => viewport.current,
    estimateSize: () => 76,
    getItemKey: (index) => data!.segments[index].seq,
    overscan: 4,
  });
  const currentIndex = data?.segments.findIndex((s) => s.start <= time && time < s.end) ?? -1;
  useEffect(() => {
    if (following && currentIndex >= 0) {
      rows.scrollToIndex(currentIndex, { align: "auto" });
    }
  }, [currentIndex, following, rows]);
  useEffect(() => {
    let live = true;
    invoke<Data>("result", { id: job.id })
      .then((v) => live && setData(v))
      .catch((e) => live && notify(String(e)));
    return () => {
      live = false;
    };
  }, [job.id]);
  function save(seq: number, text: string) {
    pending.current.set(seq, text);
    setStatus("저장 중…");
    chain.current = chain.current.then(async () => {
      if (pending.current.get(seq) !== text) return;
      try {
        await invoke("edit_segment", { id: job.id, seq, text });
        if (pending.current.get(seq) === text) pending.current.delete(seq);
        if (!pending.current.size) setStatus("저장됨");
      } catch (e) {
        setStatus("저장 실패 · 다시 저장해 주세요");
        notify(String(e));
      }
    });
  }
  async function flush() {
    for (const [seq, text] of pending.current) save(seq, text);
    await chain.current;
    return pending.current.size === 0;
  }
  useEffect(() => {
    guard.current = flush;
    const off = getCurrentWindow().onCloseRequested(async (e) => {
      if (pending.current.size) {
        e.preventDefault();
        if (await flush()) await getCurrentWindow().destroy();
      }
    });
    return () => {
      guard.current = async () => true;
      void off.then((f) => f());
    };
  }, [job.id]);
  async function exportFile() {
    try {
      if ((await flush()) && (await invoke<boolean>("export_md", { id: job.id })))
        notify("Markdown 파일을 저장했어요.");
    } catch (e) {
      notify(String(e));
    }
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void exportFile();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <>
      <button className="text-button back" onClick={back}>
        ← 내 기록으로
      </button>
      <section className="result-heading">
        <span className="file-icon sage">
          <Icon name="file" size={27} />
        </span>
        <div>
          <h1>{job.name}</h1>
          <p>
            {clock(job.duration)} · {job.detected} · Whisper {job.model}
          </p>
        </div>
      </section>
      {data && (
        <>
          <section className="result-card">
            <div className="result-player">
              {data.path ? (
                <>
                  <audio
                    ref={audio}
                    controls
                    preload="metadata"
                    src={convertFileSrc(data.path)}
                    aria-label="원본 오디오 재생"
                    onSeeked={(e) => setTime(e.currentTarget.currentTime * 1000)}
                    onTimeUpdate={(e) => setTime(e.currentTarget.currentTime * 1000)}
                    onError={() => setPlayError(true)}
                  />
                  {playError && <p>원본의 위치 또는 재생 코덱을 확인해 주세요.</p>}
                </>
              ) : (
                <p>원본이 이동되거나 바뀌었어요. 전사에 사용한 원본을 복원하면 재생할 수 있어요.</p>
              )}
              {data.path && !playError && (
                <button
                  className="secondary follow-control"
                  aria-pressed={following}
                  onClick={() => setFollowing((value) => !value)}
                >
                  {following ? "✓ 재생 따라가기" : "재생 따라가기"}
                </button>
              )}
            </div>
            <div className="result-toolbar">
              <div className="tabs">
                <button className={!raw ? "active" : ""} onClick={() => setRaw(false)}>
                  편집본
                </button>
                <button className={raw ? "active" : ""} onClick={() => setRaw(true)}>
                  인식 원문
                </button>
              </div>
              <div className="result-actions">
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        data.segments.map((s) => s.edited).join("\n"),
                      );
                      notify("편집본을 복사했어요.");
                    } catch (e) {
                      notify(String(e));
                    }
                  }}
                >
                  <Icon name="copy" size={15} />
                  편집본 복사
                </button>
                <button className="primary" onClick={exportFile}>
                  <Icon name="download" size={15} />
                  Markdown 저장
                </button>
              </div>
            </div>
            <div
              className="transcript-viewport"
              ref={viewport}
              tabIndex={0}
              role="region"
              aria-label="전사문"
              onWheel={() => setFollowing(false)}
              onTouchMove={() => setFollowing(false)}
              onPointerDown={(e) => {
                if (e.target === viewport.current) setFollowing(false);
              }}
              onKeyDown={(e) => {
                if (
                  ["ArrowDown", "ArrowUp", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)
                )
                  setFollowing(false);
              }}
            >
              <div className="transcript-spacer" style={{ height: rows.getTotalSize() }}>
                {rows.getVirtualItems().map((item) => {
                  const s = data.segments[item.index];
                  return (
                    <div
                      key={s.seq}
                      data-index={item.index}
                      ref={rows.measureElement}
                      style={{ transform: `translateY(${item.start}px)` }}
                      aria-current={item.index === currentIndex ? "time" : undefined}
                      className={
                        "transcript-line " + (item.index === currentIndex ? "current" : "")
                      }
                    >
                      <button
                        className="timestamp"
                        disabled={!data.path || playError}
                        aria-label={clock(s.start) + "로 이동"}
                        onClick={() => {
                          if (audio.current) audio.current.currentTime = s.start / 1000;
                        }}
                      >
                        {clock(s.start)}
                      </button>
                      {s.encoding_warning && (
                        <small className="encoding-note">일부 글자 확인 필요</small>
                      )}
                      {raw ? (
                        <p>{s.raw}</p>
                      ) : (
                        <textarea
                          aria-label={clock(s.start) + " 구간 편집"}
                          rows={1}
                          onFocus={() => setFollowing(false)}
                          value={s.edited}
                          onChange={(e) => {
                            const text = e.target.value;
                            setData({
                              ...data,
                              segments: data.segments.map((v) =>
                                v.seq === s.seq ? { ...v, edited: text } : v,
                              ),
                            });
                            save(s.seq, text);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
          <div className="panel-row">
            <span role="status">{status}</span>
            {status.startsWith("저장 실패") && (
              <button className="secondary" onClick={flush}>
                다시 저장
              </button>
            )}
            <button disabled className="secondary">
              AI로 문서 정리
            </button>
            <small>로컬 문서 모델 설치는 후속 버전에서 지원합니다.</small>
          </div>
        </>
      )}
    </>
  );
}
