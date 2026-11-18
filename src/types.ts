export type Job = {
  id: string;
  name: string;
  status: string;
  model: string;
  lang: string;
  detected: string;
  duration: number;
  message: string;
};
export type Segment = {
  seq: number;
  start: number;
  end: number;
  raw: string;
  edited: string;
  encoding_warning: boolean;
};
export type Model = { id: string; bytes: number; installed: boolean; license: string };
export type Snapshot = {
  jobs: Job[];
  models: Model[];
  transfer: { id: string; stage: string; bytes: number; error: string };
};
export type Device = {
  os: string | null;
  arch: string;
  cpu: string | null;
  cores: number | null;
  gpu: string | null;
  total: number | null;
  available: number | null;
  disk: number | null;
  vram: null;
};
export const defaults = {
  ready: false,
  theme: "system",
  model: "auto",
  lang: "auto",
  mode: "auto",
  cpu: false,
  purpose: "학습 · 강의",
  field: "일반",
  customField: "",
  hint: "",
  preference: "균형",
};
export type Prefs = typeof defaults;
export const labels: Record<string, string> = {
  queued: "대기 중",
  analyzing: "모델 확인 중",
  preprocessing: "음원 변환 중",
  loading: "구간 준비 중",
  transcribing: "전사 중",
  completed: "완료",
  cancelling: "취소 중",
  cancelled: "취소됨",
  failed: "실패",
};
export const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);
export const mb = (n: number) => Math.round(n / 1e6) + " MB";
export const gb = (n: number | null | undefined) =>
  n == null ? "확인되지 않음" : (n / 2 ** 30).toFixed(1) + " GiB";
export function recommend(p: Device | null, preference: string, models: Model[]) {
  const memory = p?.available ?? 0;
  const candidates =
    preference === "속도" || memory < 2 * 2 ** 30
      ? ["tiny"]
      : preference === "정확도" && memory >= 4 * 2 ** 30
        ? ["small", "base", "tiny"]
        : ["base", "tiny"];
  return (
    candidates.find((id) =>
      models.some(
        (m) => m.id === id && (m.installed || p?.disk == null || p.disk >= m.bytes + 16e6),
      ),
    ) ?? null
  );
}
