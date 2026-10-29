// Gọi đúng các endpoint /api/drills/* mà trang /tenses?panel=practice đang dùng —
// cùng kho đề, cùng bài dở (state), cùng lịch sử + thống kê. Làm dở trên web mở CLI làm tiếp được.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Các mạch luyện dịch trên web (cùng endpoint /api/drills/:kind/*). axis = trục chấm thứ hai ngoài nghĩa. */
export const KINDS = [
  { id: 'tense', label: 'Các thì', axis: 'thì' },
  { id: 'passive', label: 'Câu bị động', axis: 'bị động' },
  { id: 'question', label: 'Đặt câu hỏi', axis: 'câu hỏi' },
  { id: 'cond', label: 'Câu điều kiện', axis: 'điều kiện' },
  { id: 'builder', label: 'Ráp câu', axis: 'ráp khối' },
  { id: 'timex', label: 'Mốc thời gian', axis: 'mốc' },
  { id: 'pattern', label: 'Công thức câu', axis: 'công thức' },
  { id: 'be', label: 'be / being', axis: 'be' },
  { id: 'engine', label: '32 engine nói nhanh', axis: 'engine' },
  { id: 'phrasal', label: 'Cụm động từ', axis: 'cụm' },
  { id: 'colloc', label: 'Collocation', axis: 'collocation' },
  { id: 'adj', label: 'Tính từ mô tả', axis: 'tính từ' },
  { id: 'opposite', label: 'Động từ trái nghĩa', axis: 'đối lập' },
  { id: 'report', label: 'Báo cáo tháng', axis: 'văn phong' },
] as const;
export type Kind = (typeof KINDS)[number];
const DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'veng');
export const CONFIG_PATH = join(DIR, 'config.json');
const DEFAULT_URL = 'https://v92labs.info/api';

export interface Config {
  apiUrl: string;
  apiKey: string;
  /** Loại luyện mở lần trước — menu đặt con trỏ sẵn ở đó. */
  lastKind?: string;
  /** Màu khung câu đang làm (^T đổi). */
  frame?: string;
}

export function loadConfig(): Config | null {
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  const apiKey = process.env.VENG_API_KEY || file.apiKey;
  if (!apiKey) return null;
  return {
    apiKey,
    apiUrl: process.env.VENG_API_URL || file.apiUrl || DEFAULT_URL,
    lastKind: file.lastKind,
    frame: file.frame,
  };
}

/** Ghi tuỳ chọn (loại lần trước, màu khung) vào file, không đụng key (key có thể đến từ biến môi trường). */
export function savePrefs(prefs: Pick<Config, 'lastKind' | 'frame'>) {
  try {
    const file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    saveConfig({ ...file, ...prefs });
  } catch {}
}
export const saveLastKind = (lastKind: string) => savePrefs({ lastKind });

export function saveConfig(cfg: Config) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
}

export function clearConfig() {
  if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH);
}

export const defaultUrl = () => process.env.VENG_API_URL || DEFAULT_URL;

export interface DrillLine {
  vi: string;
  hint: string;
  patterns: string[];
  answer: string;
  /** Câu đáp của người kia (mạch hỏi, ráp câu, be) — hiện sau khi chấm, như web. */
  reply?: string;
  replyVi?: string;
}
export interface Drill {
  vi: string;
  hint: string;
  patterns: string[];
  answer: string;
  alternatives: string[];
  context?: string;
  lines?: DrillLine[];
  wrapped?: boolean;
}
export interface Feedback {
  score: number;
  ok: boolean;
  meaningOk: boolean;
  tenseOk: boolean;
  corrected: string;
  comment: string;
  tenseNote: string;
  styleNote: string;
  fixes: { wrong: string; right: string; why: string }[];
  natural: string[];
  /** Bài người học đánh dấu lỗi bằng CriticMarkup ({~~sai~>đúng~~}{>>lý do<<}…) — server cũ không có. */
  marked?: string;
  /** Giới từ trong câu đúng + vì sao — server cũ / kết quả cũ không có. */
  preps?: { phrase: string; why: string }[];
}
export interface Stats {
  cycle: number;
  totalDrills: number;
  doneDrills: number;
  lines: number;
  good: number;
  fair: number;
  weak: number;
  tenseOk: number;
  avg: number;
}
export interface State {
  drill: Drill;
  answers: string[];
  feedbacks: (Feedback | null)[];
}
export interface Summary {
  lines: { index: number; wrong: string[] }[];
  focus: string[];
  overall: string;
}

export interface VocabWord {
  vi: string;
  en: string;
  pos: string;
}
export interface Vocab {
  lines: { index: number; words: VocabWord[] }[];
}

export interface HistoryItem {
  id: string;
  drillKey: string;
  lineIndex: number;
  vi: string;
  answer: string;
  score: number;
  meaningOk: boolean;
  tenseOk: boolean;
  corrected: string;
  tenseNote: string;
  createdAt: number;
}
/** Một bài đã làm: câu đã chấm (lần mới nhất), tổng kết đoạn, đề gốc để học lại — như tab Lịch sử trên web. */
export interface HistoryPaper {
  drillKey: string;
  lastAt: number;
  lines: HistoryItem[];
  summary: Summary | null;
  drill: Drill;
}
export interface HistoryPage {
  items: HistoryPaper[];
  total: number;
  page: number;
  pageSize: number;
}

/** Phiên âm một từ (CMUdict, từ lạ thì espeak đoán theo chính tả — src 'rule'). */
export interface IpaEntry {
  ipa: string;
  alts?: string[];
  src: 'dict' | 'rule';
}

/** Một từ trong kho (rút gọn từ /api/words/page). */
export interface WordItem {
  id: string;
  word: string;
  meaning: string;
  ipa?: string | null;
  example?: string | null;
  pos?: string | null;
  known?: boolean;
}
/** Một mục trong "lexical family" Gemini soạn cho từ mới. */
export interface FamilyEntry {
  word: string;
  pos: string;
  meaning_vi: string;
  definition_en?: string;
  ipa?: string | null;
  level: 'core' | 'common' | 'extended';
  examples?: string[];
}
export interface WordPreview {
  mode: string;
  data: { root: string; entries: FamilyEntry[]; antonyms: FamilyEntry[]; synonyms: { word: string; vi: string }[] };
  /** Gõ sai chính tả → từ đúng AI đã hiểu ("analized" → "analyze"). */
  suggested?: string | null;
  /** Từ đã gõ / từ gợi ý đã có sẵn trong kho. */
  existing?: { id: string; word: string; meaning: string }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function client(cfg: Config, kind: string = KINDS[0].id) {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${cfg.apiUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-api-key': cfg.apiKey, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Không kết nối được server — kiểm tra mạng.', 0);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        res.status === 401 || res.status === 403
          ? 'API key sai hoặc đã bị đổi — chạy `veng login`.'
          : res.status === 429
            ? 'Chấm nhiều quá, server đang giới hạn — đợi vài phút.'
            : (data?.error ?? `Lỗi server (${res.status})`);
      throw new ApiError(msg, res.status);
    }
    return data as T;
  }
  const k = `/drills/${kind}`;
  return {
    drill: (avoid: string[]) => call<Drill>(k, { avoid }),
    check: (vi: string, sentence: string) => call<Feedback>(`${k}/check`, { vi, sentence }),
    result: (body: {
      drillKey: string;
      lineIndex: number;
      vi: string;
      answer: string;
      score: number;
      meaningOk: boolean;
      tenseOk: boolean;
      corrected: string;
      tenseNote: string;
    }) => call(`${k}/result`, body),
    stats: () => call<Stats>(`${k}/stats`),
    state: () => call<State | null>(`${k}/state`),
    saveState: (s: State) => call(`${k}/state`, s),
    summary: (body: {
      drillKey: string;
      lines: { vi: string; answer: string; corrected: string; meaningOk: boolean; tenseOk: boolean }[];
    }) => call<Summary>(`${k}/summary`, body),
    vocab: (lines: { vi: string; answer: string }[]) => call<Vocab>(`${k}/vocab`, { lines }),
    reset: () => call<{ cycle: number }>(`${k}/reset`, {}),
    /** Tìm trong kho từ vựng (khớp từ / nghĩa / ví dụ). */
    searchWords: (q: string) =>
      call<{ items: WordItem[]; total: number }>(`/words/page?q=${encodeURIComponent(q)}&limit=8`),
    /** Gemini soạn thẻ từ mới — CHƯA lưu, để xem trước. */
    previewWord: (word: string) =>
      call<WordPreview>('/words/preview-enrichment', { word, groupSlug: groupOf(word) }),
    /** Lưu thẻ từ đã xem trước — y như nút Lưu trên web. */
    createWord: (word: string, preview: WordPreview) => {
      const core = preview.data.entries.find((e) => e.level === 'core') ?? preview.data.entries[0];
      return call<{ id: string }>('/words', {
        word,
        meaning: core?.meaning_vi || '(no meaning)',
        groupSlug: groupOf(word),
        examples: core?.examples ?? [],
        enrichment: preview.data,
      });
    },
    /** Tra IPA (không AI, server nhớ trong DB) — dùng lại endpoint trang Shadowing. */
    ipa: (words: string[]) => call<{ words: Record<string, IpaEntry> }>('/shadowing/ipa', { words }),
    history: (filter: 'weak' | 'all', page: number, pageSize: number) =>
      call<HistoryPage>(`${k}/history?filter=${filter}&page=${page}&pageSize=${pageSize}`),
  };
}
export type Client = ReturnType<typeof client>;

/** Nhóm như web: có dấu cách là cụm, còn lại là từ đơn trong kho cốt lõi. */
const groupOf = (word: string) => (/\s/.test(word.trim()) ? 'phrase' : 'core');

/** Đề cũ chỉ có một câu thì bọc lại thành mảng — giống web. */
export const linesOf = (d: Drill): DrillLine[] =>
  d.lines?.length
    ? d.lines
    : [{ vi: d.vi, hint: d.hint, patterns: d.patterns, answer: d.answer }];
