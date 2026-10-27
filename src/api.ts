// Gọi đúng các endpoint /api/drills/* mà trang /tenses?panel=practice đang dùng —
// cùng kho đề, cùng bài dở (state), cùng lịch sử + thống kê. Làm dở trên web mở CLI làm tiếp được.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const KIND = 'tense';
const DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'veng');
export const CONFIG_PATH = join(DIR, 'config.json');
const DEFAULT_URL = 'https://v92labs.info/api';

export interface Config {
  apiUrl: string;
  apiKey: string;
}

export function loadConfig(): Config | null {
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  const apiKey = process.env.VENG_API_KEY || file.apiKey;
  if (!apiKey) return null;
  return { apiKey, apiUrl: process.env.VENG_API_URL || file.apiUrl || DEFAULT_URL };
}

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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function client(cfg: Config) {
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
  const k = `/drills/${KIND}`;
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
    reset: () => call<{ cycle: number }>(`${k}/reset`, {}),
  };
}
export type Client = ReturnType<typeof client>;

/** Đề cũ chỉ có một câu thì bọc lại thành mảng — giống web. */
export const linesOf = (d: Drill): DrillLine[] =>
  d.lines?.length
    ? d.lines
    : [{ vi: d.vi, hint: d.hint, patterns: d.patterns, answer: d.answer }];
