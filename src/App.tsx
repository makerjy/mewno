import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Icon, type IconName } from "./Icon";
import { Result } from "./Result";
import { Setup } from "./Setup";
import {
  defaults,
  recommend,
  labels,
  clock,
  type Snapshot,
  type Device,
  type Prefs,
  type Job,
} from "./types";
type Page = "new" | "history" | "result" | "setup" | "models" | "settings";
const nav: { id: Page; icon: IconName; label: string }[] = [
  { id: "new", icon: "plus", label: "새 전사" },
  { id: "history", icon: "history", label: "내 기록" },
  { id: "models", icon: "model", label: "모델 관리" },
  { id: "settings", icon: "settings", label: "설정" },
];
const initial: Snapshot = {
  jobs: [],
  models: [],
  transfer: { id: "", stage: "", bytes: 0, error: "" },
};
const filename = (path: string) => path.split("/").pop() ?? path;
export default function App() {
  const [page, route] = useState<Page>("new"),
    [ready, setReady] = useState(false),
    [prefs, setPrefs] = useState(defaults),
    [snap, setSnap] = useState(initial),
    [device, setDevice] = useState<Device | null>(null);
  const [files, setFiles] = useState<string[]>([]),
    [drag, setDrag] = useState(false),
    [toast, setToast] = useState(""),
    [selected, select] = useState(""),
    [query, setQuery] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const guard = useRef<() => Promise<boolean>>(async () => true),
    prefRef = useRef(prefs),
    prefWrites = useRef(Promise.resolve());
  const dark = prefs.theme === "dark" || (prefs.theme === "system" && systemDark),
    records = snap.jobs;
  const rec = recommend(device, prefs.preference, snap.models);
  const automatic =
    snap.models.find((m) => m.id === rec && m.installed)?.id ??
    snap.models.find((m) => m.installed)?.id ??
    rec;
  const effective = prefs.model === "auto" ? automatic : prefs.model;
  const installed = snap.models.some((m) => m.id === effective && m.installed);
  const current = records.find((r) => r.id === selected);
  const working = records.some((r) => !["failed", "completed", "cancelled"].includes(r.status));
  const transcribed = records[0]?.status === "completed",
    file = files[0],
    uploadState = working ? "working" : file ? "ready" : transcribed ? "complete" : "idle";
  const refresh = async () => setSnap(await invoke<Snapshot>("snapshot"));
  function update(v: Partial<Prefs>) {
    const next = { ...prefRef.current, ...v };
    prefRef.current = next;
    setPrefs(next);
    prefWrites.current = prefWrites.current
      .then(() => invoke<void>("set_preferences", { value: JSON.stringify(next) }))
      .catch((e) => setToast("설정 저장 실패 · " + String(e)));
  }
  async function setPage(p: Page) {
    if (await guard.current()) route(p);
  }
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [saved, state] = await Promise.all([
          invoke<string | null>("preferences"),
          invoke<Snapshot>("snapshot"),
        ]);
        if (!live) return;
        const p = { ...defaults, ...(saved ? JSON.parse(saved) : {}) };
        setPrefs(p);
        prefRef.current = p;
        setSnap(state);
        route(p.ready ? "new" : "setup");
        setReady(true);
      } catch (e) {
        if (live) setToast("작업 공간 열기 실패 · " + String(e));
      }
    })();
    invoke<Device>("device")
      .then((d) => live && setDevice(d))
      .catch((e) => live && setToast(String(e)));
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const s = await invoke<Snapshot>("snapshot");
        if (live) {
          setSnap(s);
          const paths = await invoke<string[]>("take_imports");
          if (live && paths.length) {
            add(paths);
            void setPage("new");
          }
        }
      } catch (e) {
        if (live) setToast(String(e));
      }
      if (live) timer = setTimeout(poll, 650);
    }
    timer = setTimeout(poll, 650);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(media.matches);
    media.addEventListener("change", sync);
    return () => {
      live = false;
      clearTimeout(timer);
      media.removeEventListener("change", sync);
    };
  }, []);
  function add(paths: string[]) {
    setFiles((old) => Array.from(new Set([...old, ...paths])));
  }
  useEffect(() => {
    let live = true;
    const off = getCurrentWebview().onDragDropEvent((e) => {
      if (!live) return;
      const p = e.payload;
      setDrag(p.type === "over" || p.type === "enter");
      if (p.type === "drop") {
        add(p.paths);
        void setPage("new");
      }
    });
    return () => {
      live = false;
      void off.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void setPage("new");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function browse() {
    try {
      const paths = await invoke<string[]>("pick_media");
      if (paths) add(paths);
    } catch (e) {
      setToast(String(e));
    }
  }
  async function start() {
    if (!installed) {
      await setPage("models");
      return;
    }
    if (!files.length || submitting) return;
    setSubmitting(true);
    try {
      const paths = [...files];
      const hint = [
        prefs.field === "일반" ? "" : prefs.field === "직접 입력" ? prefs.customField : prefs.field,
        prefs.hint,
      ]
        .filter(Boolean)
        .join(", ");
      const b = await invoke<{ added: number; skipped: number }>("enqueue", {
        paths,
        options: { model: effective, lang: prefs.lang, mode: prefs.mode, hint, cpu: prefs.cpu },
      });
      setFiles((old) => old.filter((p) => !paths.includes(p)));
      setToast(b.added + "개 작업 추가" + (b.skipped ? " · 중복 " + b.skipped + "개 제외" : ""));
      await refresh();
    } catch (e) {
      setToast(String(e));
    } finally {
      setSubmitting(false);
    }
  }
  async function act(j: Job, action: string) {
    try {
      if (
        action === "delete" &&
        !(await confirm("이 전사 기록과 수정 내용을 삭제할까요? 원본 녹음은 보존됩니다."))
      )
        return;
      await invoke("job_action", { id: j.id, action });
      await refresh();
    } catch (e) {
      setToast(String(e));
    }
  }
  function recordList(all = false) {
    const list = all
      ? records.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
      : records.slice(0, 3);
    return (
      <div className="records">
        {list.map((r) => (
          <div className="record" key={r.id}>
            <span className="file-icon sage">
              <Icon name="file" size={23} />
            </span>
            <div className="record-info">
              <strong>{r.name}</strong>
              <span>
                {r.duration ? clock(r.duration) + " · " : ""}Whisper {r.model} · {labels[r.status]}{" "}
                {r.message}
              </span>
            </div>
            {r.status === "completed" ? (
              <button
                className="secondary"
                onClick={() => {
                  select(r.id);
                  void setPage("result");
                }}
              >
                결과 열기
              </button>
            ) : ["failed", "cancelled"].includes(r.status) ? (
              <button className="secondary" onClick={() => act(r, "retry")}>
                재시도
              </button>
            ) : (
              <button
                disabled={r.status === "cancelling"}
                className="secondary"
                onClick={() => act(r, "cancel")}
              >
                취소
              </button>
            )}
            {all && ["completed", "failed", "cancelled"].includes(r.status) && (
              <button className="text-button" onClick={() => act(r, "delete")}>
                삭제
              </button>
            )}
          </div>
        ))}
        {!list.length && (
          <p className="empty">
            {query && all ? "검색 결과가 없어요." : "아직 전사 기록이 없어요."}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className={`app ${dark ? "dark" : ""}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("new");
          }}
        >
          <svg
            className="cat cat-small"
            viewBox="0 0 184 134"
            fill="none"
            aria-label="음성 노트를 안고 미소 짓는 뮤노 고양이"
            role="img"
          >
            <image
              href={dark ? "/images/mewno-note-cat-dark.png" : "/images/mewno-note-cat.png"}
              width={184}
              height={134}
            />
          </svg>
          <span style={{ flex: "1 1 0%", minWidth: 0, maxWidth: 138, lineHeight: 0 }}>
            <img
              src="/images/mewno-wordmark.png"
              alt="mewno"
              width={268}
              height={90}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                filter: dark ? "brightness(1.9) saturate(0.65)" : "none",
              }}
            />
          </span>
        </a>
        <div className="workspace-label">나만의 작은 기록 공간</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id || (page === "result" && n.id === "history") ? "active" : ""}`}
              onClick={() => setPage(n.id)}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.id === "new" && <span className="shortcut">⌘ N</span>}
              {n.id === "history" && <span className="count">{records.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-status" title="파일은 외부 서버에 업로드되지 않아요.">
            <Icon name="shield" size={16} />
            <span>내 기기에서 안전하게</span>
            <span className="status-dot" />
          </div>
          <div className="sidebar-foot">
            <span>
              mewno <small>v0.1.2</small>
            </span>
            <div className="theme-switch">
              <button
                className={!dark ? "selected" : ""}
                onClick={() => update({ theme: "light" })}
                aria-label="라이트 모드"
              >
                <Icon name="sun" size={16} />
              </button>
              <button
                className={dark ? "selected" : ""}
                onClick={() => update({ theme: "dark" })}
                aria-label="다크 모드"
              >
                <Icon name="moon" size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">내 작업 공간</span>
            <Icon name="chevron" size={13} />
            <span>
              {page === "result"
                ? "전사 결과"
                : page === "setup"
                  ? "초기 설정"
                  : nav.find((n) => n.id === page)?.label}
            </span>
          </div>
          <div className="top-status">
            <span className="status-dot" />
            로컬 모드
            <span className="top-divider" />
            <span className="avatar">M</span>
          </div>
        </header>
        <main className={page === "new" ? "transcription-main" : page === "result" ? "result-main" : undefined}>
          {ready && page === "new" && (
            <>
              <section className="transcription-heading">
                <h1>음성 전사 ​</h1>
                <p>오늘은 어떤 목소리를 기록할까요?</p>
              </section>
              <section
                className={`upload-card ${working ? "is-working" : ""}`}
                data-state={uploadState}
                aria-label="전사할 파일 업로드"
              >
                <div className="dropzone-embrace">
                  <svg
                    className="upload-cat upload-cat-head"
                    viewBox="0 0 200 160"
                    fill="none"
                    role="img"
                    aria-label={
                      working
                        ? "목소리에 귀 기울이는 고양이"
                        : transcribed
                          ? "전사를 마친 고양이"
                          : "업로드를 기다리는 고양이"
                    }
                  >
                    {working ? (
                      <g
                        className="cat-listening"
                        stroke="var(--sage)"
                        strokeWidth="5"
                        strokeLinecap="round"
                      >
                        <path d="M9 39v10M20 28v30M31 35v17" />
                      </g>
                    ) : transcribed ? (
                      <g>
                        <circle cx="21" cy="39" r="17" fill="var(--soft-green)" />
                        <path
                          d="m12 39 6 6 12-13"
                          stroke="var(--green)"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                    ) : (
                      <path
                        d="m23 38-14-11m23-3-5-16M20 53 5 51"
                        stroke="var(--sage)"
                        strokeWidth="6"
                        strokeLinecap="round"
                      />
                    )}
                    <path
                      d="M47 130c-14-17-14-42 0-60l24-43c4-8 10-10 16-2l19 24 27 5 31-17c8-4 13 0 13 9l1 35c13 17 17 39 7 61Z"
                      fill="var(--cat-fur)"
                      stroke="var(--cat-line)"
                      strokeWidth="4.5"
                      strokeLinejoin="round"
                    />
                    <path d="m69 49 9-20 13 21Z" fill="var(--cat-ear)" />
                    <path d="m151 57 17-12 1 23Z" fill="var(--cat-ear)" />
                    <path d="m91 45 15 4 16 3c-1 17-14 27-32 20l-11-5Z" fill="var(--cat-patch)" />
                    <path
                      d="m132 55 18-1 24 18 6 14c-21 8-39-1-48-13Z"
                      fill="var(--cat-patch)"
                      opacity=".75"
                    />
                    <path
                      d="M73 91q9-9 17 2m47 7q9-9 17 2"
                      stroke="var(--cat-line)"
                      strokeWidth="4.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="m109 103 5 2 5-1m-5 1q-1 10-9 5m9-5q0 10 8 7"
                      stroke="var(--cat-ear)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                    <ellipse cx="68" cy="105" rx="9" ry="4" fill="var(--cat-ear)" opacity=".4" />
                    <ellipse cx="159" cy="113" rx="8" ry="4" fill="var(--cat-ear)" opacity=".4" />
                    <path
                      d="m40 87 17 5m-20 9 18 2m115 11 20 1m-20 9 18 5"
                      stroke="var(--cat-line)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <button
                    className={`dropzone ${drag ? "dragging" : ""} ${file ? "has-file" : ""}`}
                    onClick={browse}
                  >
                    <span className="upload-illustration" aria-hidden="true">
                      {file ? (
                        <Icon name="file" size={40} />
                      ) : (
                        <span className="voice-wave">
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </span>
                    <strong>
                      {files.length
                        ? filename(files[0]) +
                          (files.length > 1 ? " 외 " + (files.length - 1) + "개" : "")
                        : "음성 · 영상 파일을 여기에 놓아주세요"}
                    </strong>
                    <span>
                      또는 <span className="browse">클릭하여 파일을 선택</span>하세요
                    </span>
                    <span className="formats">
                      MP3 · M4A · WAV <span>여러 파일 선택 가능</span>
                    </span>
                  </button>
                  <svg
                    className="upload-cat upload-cat-paws"
                    viewBox="0 0 200 160"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M31 126c-4-12 4-23 17-23 14 0 23 10 22 21-1 9-10 9-15 5-4 5-10 5-14 1-5 3-9 1-10-4Z"
                      fill="var(--cat-fur)"
                      stroke="var(--cat-line)"
                      strokeWidth="4"
                      strokeLinejoin="round"
                    />
                    <path
                      d="m43 124 1 5m10-6 1 5"
                      stroke="var(--cat-line)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M183 126c14 0 19 10 16 23-2 10-11 16-18 12"
                      fill="var(--cat-fur)"
                      stroke="var(--cat-line)"
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                {files.length > 0 && (
                  <ul className="file-list">
                    {files.map((p) => (
                      <li key={p}>
                        <span title={p}>{filename(p)}</span>
                        <button
                          className="text-button"
                          aria-label={filename(p) + " 제외"}
                          onClick={() => setFiles((old) => old.filter((f) => f !== p))}
                        >
                          제외
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="upload-controls">
                  <div className="upload-options">
                    <label>
                      <span>
                        <Icon name="model" size={15} /> 전사 모델
                      </span>
                      <select
                        value={prefs.model}
                        onChange={(e) => update({ model: e.target.value })}
                      >
                        <option value="auto">자동 추천{effective ? " · " + effective : ""}</option>
                        {snap.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            Whisper {m.id}
                            {m.installed ? "" : " · 설치 필요"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>언어</span>
                      <select value={prefs.lang} onChange={(e) => update({ lang: e.target.value })}>
                        {Object.entries({
                          auto: "자동 감지",
                          ko: "한국어",
                          en: "English",
                          ja: "日本語",
                          zh: "中文",
                          de: "Deutsch",
                          fr: "Français",
                          es: "Español",
                        }).map(([k, v]) => (
                          <option value={k} key={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="upload-bottom">
                    <button
                      className="primary"
                      disabled={submitting || (installed && !files.length)}
                      onClick={start}
                    >
                      <Icon name={installed ? "play" : "download"} size={16} />
                      {installed ? "전사 시작" : "모델 설치하기"}
                      <Icon name="arrow" size={17} />
                    </button>
                  </div>
                </div>
                <p className="upload-feedback">
                  {" "}
                  {installed
                    ? "선택한 파일은 이 Mac에서 순서대로 전사합니다."
                    : "처음 한 번 전사 모델을 받아 주세요."}
                </p>
              </section>
              <section className="recent-section">
                <div className="section-heading">
                  <h2>
                    최근 기록 <span className="number">{records.length}</span>
                  </h2>
                  <button className="text-button" onClick={() => setPage("history")}>
                    전체 보기
                    <Icon name="arrow" size={15} />
                  </button>
                </div>
                {recordList()}
              </section>
            </>
          )}
          {page === "history" && (
            <>
              <section className="simple-heading">
                <div className="eyebrow">MY LITTLE ARCHIVE</div>
                <h1>
                  내 기록<span className="heading-dot">.</span>
                </h1>
                <p>지나간 목소리 속에서, 필요한 생각을 다시 찾아보세요.</p>
              </section>
              <div className="search-box">
                <Icon name="search" />
                <input
                  placeholder="파일명으로 기록 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span>{records.length}개의 기록</span>
              </div>
              {recordList(true)}
            </>
          )}
          {page === "result" && current && (
            <Result
              key={current.id}
              job={current}
              notify={setToast}
              guard={guard}
              back={() => setPage("history")}
            />
          )}
          {(page === "models" || page === "settings" || page === "setup") && (
            <Setup
              key={page}
              page={page}
              prefs={prefs}
              update={update}
              snap={snap}
              device={device}
              notify={setToast}
              refresh={refresh}
              finish={() => {
                update({ ready: true });
                void setPage("new");
              }}
            />
          )}
          {!ready && <p role="status">작업 공간을 여는 중…</p>}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="알림 닫기" onClick={() => setToast("")}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
