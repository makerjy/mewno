import { DisplaySettings } from "./DisplaySettings";
import { WorkPreferences } from "./WorkPreferences";
import { Icon } from "./Icon";
import { useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { type Device, type Snapshot, type Prefs, gb, mb, recommend } from "./types";
const modelGuide: Record<string, { name: string; focus: string; detail: string }> = {
  tiny: {
    name: "Tiny",
    focus: "속도 우선",
    detail:
      "짧은 음성 메모의 내용을 빨리 훑을 때 좋아요. 낯선 이름이나 전문 용어는 틀릴 수 있어요.",
  },
  base: {
    name: "Base",
    focus: "속도와 정확도의 균형",
    detail:
      "일상 대화나 회의를 전사할 때 먼저 써 보세요. Tiny보다 시간이 더 들지만 말을 더 잘 구분하는 편이에요.",
  },
  small: {
    name: "Small",
    focus: "정확도 우선",
    detail:
      "강의나 인터뷰를 꼼꼼히 옮기고 싶을 때 좋아요. 세 모델 중 메모리를 가장 많이 쓰고 전사도 오래 걸려요.",
  },
};
type Props = {
  page: "models" | "settings" | "setup";
  prefs: Prefs;
  update: (v: Partial<Prefs>) => void;
  snap: Snapshot;
  device: Device | null;
  finish: () => void;
  notify: (s: string) => void;
  refresh: () => Promise<void>;
};
export function Setup({ page, prefs, update, snap, device: d, finish, notify, refresh }: Props) {
  const [step, setStep] = useState(1);
  const rec = recommend(d, prefs.preference, snap.models),
    t = snap.transfer,
    busy = ["download", "verify"].includes(t.stage);
  async function command(cmd: string, args?: Record<string, unknown>) {
    try {
      await invoke(cmd, args);
      await refresh();
    } catch (e) {
      notify(String(e));
    }
  }
  return (
    <div className={page === "setup" ? "setup-workspace" : undefined}>
      <section className="simple-heading">
        <h1>{{ models: "모델 관리", settings: "설정", setup: "처음 시작하기" }[page]}</h1>
        {page === "setup" && (
          <ol className="setup-track" aria-label="설정 단계">
            {["내 작업", "기기 확인", "모델 설치"].map((label, i) => (
              <li
                key={label}
                aria-current={step === i + 1 ? "step" : undefined}
                className={step > i ? "reached" : ""}
              >
                <span>{step > i + 1 ? <Icon name="check" size={12} /> : i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        )}
      </section>
      {(page === "settings" || (page === "setup" && step === 1)) && (
        <WorkPreferences
          prefs={prefs}
          update={update}
          model={snap.models.find((m) => m.id === rec)}
        />
      )}
      {(page === "settings" || (page === "setup" && step === 2)) && (
        <section className="settings-card">
          <h2>이 Mac의 환경</h2>
          <dl className="profile">
            {Object.entries({
              운영체제: d ? "macOS " + (d.os ?? "버전 미확인") : "확인 중",
              CPU: d
                ? [d.cpu, d.arch, d.cores && d.cores + "코어"].filter(Boolean).join(" · ")
                : "확인 중",
              메모리: gb(d?.total),
              "사용 가능 메모리 (추정)": gb(d?.available),
              GPU: d?.gpu ?? "확인되지 않음",
              "전용 GPU 메모리": "확인되지 않음",
              "여유 저장 공간": gb(d?.disk),
              "전사 엔진": "whisper.cpp · Metal 시도 후 CPU 재시도",
            }).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {page === "settings" && <DisplaySettings prefs={prefs} update={update} />}
      {(page === "models" || (page === "setup" && step === 3)) && (
        <section className="settings-card">
          <h2>Whisper 전사 모델</h2>
          <p className="muted">
            {rec
              ? "사용 가능 메모리 " +
                gb(d?.available) +
                "와 " +
                prefs.preference +
                " 설정에 따라 " +
                rec +
                "를 추천해요."
              : "모델을 저장할 공간을 확보해 주세요."}{" "}
            모델 파일은 처음 한 번 인터넷에서 받습니다.
          </p>
          {snap.models.map((m) => (
            <div className="model-entry guided-model" key={m.id}>
              <div>
                <div className="model-title">
                  <strong>Whisper {modelGuide[m.id]?.name ?? m.id}</strong>
                  {m.id === rec && <span className="badge">추천</span>}
                </div>
                <p className="model-detail">
                  <b>{modelGuide[m.id]?.focus}</b> {modelGuide[m.id]?.detail}
                </p>
                <p>
                  {mb(m.bytes)} · 한국어 포함 다국어 · {m.license}
                </p>
              </div>
              <div className="panel-row">
                {m.installed ? (
                  <>
                    <button
                      className="secondary"
                      onClick={() => update({ model: m.id })}
                      disabled={prefs.model === m.id}
                    >
                      {prefs.model === m.id ? "선택됨" : "선택"}
                    </button>
                    <button
                      className="text-button"
                      onClick={async () => {
                        if (
                          await confirm(
                            "캐시에서 " + m.id + " 모델을 삭제할까요? 전사 기록은 보존됩니다.",
                          )
                        )
                          await command("delete_model", { id: m.id });
                      }}
                    >
                      삭제
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await confirm(
                          "Hugging Face에서 Whisper " + m.id + " (" + mb(m.bytes) + ")를 받을까요?",
                        )
                      )
                        await command("install_model", { id: m.id });
                    }}
                  >
                    다운로드
                  </button>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="panel-row" role="status">
              {t.id} · {t.stage === "verify" ? "SHA-256 확인 중" : mb(t.bytes) + " 받음"}
              <button className="secondary" onClick={() => command("cancel_download")}>
                취소
              </button>
            </div>
          )}
          {t.error && <p role="alert">{t.error}</p>}
        </section>
      )}
      {page === "setup" && (
        <div className="setup-footer">
          <button className="text-button" onClick={finish}>
            건너뛰고 시작
          </button>
          {step > 1 && (
            <button className="secondary" onClick={() => setStep(step - 1)}>
              이전
            </button>
          )}
          <button className="primary" onClick={() => (step === 3 ? finish() : setStep(step + 1))}>
            {step === 3 ? "작업 공간 열기" : step === 1 ? "기기 확인" : "모델 선택"}{" "}
            <Icon name="arrow" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
