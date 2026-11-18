import { Icon } from "./Icon";
import type { Prefs } from "./types";

const themes = [
  ["system", "시스템 연동"],
  ["light", "밝게"],
  ["dark", "어둡게"],
];
function ThemePreview({ theme }: { theme: string }) {
  const scene = (dark: boolean) => (
    <span className={"preview-scene " + (dark ? "night" : "day")}>
      <i />
      <b />
      <em />
    </span>
  );
  return (
    <span className={"theme-preview " + theme} aria-hidden="true">
      {theme === "system" ? (
        <>
          {scene(false)}
          {scene(true)}
        </>
      ) : (
        scene(theme === "dark")
      )}
    </span>
  );
}
export function DisplaySettings({
  prefs,
  update,
}: {
  prefs: Prefs;
  update: (v: Partial<Prefs>) => void;
}) {
  return (
    <section className="display-settings settings-card">
      <h2>화면과 전사 방식</h2>
      <fieldset className="appearance">
        <legend>화면 테마</legend>
        <div className="theme-gallery">
          {themes.map(([id, label]) => (
            <label className="appearance-choice" key={id}>
              <input
                type="radio"
                name="theme"
                checked={prefs.theme === id}
                onChange={() => update({ theme: id })}
              />
              <span className="appearance-face">
                <ThemePreview theme={id} />
                <span className="theme-caption">
                  {label}
                  <span className="theme-selected">
                    {prefs.theme === id && <Icon name="check" size={12} />}
                  </span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="decode-setting">
        <div>
          <label htmlFor="decode-mode">파일 읽기 방식</label>
          <p id="decode-help">
            {prefs.mode === "wav"
              ? "16 kHz 모노 PCM16 WAV 파일을 직접 읽어요. 다른 형식은 자동 인식을 선택해 주세요."
              : "음성이나 영상을 넣으면 Mac이 오디오 트랙을 찾아요."}
          </p>
        </div>
        <select
          id="decode-mode"
          aria-describedby="decode-help"
          value={prefs.mode}
          onChange={(e) => update({ mode: e.target.value })}
        >
          <option value="auto">자동 인식</option>
          <option value="wav">수동 · PCM WAV</option>
        </select>
      </div>
      <label className="cpu-setting">
        <span>
          <strong>CPU로만 전사</strong>
          <small>그래픽 가속 중 오류가 반복될 때 켜세요. 전사가 더 오래 걸릴 수 있어요.</small>
        </span>
        <span className="switch-wrap">
          <input
            type="checkbox"
            role="switch"
            aria-label="CPU로만 전사"
            checked={prefs.cpu}
            onChange={(e) => update({ cpu: e.target.checked })}
          />
          <span className="switch-track" aria-hidden="true">
            <i />
          </span>
        </span>
      </label>
    </section>
  );
}
