import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { type Prefs, type Model, mb } from "./types";

const purposes: { value: string; icon: IconName }[] = [
  { value: "학습 · 강의", icon: "file" },
  { value: "업무 · 회의", icon: "model" },
  { value: "인터뷰", icon: "headphones" },
  { value: "일반 녹음", icon: "wave" },
  { value: "기타", icon: "plus" },
];
const preferenceChoices = [
  ["속도", "속도 우선"],
  ["균형", "균형"],
  ["정확도", "정확도 우선"],
];
const fields = [
  "일반",
  "과학 · 공학",
  "의학 · 생명공학",
  "IT",
  "경영",
  "인문",
  "교육",
  "직접 입력",
];
const terms = (s: string) => [
  ...new Set(
    s
      .split(/[,，\n]/)
      .map((t) => t.trim())
      .filter(Boolean),
  ),
];

export function WorkPreferences({
  prefs,
  update,
  model,
}: {
  prefs: Prefs;
  update: (p: Partial<Prefs>) => void;
  model?: Model;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const current = terms(prefs.hint);
  const placeholders: Record<string, string> = {
    "업무 · 회의": "예: 프로젝트명, 거래처 이름",
    "학습 · 강의": "예: 푸리에 변환, 김유진",
    인터뷰: "예: 인터뷰이 이름, 기관명",
  };
  function commit(value: string) {
    update({ hint: terms(value).join(", ").slice(0, 100) });
    setDraft(null);
  }
  return (
    <section className="work-prefs">
      <fieldset className="purpose-field">
        <legend>주로 어떤 녹음을 전사하나요?</legend>
        <div className="purpose-choices">
          {purposes.map(({ value, icon }) => (
            <label className="purpose-option" key={value}>
              <input
                type="radio"
                name="purpose"
                checked={prefs.purpose === value}
                onChange={() => update({ purpose: value })}
              />
              <span className="purpose-face">
                <span className="purpose-mark">
                  <Icon name={icon} size={22} />
                </span>
                <span>{value}</span>
                <span className="choice-dot" aria-hidden="true">
                  {prefs.purpose === value && <Icon name="check" size={10} />}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="preference-row">
        <fieldset className="preference-field">
          <legend>전사 모델 추천 기준</legend>
          <div className="preference-switch">
            {preferenceChoices.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="preference"
                  checked={prefs.preference === value}
                  onChange={() => update({ preference: value })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="recommendation" aria-live="polite">
          <span>이 Mac의 추천 모델</span>
          <strong>
            {model
              ? "Whisper " + model.id.charAt(0).toUpperCase() + model.id.slice(1)
              : "추천 모델 없음"}
          </strong>
          {model && <small>{mb(model.bytes)}</small>}
        </div>
      </div>
      <div className="vocab-disclosure">
        <button
          className="vocab-toggle"
          aria-expanded={open}
          aria-controls="vocab-settings"
          onClick={() => setOpen(!open)}
        >
          <span className="vocab-icon">
            <Icon name="file" size={19} />
          </span>
          <span className="vocab-title">
            분야와 전문 용어 <small>선택</small>
          </span>
          <span className="vocab-summary">
            {prefs.field === "직접 입력" ? prefs.customField || "직접 입력" : prefs.field}
            {current.length > 0 ? " · 용어 " + current.length + "개" : ""}
          </span>
          <span className={"disclosure-chevron " + (open ? "expanded" : "")}>
            <Icon name="chevron" size={15} />
          </span>
        </button>
        {open && (
          <div className="vocab-body" id="vocab-settings">
            <div className="domain-fields">
              <label>
                주요 분야
                <select value={prefs.field} onChange={(e) => update({ field: e.target.value })}>
                  {fields.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              {prefs.field === "직접 입력" && (
                <label>
                  분야 이름
                  <input
                    maxLength={40}
                    value={prefs.customField}
                    onChange={(e) => update({ customField: e.target.value })}
                  />
                </label>
              )}
            </div>
            <label className="vocab-input-label" htmlFor="vocab-terms">
              인명 · 전문 용어
            </label>
            <input
              id="vocab-terms"
              maxLength={100}
              value={draft ?? prefs.hint}
              placeholder={placeholders[prefs.purpose] ?? "예: 인명, 프로젝트명"}
              onChange={(e) => {
                setDraft(e.target.value);
                update({ hint: e.target.value });
              }}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <p>쉼표로 구분해 입력하면 전사할 때 참고합니다.</p>
          </div>
        )}
      </div>
    </section>
  );
}
