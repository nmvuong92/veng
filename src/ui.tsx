import { Box, type DOMElement, Text, Transform, useApp, useCursor, useInput, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import Spinner from 'ink-spinner';
import stringWidth from 'string-width';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  type Client,
  type Config,
  client,
  type Drill,
  type Feedback,
  type HistoryPage,
  type IpaEntry,
  type Suggestion,
  type ViEn,
  type WordDetail,
  type WordItem,
  type WordPreview,
  type Lookup,
  loadLookups,
  saveLookup,
  KINDS,
  type Kind,
  linesOf,
  type Stats,
  type Summary,
  type Vocab,
  saveConfig,
  saveLastKind,
  savePrefs,
} from './api.js';

const BRAND = '#3fa796';
const WARM = '#d6a23a';
const BAD = '#e0645c';
/** Chữ phụ. Không dùng MUTED của Ink (ANSI bright black) — trên nền tối gần như chìm. */
const MUTED = '#9aa3ad';
/** Màu khung câu đang làm — ^T xoay vòng, nhớ trong config. */
const FRAMES = [
  { name: 'vàng', color: '#d6a23a' },
  { name: 'ngọc', color: '#3fa796' },
  { name: 'tím', color: '#a78bfa' },
  { name: 'xanh', color: '#60a5fa' },
  { name: 'hồng', color: '#f472b6' },
  { name: 'bạc', color: '#cbd5e1' },
];
/** Vạch mờ bên trái của các câu không đang làm. */
const FAINT = '#4a5260';

/** Ô nhập một dòng, phím kiểu readline. Tự viết vì ink-text-input nuốt Ctrl+chữ thành ký tự. */
function useLineEditor(value: string, onChange: (v: string) => void, active: boolean, mask = false) {
  const [cur, setCur] = useState(value.length);
  // Chữ + vị trí con trỏ "thật" nằm trong ref, cập nhật NGAY: Ink có thể gọi handler nhiều lần
  // liền trong một nhịp (bộ gõ chốt chữ "tình" rồi tới phím cách) trước khi React vẽ lại — đọc
  // từ props/state thì lần sau thấy chữ cũ và đè mất chữ vừa gõ.
  const val = useRef(value);
  const pos = useRef(cur);
  const set = (v: string, c: number) => {
    pos.current = c;
    setCur(c);
    if (v !== val.current) {
      val.current = v;
      onChange(v);
    }
  };
  // Chữ đổi từ bên ngoài (điền gợi ý, xoá sau khi tra) → con trỏ về cuối.
  useEffect(() => {
    if (value !== val.current) {
      val.current = value;
      pos.current = value.length;
      setCur(value.length);
    }
  }, [value]);
  useInput(
    (input, key) => {
      const value = val.current;
      const cur = Math.min(pos.current, value.length);
      if (key.return || key.tab || key.upArrow || key.downArrow || key.escape) return;
      if (key.leftArrow) return set(value, Math.max(0, cur - 1));
      if (key.rightArrow) return set(value, Math.min(value.length, cur + 1));
      if (key.backspace || key.delete) {
        if (cur === 0) return;
        return set(value.slice(0, cur - 1) + value.slice(cur), cur - 1);
      }
      if (key.ctrl) {
        if (input === 'a') return set(value, 0);
        if (input === 'e') return set(value, value.length);
        if (input === 'u') return set(value.slice(cur), 0);
        if (input === 'w') {
          const start = value.slice(0, cur).replace(/\S+\s*$/, '').length;
          return set(value.slice(0, start) + value.slice(cur), start);
        }
        return; // các Ctrl khác là phím tắt của màn hình
      }
      if (key.meta || !input) return;
      // Duyệt TỪNG ký tự: bộ gõ Telex (OpenKey, EVKey…) sửa dấu bằng cách gửi ⌫ + chữ mới
      // trong CÙNG một lần ("ee" → "\x7f" + "ê") — Ink coi cả cụm là chữ, nên ⌫ phải tự xử lý.
      // Xuống dòng (dán nhiều dòng) → dấu cách; ký tự điều khiển khác thì bỏ.
      let v = value;
      let c = cur;
      for (const ch of input) {
        if (ch === '\x7f' || ch === '\b') {
          if (c > 0) {
            v = v.slice(0, c - 1) + v.slice(c);
            c--;
          }
        } else if (ch === '\r' || ch === '\n') {
          if (v[c - 1] !== ' ') {
            v = `${v.slice(0, c)} ${v.slice(c)}`;
            c++;
          }
        } else if (ch >= ' ') {
          v = v.slice(0, c) + ch + v.slice(c);
          c += ch.length;
        }
      }
      // Dấu rời (e + ̂ + ̣) → một chữ "ệ", để con trỏ / ⌫ đếm đúng từng chữ.
      const head = v.slice(0, c).normalize('NFC');
      set(head + v.slice(c).normalize('NFC'), head.length);
    },
    { isActive: active },
  );
  const shown = mask ? '•'.repeat(value.length) : value;

  // Đặt con trỏ THẬT của terminal đúng chỗ đang gõ: bộ gõ tiếng Việt kiểu "gạch chân" (macOS,
  // OpenKey/EVKey bật preedit) vẽ chữ đang ghép tại con trỏ thật — Ink mặc định để nó cuối màn
  // hình nên chữ hiện lạc ra ngoài ô. Toạ độ = cộng dồn vị trí layout (Yoga) từ ô nhập lên gốc.
  const ref = useRef<DOMElement>(null);
  const { setCursorPosition } = useCursor();
  // Ink chỉ dùng vị trí đặt TRONG lúc render (đặt trong effect thì phải đợi lần vẽ sau mới thấy),
  // nên tính ngay khi render, dựa trên layout của lần vẽ trước — ô nhập hầu như không đổi chỗ.
  if (active && ref.current?.yogaNode) {
    let x = 0;
    let y = 0;
    let node: DOMElement | undefined = ref.current;
    const width = node.yogaNode?.getComputedWidth() || 1;
    while (node?.yogaNode) {
      x += node.yogaNode.getComputedLeft();
      y += node.yogaNode.getComputedTop();
      node = node.parentNode;
    }
    // ponytail: xuống dòng tính theo ký tự (Ink ngắt theo từ) — câu dài lệch tối đa vài ô ở dòng sau.
    const col = stringWidth(shown.slice(0, cur));
    // Ô nhập rộng đúng bằng chữ → con trỏ ngay sau ký tự cuối (col = width) vẫn CÙNG dòng.
    const line = Math.floor(Math.max(0, col - 1) / width);
    setCursorPosition({ x: x + col - line * width, y: y + line });
  }
  // Lần vẽ đầu chưa có layout → vẽ lại một lần cho con trỏ vào đúng chỗ.
  const [, bump] = useState(0);
  useEffect(() => {
    if (active) bump((n) => n + 1);
  }, [active]);
  useEffect(() => (active ? () => setCursorPosition(undefined) : undefined), [active, setCursorPosition]);

  // Không vẽ con trỏ giả: con trỏ THẬT của terminal đã đứng đúng chỗ (useCursor ở trên), tự nhấp
  // nháy theo kiểu người dùng cài trong terminal. Con trỏ giả nhấp nháy bắt vẽ lại cả màn hình
  // mỗi 0,5s → terminal có hiệu ứng vệt con trỏ thì thấy nó "lướt" dài từ cuối màn hình lên.
  return (
    <Box ref={ref} flexGrow={1} flexShrink={1}>
      <Text>{shown || ' '}</Text>
    </Box>
  );
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: bỏ qua mã màu ANSI ở đầu dòng
const LEAD_SPACE = /^((?:\x1b\[[0-9;]*m)*) /;

/**
 * Tô màu / đậm / mờ cho MỘT dòng đã ngắt. Phải tô sau khi ngắt: Ink tô trước rồi mới ngắt
 * (wrap-ansi), mà wrap-ansi không mở lại màu truecolor ở dòng sau → dòng 2 ra chữ trắng trơn.
 * Span lồng bên trong (vd điểm, công thức) đóng màu bằng 39/22 thì mở lại kiểu của khối ngay sau.
 */
function lineStyle(line: string, color?: string, bold = false, dim = false): string {
  const weight = `${bold ? '\x1b[1m' : ''}${dim ? '\x1b[2m' : ''}`;
  const hex = color?.match(/^#(..)(..)(..)$/);
  const fg = hex ? `\x1b[38;2;${hex.slice(1).map((h) => Number.parseInt(h, 16)).join(';')}m` : '';
  if (!weight && !fg) return line;
  let out = line;
  if (fg) out = out.replaceAll('\x1b[39m', `\x1b[39m${fg}`);
  if (weight) out = out.replaceAll('\x1b[22m', `\x1b[22m${weight}`);
  return `${weight}${fg}${out}${fg ? '\x1b[39m' : ''}${weight ? '\x1b[22m' : ''}`;
}

/** Câu nhắc khi đang gõ mà chưa ⏎ — khuyến khích nghĩ kỹ trước khi chấm. */
const THINK_TIPS = [
  'thì nào hợp mốc thời gian?',
  'chủ ngữ – động từ khớp chưa?',
  'nghĩ bằng tiếng Anh nhé',
  'thiếu mạo từ a / the không?',
  'đọc lại một lượt rồi ⏎',
  'cứ từ từ — đúng hơn nhanh',
  'giới từ đi kèm đúng chưa?',
];
const THINK_FRAMES = ['·  ', '·∘ ', '·∘○', '·∘○'];
/** Animation chạy chừng này sau phím cuối rồi đứng yên — mỗi khung là một lần vẽ lại cả màn hình. */
const THINK_MS = 20_000;

/**
 * Góc phải ô trả lời khi đã gõ mà chưa ⏎: bong bóng suy nghĩ phồng dần ·∘○ 💭 + câu nhắc đổi
 * mỗi 4s. Gõ phím là chạy lại từ đầu; sau THINK_MS thì đứng yên (khỏi vẽ lại mãi).
 */
/** Thời gian (ms) kể từ phím cuối, cập nhật mỗi 350ms tới THINK_MS rồi dừng; ô trống thì không chạy. */
function useThinkingTick(text: string): number {
  const [t, setT] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: text chỉ để chạy lại animation khi gõ
  useEffect(() => {
    setT(0);
    if (!text.trim()) return; // chưa gõ gì: không hiện, không vẽ lại
    const start = Date.now();
    const id = setInterval(() => {
      const el = Date.now() - start;
      setT(el);
      if (el > THINK_MS) clearInterval(id);
    }, 350);
    return () => clearInterval(id);
  }, [text]);
  return t;
}

function ThinkingHint({ text, t, wide }: { text: string; t: number; wide: boolean }) {
  const tip = useRef(Math.floor(Math.random() * THINK_TIPS.length));
  if (!text.trim()) return null;
  const still = t > THINK_MS;
  const f = still ? 3 : Math.floor(t / 350) % THINK_FRAMES.length;
  const bubble = THINK_FRAMES[f] ?? '';
  const msg = THINK_TIPS[(tip.current + Math.floor(t / 4000)) % THINK_TIPS.length];
  return (
    <Box flexShrink={0} marginLeft={2}>
      <Text>
        <Text color={MUTED}>{bubble}</Text>
        <Text color={f === 3 ? WARM : MUTED}> 💭</Text>
        {wide ? <Text color={MUTED}> {msg}</Text> : null}
      </Text>
    </Box>
  );
}

/** Dòng hai cột: dấu/số cố định bên trái, chữ bên phải — câu dài xuống dòng vẫn thẳng hàng với đầu câu. */
function Hang({
  mark,
  indent = 0,
  trim = true,
  dim = false,
  color,
  bold = false,
  children,
}: {
  mark: ReactNode;
  indent?: number;
  /** Câu không đang làm: chữ "faint" (terminal không có opacity). */
  dim?: boolean;
  /** Màu / đậm của cả khối chữ — tô lại TỪNG DÒNG sau khi ngắt (xem lineStyle). */
  color?: string;
  bold?: boolean;
  /** Ô nhập liệu phải để false: con trỏ là một dấu cách tô ngược màu, bỏ đi là mất con trỏ. */
  trim?: boolean;
  children: ReactNode;
}) {
  return (
    <Box marginLeft={indent}>
      <Box flexShrink={0}>
        <Text dimColor={dim}>{mark}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {/* Ink ngắt dòng với trim:false → ngắt đúng chỗ dấu cách thì dòng sau dư 1 khoảng trắng đầu; bỏ đi. */}
        <Transform
          transform={(line, i) => lineStyle(trim && i > 0 ? line.replace(LEAD_SPACE, '$1') : line, color, bold, dim)}
        >
          <Text>{children}</Text>
        </Transform>
      </Box>
    </Box>
  );
}

/** Xanh = đúng cả nghĩa lẫn thì, vàng = đúng nghĩa sai thì, đỏ = sai nghĩa — giống web. */
const toneOf = (fb: Feedback) => (fb.meaningOk && fb.tenseOk ? BRAND : fb.meaningOk ? WARM : BAD);

function ScoreDots({ fb }: { fb: Feedback }) {
  const n = Math.max(0, Math.min(10, Math.round(fb.score)));
  return (
    <Text>
      <Text bold color={toneOf(fb)}>
        {fb.score}/10
      </Text>{' '}
      <Text color={toneOf(fb)}>{'●'.repeat(n)}</Text>
      <Text color={MUTED}>{'○'.repeat(10 - n)}</Text>
    </Text>
  );
}

const Check = ({ ok, label }: { ok: boolean; label: string }) => (
  <Text color={ok ? BRAND : BAD}>
    {label} {ok ? '✓' : '✗'}
  </Text>
);

function Header({ stats, kind, title }: { stats: Stats | null; kind?: Kind; title?: string }) {
  return (
    <Box justifyContent="space-between" marginBottom={1} gap={2}>
      {/* Màn hẹp: bên trái tự cắt "…", số liệu bên phải giữ nguyên — không chồng chữ lên nhau. */}
      <Box flexShrink={1}>
        <Text wrap="truncate-end">
          <Gradient colors={[BRAND, WARM]}>▍veng</Gradient>
          <Text color={MUTED}> · {title ?? `${kind ? kind.label : 'luyện dịch'} · Việt → Anh, AI chấm`}</Text>
        </Text>
      </Box>
      {stats ? (
        <Box flexShrink={0}>
          <Text color={MUTED}>
            {stats.doneDrills}/{stats.totalDrills} đoạn · ⌀ <Text color={WARM}>{stats.avg}</Text> · đúng{' '}
            {kind?.axis} {stats.tenseOk}/{stats.lines}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Khối chấm: thanh dọc màu theo kết quả, gọn một cột — điểm, nhận xét, sửa lỗi, câu đúng, cách nói khác. */
function FeedbackView({
  fb,
  sample,
  axis,
  lean = false,
  width,
}: {
  fb: Feedback;
  sample: string;
  axis: string;
  /** Bề rộng chữ trong khung câu — để tự ngắt dòng câu đã đánh dấu. */
  width: number;
  /** Màn hình thấp: bỏ cách nói khác / giới từ / lưu ý vặt để cả khối vừa màn hình. */
  lean?: boolean;
}) {
  const right = fb.corrected || sample;
  const alts = lean ? [] : [
    ...(norm(sample) !== norm(right) ? [sample] : []),
    ...(fb.natural ?? []),
  ].filter((x, i, arr) => x && norm(x) !== norm(right) && arr.findIndex((y) => norm(y) === norm(x)) === i);
  const marked = fb.marked ? parseCritic(fb.marked) : null;
  const numbered = marked?.fixes.length ? marked.fixes : null;
  // Câu đã nhập được AI đánh dấu (✎) rồi câu đúng (✓), thẳng cột với › để so từng chữ; nhận xét xuống dưới.
  return (
    <Box flexDirection="column" marginLeft={3}>
      <Hang mark={<Text color={BRAND}>✓ </Text>} bold color={BRAND}>
        {right}
      </Hang>
      {(lean ? [] : (fb.preps ?? [])).map((p) => (
        <Hang key={p.phrase} indent={2} color={MUTED} mark={<Text color={MUTED}>· </Text>}>
          <Text color={WARM}>{p.phrase}</Text> · {p.why}
        </Hang>
      ))}
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Text>
          <ScoreDots fb={fb} />
          {'   '}
          <Check ok={fb.meaningOk} label="nghĩa" />
          {'   '}
          <Check ok={fb.tenseOk} label={axis} />
        </Text>
        <Text>{fb.comment}</Text>
        {fb.tenseNote ? <Text color={BRAND}>⏱ {fb.tenseNote}</Text> : null}
        {numbered ? (
          <Box marginTop={1}>
            <FixList fixes={numbered} />
          </Box>
        ) : fb.fixes?.length ? (
          <Box flexDirection="column" marginTop={1}>
            {fb.fixes.map((f) => (
              <Text key={`${f.wrong}→${f.right}`}>
                <Text color={BAD} strikethrough>
                  {f.wrong}
                </Text>
                <Text color={MUTED}> → </Text>
                <Text color={BRAND}>{f.right}</Text>
                {f.why ? <Text color={MUTED}> · {f.why}</Text> : null}
              </Text>
            ))}
          </Box>
        ) : null}
        {fb.styleNote && !lean ? <Text color={MUTED}>· {fb.styleNote}</Text> : null}
      </Box>
      {alts.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Box marginLeft={2}>
            <Text color={MUTED}>cách nói khác</Text>
          </Box>
          {alts.map((x) => (
            <Hang key={x} mark={<Text color={WARM}>≈ </Text>}>
              {x}
            </Hang>
          ))}
        </Box>
      ) : null}
      {lean ? (
        <Box marginLeft={2}>
          <Text color={MUTED}>… thu gọn cho vừa màn hình (kéo giãn cửa sổ để xem đủ)</Text>
        </Box>
      ) : null}
    </Box>
  );
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();

/** Câu đã chấm (khi không đang làm): dòng 1 câu mình viết + ✓/✗, dòng 2 câu đúng — đúng hẳn thì bỏ. */
// ── CriticMarkup: AI đánh dấu lỗi ngay trên câu người học ─────────────────────
// {~~sai~>đúng~~} thay · {--thừa--} xoá · {++thiếu++} thêm · {>>lý do<<} ghi chú ngay sau.
const CRITIC = /\{(~~|--|\+\+)([\s\S]*?)(?:~~|--|\+\+)\}(?:\{>>([\s\S]*?)<<\})?/g;
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => [...String(n)].map((d) => SUP[Number(d)]).join('');

/** trail: AI để dấu cách nằm trong dấu ({++the ++}) — giữ lại để không dính chữ sau. */
type Fix = { n: number; old: string; neu: string; why: string; trail: boolean };
type Seg = { s: string; fix?: Fix };

/** Tách bản đánh dấu thành đoạn chữ thường + chỗ sửa (đánh số ¹²³…). Chỗ "sửa" mà như cũ thì coi là chữ thường. */
function parseCritic(marked: string): { segs: Seg[]; fixes: Fix[] } {
  const segs: Seg[] = [];
  const fixes: Fix[] = [];
  let last = 0;
  for (const m of marked.matchAll(CRITIC)) {
    if (m.index > last) segs.push({ s: marked.slice(last, m.index) });
    const [op, body = '', why = ''] = [m[1], m[2], m[3]];
    const [old, neu] = op === '~~' ? [body.split('~>')[0] ?? '', body.split('~>')[1] ?? ''] : op === '--' ? [body, ''] : ['', body];
    if (old.trim() === neu.trim()) segs.push({ s: old });
    else {
      const fix = {
        n: fixes.length + 1,
        old: old.trim(),
        neu: neu.trim(),
        why: why.trim(),
        trail: /\s$/.test(op === '--' ? old : neu || old),
      };
      fixes.push(fix);
      segs.push({ s: old, fix });
    }
    last = m.index + m[0].length;
  }
  if (last < marked.length) segs.push({ s: marked.slice(last) });
  return { segs, fixes };
}

type Word = { s: string; c?: string; strike?: boolean; bold?: boolean };

/**
 * Câu đã đánh dấu → các dòng đã ngắt sẵn theo bề rộng w. Tự ngắt theo từ (không để Ink ngắt)
 * vì Ink ngắt sau khi tô màu thì đoạn tô màu vắt qua dòng sẽ mất màu ở dòng sau.
 */
function diffLines(segs: Seg[], w: number, plain?: string): Word[][] {
  const words: Word[] = [];
  const push = (text: string, style: Omit<Word, 's'>) => {
    for (const p of text.split(/(\s+)/)) if (p) words.push({ s: p, ...style });
  };
  for (const g of segs) {
    if (!g.fix) push(g.s, plain ? { c: plain } : {});
    else {
      if (g.fix.old) push(g.fix.old, { c: BAD, strike: true });
      if (g.fix.old && g.fix.neu) words.push({ s: ' ' });
      if (g.fix.neu) push(g.fix.neu, { c: BRAND, bold: true });
      words.push({ s: sup(g.fix.n), c: WARM });
      if (g.fix.trail) words.push({ s: ' ' });
    }
  }
  const lines: Word[][] = [[]];
  let len = 0;
  for (const wd of words) {
    const space = /^\s+$/.test(wd.s);
    if (!space && len + wd.s.length > w && len > 0) {
      lines.push([]);
      len = 0;
    }
    if (space && len === 0) continue;
    lines[lines.length - 1]?.push(wd);
    len += wd.s.length;
  }
  // Dấu cách cuối dòng làm dòng dài hơn w 1 ký tự → Ink ngắt thêm một dòng trống.
  for (const ln of lines) while (ln.length && /^\s+$/.test(ln[ln.length - 1]?.s ?? '')) ln.pop();
  return lines;
}

/** Câu người học với lỗi gạch đỏ + chữ đúng xanh + số ¹²³ trỏ xuống phần phân tích. */
function MarkedAnswer({ segs, width, mark, dim = false }: { segs: Seg[]; width: number; mark: ReactNode; dim?: boolean }) {
  const lines = diffLines(segs, Math.max(20, width), dim ? MUTED : undefined);
  return (
    <Box>
      <Box flexShrink={0}>{mark}</Box>
      <Box flexDirection="column">
        {lines.map((ln, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dòng đã ngắt không có id riêng
          <Text key={i}>
            {ln.map((wd, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: từ trong dòng không có id riêng
              <Text key={j} color={wd.c} strikethrough={wd.strike} bold={wd.bold}>
                {wd.s}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

/** Phân tích theo số: ¹ sai → đúng · vì sao. */
function FixList({ fixes }: { fixes: Fix[] }) {
  return (
    <Box flexDirection="column">
      {fixes.map((f) => (
        <Hang key={f.n} mark={<Text color={WARM}>{sup(f.n)} </Text>}>
          {f.old ? (
            <Text color={BAD} strikethrough>
              {f.old}
            </Text>
          ) : (
            <Text color={MUTED}>(thiếu)</Text>
          )}
          <Text color={MUTED}> → </Text>
          {f.neu ? <Text color={BRAND}>{f.neu}</Text> : <Text color={MUTED}>(bỏ)</Text>}
          {f.why ? <Text color={MUTED}> · {f.why}</Text> : null}
        </Hang>
      ))}
    </Box>
  );
}

/** Chuỗi đúng như sẽ hiện trên dòng câu đã chấm (bản đánh dấu: cũ + mới + số) — để ước chiều cao. */
const shownAnswer = (fb: Feedback | null | undefined, answer: string) =>
  fb?.marked
    ? parseCritic(fb.marked)
        .segs.map((g) => (g.fix ? `${g.fix.old} ${g.fix.neu}¹ ` : g.s))
        .join('')
    : answer;

/** Câu đã chấm (đang mở): bản AI đánh dấu nếu có, không thì câu đã viết — chỉ đọc. */
function AnsweredLine({ fb, answer, width, color }: { fb: Feedback; answer: string; width: number; color: string }) {
  const marked = fb.marked ? parseCritic(fb.marked) : null;
  const mark = <Text color={color}>› </Text>;
  return marked?.fixes.length ? (
    <Box marginLeft={3}>
      <MarkedAnswer segs={marked.segs} width={width - 5} mark={mark} />
    </Box>
  ) : (
    <Hang indent={3} mark={mark}>
      {answer}
    </Hang>
  );
}

function GradedLines({
  answer,
  fb,
  sample,
  dim = false,
  width,
}: {
  answer: string;
  fb: Feedback;
  sample: string;
  dim?: boolean;
  width: number;
}) {
  const ok = fb.meaningOk && fb.tenseOk;
  const right = fb.corrected || sample;
  const perfect = ok && norm(right) === norm(answer);
  const marked = fb.marked ? parseCritic(fb.marked) : null;
  const mark = <Text color={toneOf(fb)}>{ok ? '✓ ' : '✗ '}</Text>;
  return (
    <>
      {marked?.fixes.length ? (
        <Box marginLeft={3}>
          <MarkedAnswer segs={marked.segs} width={width - 5} dim={dim} mark={mark} />
        </Box>
      ) : (
        <Hang indent={3} dim={dim} mark={mark}>
          {answer}
        </Hang>
      )}
      {perfect ? null : (
        <Hang indent={3} dim={dim} color={BRAND} mark={<Text color={BRAND}>→ </Text>}>
          {right}
        </Hang>
      )}
    </>
  );
}

function VocabHint({ vocab, index }: { vocab: Vocab | 'loading' | { error: string } | null; index: number }) {
  if (vocab === 'loading' || vocab === null)
    return (
      <Text color={MUTED}>
        <Spinner type="dots" /> đang lấy từ vựng…
      </Text>
    );
  if ('error' in vocab) return <Text color={BAD}>✗ {vocab.error}</Text>;
  const words = vocab.lines.find((l) => l.index === index)?.words ?? [];
  if (!words.length) return <Text color={MUTED}>📖 câu này không có từ nào đáng chú ý</Text>;
  const w = Math.max(...words.map((x) => x.vi.length));
  return (
    <Box flexDirection="column">
      <Text color={MUTED}>📖 từ vựng</Text>
      {words.map((x) => (
        <Text key={`${x.vi}-${x.en}`}>
          {'   '}
          {x.vi.padEnd(w)}
          <Text color={MUTED}> → </Text>
          <Text color={BRAND} bold>
            {x.en}
          </Text>
          <Text color={MUTED}> {x.pos}</Text>
        </Text>
      ))}
    </Box>
  );
}

/** Bảng phím tắt đầy đủ (^K) — chia nhóm cho dễ nhớ. */
function KeysHelp({ frame }: { frame: string }) {
  const groups: [string, [string, string][]][] = [
    [
      'Luyện',
      [
        ['⏎', 'chấm · câu tiếp · đoạn mới'],
        ['↑↓', 'đổi câu'],
        ['tab', 'gợi ý: cấu trúc → từ vựng → tắt'],
        ['^R', 'xem câu mẫu'],
        ['^U', 'viết lại câu đã chấm'],
      ],
    ],
    [
      'Đề',
      [
        ['^N', 'đề khác'],
        ['^L', 'lịch sử'],
        ['^F', 'tra từ (popup, bài vẫn giữ)'],
        ['^G', 'Việt → Anh: Google + AI'],
        ['^P', 'IPA — không tốn token'],
        ['^X', 'luyện lại từ đầu (khi hết kho)'],
      ],
    ],
    [
      'Giao diện',
      [
        ['^T', `màu khung (${frame})`],
        ['esc', 'đóng gợi ý · về menu'],
        ['^C', 'lưu & thoát'],
      ],
    ],
    ['Sửa dòng', [['←→ ^A ^E', 'di chuyển'], ['^U ^W', 'xoá dòng · xoá từ']]],
  ];
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={FAINT} paddingX={1}>
      {groups.map(([title, items]) => (
        <Box key={title}>
          <Box width={11} flexShrink={0}>
            <Text color={MUTED}>{title}</Text>
          </Box>
          <Box flexWrap="wrap" flexGrow={1}>
            {items.map(([k, label]) => (
              <Text key={k}>
                <Text color={WARM}>{k}</Text>
                <Text> {label}   </Text>
              </Text>
            ))}
          </Box>
        </Box>
      ))}
      <Text color={MUTED}>^K hoặc esc để đóng</Text>
    </Box>
  );
}

function Keys({ items }: { items: [string, string][] }) {
  return (
    <Box marginTop={1} flexWrap="wrap">
      {items.map(([k, label]) => (
        <Text key={k}>
          <Text color={WARM}>{k}</Text>
          <Text color={MUTED}> {label}   </Text>
        </Text>
      ))}
    </Box>
  );
}

/**
 * Ô trả lời + bong bóng "đang nghĩ" ở góc phải. Nhịp animation nằm Ở ĐÂY (cùng component với ô
 * nhập): Ink chỉ giữ con trỏ thật nếu component đặt nó được vẽ lại trong lượt đó — để bong bóng
 * tự vẽ lại riêng thì mỗi nhịp con trỏ thật biến mất.
 */
function AnswerInput({
  value,
  onChange,
  wide,
}: {
  value: string;
  onChange: (v: string) => void;
  wide: boolean;
}) {
  const t = useThinkingTick(value);
  return (
    <>
      {useLineEditor(value, onChange, true)}
      <ThinkingHint text={value} t={t} wide={wide} />
    </>
  );
}

// Chữ VENG kiểu "ANSI Shadow".
const LOGO = [
  '██╗   ██╗███████╗███╗   ██╗ ██████╗ ',
  '██║   ██║██╔════╝████╗  ██║██╔════╝ ',
  '██║   ██║█████╗  ██╔██╗ ██║██║  ███╗',
  '╚██╗ ██╔╝██╔══╝  ██║╚██╗██║██║   ██║',
  ' ╚████╔╝ ███████╗██║ ╚████║╚██████╔╝',
  '  ╚═══╝  ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ',
];
const NOISE = '░▒▓█▚▞▙▟@#%&*';
const QUOTES = [
  'Mỗi câu dịch hôm nay là một phản xạ ngày mai.',
  'Sai hôm nay để nói trơn ngày mai.',
  'Fluency is a habit, not a talent.',
  'Small reps. Big voice.',
  'Nói chậm cũng được — miễn là nói.',
  'Đừng dịch trong đầu. Nghĩ bằng tiếng Anh.',
  'One sentence at a time.',
];
/** Lúc hiệu ứng chạy xong (chữ đã giải mã + gõ hết) — sau đó đứng chờ Enter. */
const SPLASH_MS = 2100;

/**
 * Màn chào: chữ VENG "giải mã" từ nhiễu quét trái → phải, dải màu lướt qua,
 * khẩu hiệu tự gõ, rồi đứng chờ ⏎ để vào menu (phím khác = tua tới cuối hiệu ứng).
 */
/** Hai mục ngay dưới logo ở màn chào. */
const HOME = [
  { id: 'practice', label: 'Luyện tập', desc: 'dịch Việt → Anh, AI chấm · 14 loại' },
  { id: 'vocab', label: 'Từ vựng', desc: 'tra từ · IPA · chưa có thì thêm bằng AI' },
] as const;
type HomeId = (typeof HOME)[number]['id'];

function Splash({
  lines,
  onPick,
  instant = false,
}: {
  lines: number | null;
  onPick: (id: HomeId) => void;
  /** Quay về từ màn khác: hiện ngay khung cuối, khỏi chạy lại hiệu ứng. */
  instant?: boolean;
}) {
  const [sel, setSel] = useState(0);
  const [t, setT] = useState(0);
  // Mỗi ô một độ trễ ngẫu nhiên — chữ hiện lấm tấm chứ không thẳng tắp.
  const jitter = useRef(LOGO.map((row) => [...row].map(() => Math.random() * 260))).current;
  const quote = useRef(QUOTES[Math.floor(Math.random() * QUOTES.length)] as string).current;
  const { exit } = useApp();
  const start = useRef(instant ? Date.now() - SPLASH_MS : Date.now());
  // Dải màu cứ trôi trong lúc chờ Enter cho màn hình "sống".
  useEffect(() => {
    const id = setInterval(() => setT(Date.now() - start.current), 40);
    return () => clearInterval(id);
  }, []);
  const ready = t >= SPLASH_MS;
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === 'd')) return exit();
    // Đang chạy hiệu ứng: phím bất kỳ = tua tới cuối, hiện menu.
    if (!ready) {
      start.current = Math.min(start.current, Date.now() - SPLASH_MS);
      return;
    }
    if (key.upArrow || key.downArrow || key.tab) return setSel((s) => (s + 1) % HOME.length);
    const n = input.length === 1 ? Number(input) : 0;
    if (n >= 1 && n <= HOME.length) return setSel(n - 1);
    if (key.return) onPick(HOME[sel]?.id ?? 'practice');
  });

  const width = LOGO[0]?.length ?? 1;
  const logo = LOGO.map((row, y) =>
    [...row]
      .map((ch, x) => {
        if (ch === ' ') return ch;
        const at = (x / width) * 700 + (jitter[y]?.[x] ?? 0);
        if (t >= at) return ch;
        return t >= at - 350 ? (NOISE[Math.floor(Math.random() * NOISE.length)] as string) : ' ';
      })
      .join(''),
  ).join('\n');
  // Dải màu trôi: xoay mảng màu theo thời gian.
  const palette = [BRAND, '#7fd8c6', WARM, '#f0c46a', BRAND, '#2f7f72'];
  const shift = Math.floor(t / 90) % palette.length;
  const colors = [...palette.slice(shift), ...palette.slice(0, shift)];
  const typed = (txt: string, from: number) =>
    txt.slice(0, Math.max(0, Math.floor((t - from) / 14)));

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Gradient colors={colors}>{logo}</Gradient>
      <Box marginTop={1} flexDirection="column">
        <Text color={MUTED}>{typed('▍ phản xạ Việt → Anh · ngay trong terminal', 650)}</Text>
        <Text bold color={WARM}>
          {typed(`“${quote}”`, 900)}
        </Text>
        {lines ? (
          <Text color={MUTED}>{typed(`  ${lines} câu đã luyện — tiếp nào.`, 1300)}</Text>
        ) : null}
      </Box>
      {ready ? (
        <Box flexDirection="column" marginTop={1}>
          {HOME.map((h, i) => (
            <Text key={h.id}>
              <Text color={WARM} bold>
                {i === sel ? ' ▸ ' : '   '}
              </Text>
              <Text color={MUTED}>{i + 1} </Text>
              <Text color={i === sel ? WARM : undefined} bold={i === sel}>
                {h.label.padEnd(11)}
              </Text>
              <Text color={MUTED}>{h.desc}</Text>
            </Text>
          ))}
          <Keys
            items={[
              ['↑↓', 'chọn'],
              ['1 2', 'nhảy tới'],
              ['⏎', 'vào'],
              ['^C', 'thoát'],
            ]}
          />
        </Box>
      ) : (
        <Box marginTop={1} height={4} />
      )}
    </Box>
  );
}

const VERDICT_MS = 1500;
const CHEERS = {
  good: ['CHÍNH XÁC', 'QUÁ ĐỈNH', 'CHUẨN KHÔNG CẦN CHỈNH', 'PHẢN XẠ TỐT', 'NHƯ NGƯỜI BẢN XỨ'],
  near: ['GẦN LẮM RỒI', 'Ý ĐÚNG RỒI — CHỈNH CHÚT XÍU', 'SUÝT NỮA'],
  bad: ['CHƯA ĐÚNG', 'SAI ĐỂ NHỚ LÂU', 'THỬ LẠI NÀO'],
};
const SPARKS = '✦✧★✶·⋆';
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)] as T;

/**
 * Hiệu ứng ngay sau khi AI chấm (~1.5s): đúng = pháo hoa bung hai bên + điểm đếm lên,
 * gần đúng = chữ vàng nảy, sai = chữ đỏ rung + glitch rồi rõ dần. Xong thì tự tắt.
 */
function Verdict({
  fb,
  streak,
  onEnd,
  compact = false,
}: {
  fb: Feedback;
  streak: number;
  onEnd: () => void;
  /** Một dòng — cho câu đã rời đi trong lúc chờ chấm (chấm chạy nền). */
  compact?: boolean;
}) {
  const tone: keyof typeof CHEERS = fb.meaningOk && fb.tenseOk ? 'good' : fb.meaningOk ? 'near' : 'bad';
  const color = tone === 'good' ? BRAND : tone === 'near' ? WARM : BAD;
  const word = useRef(pick(CHEERS[tone])).current;
  // Mỗi tia một tốc độ / ký tự riêng, bung ra hai bên trên 3 hàng.
  const sparks = useRef(
    Array.from({ length: 24 }, (_, k) => ({
      row: k % 3,
      dir: k % 2 ? 1 : -1,
      v: 0.012 + Math.random() * 0.03,
      ch: pick([...SPARKS]),
    })),
  ).current;
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const el = Date.now() - start;
      setT(el);
      if (el >= VERDICT_MS) {
        clearInterval(id);
        onEnd();
      }
    }, 33);
    return () => clearInterval(id);
  }, [onEnd]);

  const W = 52;
  const mid = Math.floor(W / 2);
  const p = Math.min(1, t / 650);
  const ease = 1 - (1 - p) ** 3;
  const score = Math.round(ease * fb.score);
  const banner = ` ${tone === 'good' ? '✔' : tone === 'near' ? '≈' : '✘'} ${word} `;
  // Sai: rung lắc tắt dần + 400ms đầu chữ bị nhiễu.
  const shake = tone === 'bad' ? Math.round(Math.sin(t / 22) * 3 * Math.max(0, 1 - t / 700)) : 0;
  const shown =
    tone === 'bad' && t < 400
      ? [...banner].map((c) => (c !== ' ' && Math.random() < 0.5 - t / 900 ? pick([...'▓▒░#%@']) : c)).join('')
      : banner;
  // Gần đúng: nảy lên một nhịp (đệm dòng trống trên).
  const bounce = tone === 'near' && t > 150 && t < 450 ? 0 : 1;

  const sparkRow = (row: number) => {
    const cells = Array<string>(W).fill(' ');
    if (tone === 'good') {
      for (const s of sparks) {
        if (s.row !== row) continue;
        // ký tự chính + vệt mờ phía sau
        const d = 4 + s.v * t;
        const x = Math.round(mid + s.dir * d);
        const tail = Math.round(mid + s.dir * (d - 2));
        if (tail >= 0 && tail < W && t < 1200) cells[tail] = '·';
        if (x >= 0 && x < W && t < 1300) cells[x] = t > 1000 ? '·' : s.ch;
      }
    }
    return cells.join('');
  };
  const pad = Math.max(0, mid - Math.floor(banner.length / 2) + shake);

  if (compact) {
    const trail =
      tone === 'good'
        ? Array.from({ length: Math.min(6, Math.floor(t / 110)) }, (_, k) =>
            t > 1150 ? '·' : (SPARKS[(k + Math.floor(t / 80)) % SPARKS.length] as string),
          ).join(' ')
        : '';
    return (
      <Box marginLeft={3}>
        <Text>
          {' '.repeat(Math.max(0, 2 + shake))}
          <Text bold inverse color={color}>
            {shown}
          </Text>
          <Text bold color={color}>
            {' '}
            {score}/10
          </Text>
          {trail ? <Text color={WARM}> {trail}</Text> : null}
          {tone === 'good' && streak >= 2 ? <Text color={WARM}>{`  🔥 ${streak}`}</Text> : null}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginLeft={3}>
      <Text color={WARM}>{sparkRow(0)}</Text>
      {bounce ? null : <Text> </Text>}
      <Text>
        {' '.repeat(pad)}
        <Text bold inverse color={color}>
          {shown}
        </Text>
        <Text bold color={color}>
          {'  '}
          {score}/10
        </Text>
      </Text>
      <Text>
        <Text color={WARM}>{sparkRow(1)}</Text>
      </Text>
      <Text>
        {' '.repeat(Math.max(0, mid - 10))}
        <Text color={color}>{'●'.repeat(score)}</Text>
        <Text color={MUTED}>{'○'.repeat(10 - score)}</Text>
        {tone === 'good' && streak >= 2 ? <Text color={WARM}>{`  🔥 ${streak} câu liên tiếp`}</Text> : null}
      </Text>
      <Text color={WARM}>{sparkRow(2)}</Text>
    </Box>
  );
}

/** Phím chọn nhanh ở menu: 1–9 rồi a–z. */
const HOTKEYS = '123456789abcdefghijklmnopqrstuvwxyz';
const LABEL_W = Math.max(...KINDS.map((k) => k.label.length)) + 2;

/** Một dòng tiến độ ở menu: thanh đoạn đã làm / kho đề · số đoạn · điểm TB. */
function KindProgress({ st }: { st?: Stats }) {
  if (!st) return <Text color={MUTED}>…</Text>;
  const W = 12;
  const n = st.doneDrills ? Math.max(1, Math.round((st.doneDrills / Math.max(1, st.totalDrills)) * W)) : 0;
  return (
    <Text>
      <Text color={BRAND}>{'━'.repeat(n)}</Text>
      <Text color={MUTED}>{'─'.repeat(W - n)}</Text>
      <Text color={MUTED}>{` ${`${st.doneDrills}/${st.totalDrills}`.padStart(7)}`}</Text>
      {st.lines ? (
        <Text>
          {'  ⌀ '}
          <Text color={st.avg >= 8 ? BRAND : st.avg >= 6 ? WARM : BAD}>{st.avg}</Text>
          <Text color={MUTED}> · {st.lines} câu</Text>
        </Text>
      ) : (
        <Text color={MUTED}>  chưa luyện</Text>
      )}
    </Text>
  );
}

/** Mở veng: chọn loại luyện (con trỏ sẵn ở loại lần trước) → vào luyện; Esc trong bài → quay lại đây. */
export function App({ cfg }: { cfg: Config }) {
  const { exit } = useApp();
  const [kind, setKind] = useState<Kind | null>(null);
  /** home = màn chào + 2 mục · kinds = chọn loại luyện · ipa = tra phiên âm. */
  const [screen, setScreen] = useState<'home' | 'kinds' | 'vocab'>('home');
  const seenHome = useRef(false);
  const pickHome = useCallback((id: HomeId) => {
    seenHome.current = true;
    setScreen(id === 'practice' ? 'kinds' : id);
  }, []);
  const goHome = useCallback(() => setScreen('home'), []);
  const [cur, setCur] = useState(() => Math.max(0, KINDS.findIndex((k) => k.id === cfg.lastKind)));
  /** Tiến độ từng loại — tải lại mỗi lần về menu. */
  const [progress, setProgress] = useState<Record<string, Stats>>({});
  useEffect(() => {
    if (kind) return;
    for (const k of KINDS) {
      client(cfg, k.id)
        .stats()
        .then((st) => setProgress((p) => ({ ...p, [k.id]: st })))
        .catch(() => {});
    }
  }, [cfg, kind]);
  useInput(
    (input, key) => {
      if (key.ctrl && (input === 'c' || input === 'd')) return exit();
      if (key.escape) return goHome();
      if (key.upArrow) setCur((c) => (c + KINDS.length - 1) % KINDS.length);
      if (key.downArrow || key.tab) setCur((c) => (c + 1) % KINDS.length);
      if (key.return) {
        saveLastKind(KINDS[cur].id);
        setKind(KINDS[cur]);
      }
      // Phím tắt chỉ dời con trỏ — vào bài vẫn phải Enter.
      // input rỗng (phím mũi tên…) thì indexOf('') = 0 → phải loại, không là nhảy về mục 1.
      const i = input.length !== 1 || key.ctrl || key.meta ? -1 : HOTKEYS.indexOf(input.toLowerCase());
      if (i >= 0 && i < KINDS.length) setCur(i);
    },
    { isActive: !kind && screen === 'kinds' },
  );
  if (screen === 'home') {
    const total = Object.values(progress).reduce((n, st) => n + st.lines, 0);
    return <Splash lines={total || null} onPick={pickHome} instant={seenHome.current} />;
  }
  if (screen === 'vocab') return <VocabView cfg={cfg} onBack={goHome} />;
  if (kind) return <Practice key={kind.id} cfg={cfg} kind={kind} onBack={() => setKind(null)} />;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header stats={null} />
      <Text color={MUTED}>Luyện gì hôm nay?</Text>
      <Box flexDirection="column" marginY={1}>
        {KINDS.map((k, i) => (
          <Text key={k.id}>
            <Text color={i === cur ? WARM : undefined} bold={i === cur}>
              {i === cur ? ' ▸ ' : '   '}
            </Text>
            <Text color={MUTED}>{HOTKEYS[i]} </Text>
            <Text color={i === cur ? WARM : undefined} bold={i === cur}>
              {k.label.padEnd(LABEL_W)}
            </Text>
            <KindProgress st={progress[k.id]} />
          </Text>
        ))}
      </Box>
      <Keys
        items={[
          ['↑↓', 'chọn'],
          ['1–9 a–e', 'nhảy tới'],
          ['⏎', 'vào luyện'],
          ['esc', 'về màn chào'],
          ['^C', 'thoát'],
        ]}
      />
    </Box>
  );
}

/** Câu ví dụ của Gemini có **đậm** quanh từ chính → in đậm trong terminal. */
function Bolded({ text }: { text: string }) {
  return (
    <Text>
      {text.split('**').map((part, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: mảnh chữ không có id riêng
        i % 2 ? (
          <Text key={i} bold color={BRAND}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/** Một mục gắn nhãn bên trái (ví dụ, họ từ…) — nhãn mờ, nội dung thụt đều. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={MUTED}>  {title}</Text>
      <Box flexDirection="column" marginLeft={4}>
        {children}
      </Box>
    </Box>
  );
}

const stripSlash = (ipa: string) => ipa.replace(/^\/|\/$/g, '');
const POS_VI: Record<string, string> = {
  noun: 'danh từ',
  verb: 'động từ',
  adjective: 'tính từ',
  adverb: 'trạng từ',
  phrase: 'cụm',
};

/** Thẻ từ đầy đủ như trang từ vựng trên web: IPA, nghĩa, định nghĩa, ví dụ, họ từ, đồng/trái nghĩa, cụm. */
function DetailCard({ d, cmu }: { d: WordDetail; cmu?: IpaEntry }) {
  const fam = d.familyWords;
  const core =
    fam?.entries?.find((e) => e.word.toLowerCase() === d.word.toLowerCase()) ??
    fam?.entries?.find((e) => e.level === 'core');
  const family = (fam?.entries ?? []).filter((e) => e !== core).slice(0, 6);
  const ipa = d.ipa ? stripSlash(d.ipa) : cmu?.ipa;
  const pos = (d.pos || d.posAuto || core?.pos || '')
    .split(',')
    .filter(Boolean)
    .map((p) => POS_VI[p.trim()] ?? p.trim())
    .join(' · ');
  const examples = [...new Set([d.example, ...(core?.examples ?? [])].filter((x): x is string => !!x))].slice(0, 3);
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={BRAND} paddingX={1}>
      <Text>
        <Text bold color={BRAND}>
          {d.word}
        </Text>
        {ipa ? <Text color={WARM}>  /{ipa}/</Text> : null}
        {cmu?.alts?.length ? <Text color={MUTED}> · cũng đọc /{cmu.alts.join('/, /')}/</Text> : null}
        {pos ? <Text color={MUTED}>  {pos}</Text> : null}
      </Text>
      <Text bold>{d.meaning}</Text>
      {core?.definition_en ? <Text color={MUTED}>{core.definition_en}</Text> : null}
      {examples.length ? (
        <Section title="ví dụ">
          {examples.map((ex) => (
            <Bolded key={ex} text={ex} />
          ))}
        </Section>
      ) : null}
      {family.length ? (
        <Section title="họ từ">
          {family.map((e) => (
            <Text key={`${e.word}-${e.pos}`}>
              <Text bold>{e.word}</Text>
              <Text color={MUTED}>
                {' '}
                {POS_VI[e.pos] ?? e.pos}
              </Text>{' '}
              — {e.meaning_vi}
            </Text>
          ))}
        </Section>
      ) : null}
      {d.synonyms?.length ? (
        <Section title="đồng nghĩa">
          {d.synonyms.slice(0, 3).map((x) => (
            <Box key={x.word} flexDirection="column">
              <Text>
                <Text bold>{x.word}</Text> — {x.vi}
                {x.note ? <Text color={MUTED}> · {x.note}</Text> : null}
              </Text>
              {x.example ? <Text color={MUTED}>  {x.example}</Text> : null}
            </Box>
          ))}
        </Section>
      ) : null}
      {fam?.antonyms?.length ? (
        <Section title="trái nghĩa">
          <Text>{fam.antonyms.map((e) => `${e.word} (${e.meaning_vi})`).join(' · ')}</Text>
        </Section>
      ) : null}
      {d.chunks?.length ? (
        <Section title="cụm hay dùng">
          {d.chunks.slice(0, 5).map((c) => (
            <Text key={c.chunk}>
              <Text bold>{c.chunk}</Text>
              {c.vi ? <Text color={MUTED}> — {c.vi}</Text> : null}
            </Text>
          ))}
        </Section>
      ) : null}
      {d.note ? (
        <Section title="ghi chú">
          <Text>{d.note}</Text>
        </Section>
      ) : null}
    </Box>
  );
}

/** IPA từng từ (CMUdict, từ lạ espeak đoán) — cho câu / cụm chưa có trong kho. */
function IpaTable({ rows }: { rows: { w: string; e?: IpaEntry }[] }) {
  const w = Math.max(4, ...rows.map((x) => x.w.length));
  return (
    <Box flexDirection="column" marginTop={1}>
      {rows.map((x) => (
        <Text key={x.w}>
          {'  '}
          <Text bold>{x.w.padEnd(w)}</Text>
          {'  '}
          {x.e ? (
            <>
              <Text color={WARM}>/{x.e.ipa}/</Text>
              {x.e.alts?.length ? <Text color={MUTED}> · cũng đọc /{x.e.alts.join('/, /')}/</Text> : null}
              {x.e.src === 'rule' ? <Text color={MUTED}> (đoán theo chính tả)</Text> : null}
            </>
          ) : (
            <Text color={MUTED}>— không tra được</Text>
          )}
        </Text>
      ))}
    </Box>
  );
}

const LEVEL_COLOR: Record<string, string> = {
  'rất thông dụng': BRAND,
  'thông dụng': '#7fd8c6',
  'thân mật': '#f472b6',
  'trang trọng': WARM,
  'ít dùng': MUTED,
};

/**
 * ^G — tra nhanh Việt → Anh, một lần ⏎ là đủ: Google Translate + AI (2–3 cách nói, mức độ
 * thông dụng) + từ trong kho có nghĩa khớp. Server cache vĩnh viễn nên tra lại không tốn token.
 */
/**
 * ^P — tra IPA nhanh, KHÔNG tốn token: chỉ từ điển phát âm (CMUdict, từ lạ espeak đoán theo
 * chính tả), server nhớ trong DB. Gõ từ / cụm / câu → IPA từng từ; có gợi ý autocomplete.
 */
function IpaView({ cfg, onBack }: { cfg: Config; onBack: () => void }) {
  const { exit } = useApp();
  const api = useRef(client(cfg)).current;
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ q: string; rows: { w: string; e?: IpaEntry }[]; error?: string }[]>([]);
  const input = useLineEditor(q, setQ, !busy);
  const token = q.match(/[A-Za-z]+$/)?.[0] ?? '';
  const sug = useSuggest(api, token, !busy, (w) => setQ(`${q.slice(0, q.length - token.length)}${w} `));
  useInput((ch, key) => {
    if (key.ctrl && (ch === 'c' || ch === 'd')) return exit();
    if (key.escape || (key.ctrl && ch === 'p')) return onBack();
    if (!key.return || busy) return;
    const picked = sug.pick();
    const text = (picked ? q.slice(0, q.length - token.length) + picked : q).trim();
    const toks = tokensOf(text);
    if (!toks.length) return;
    setBusy(true);
    api
      .ipa(toks)
      .then((r) => ({ q: text, rows: toks.map((w) => ({ w, e: r.words[ipaKey(w)] })) }))
      .catch((e) => ({ q: text, rows: [], error: (e as Error).message }))
      .then((x) => {
        setResults((p) => [x, ...p.filter((y) => y.q !== text)].slice(0, 3));
        setQ('');
        setBusy(false);
      });
  });
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={WARM} bold>
          ▍IPA
        </Text>
        <Text color={MUTED}> · từ điển phát âm, không tốn token · ^P hoặc esc để đóng</Text>
      </Text>
      <Box borderStyle="round" borderColor={WARM} paddingX={1}>
        <Text color={WARM}>› </Text>
        {busy ? (
          <Text color={MUTED}>
            <Spinner type="dots" /> đang tra…
          </Text>
        ) : (
          input
        )}
      </Box>
      <SuggestList items={sug.items} sel={sug.sel} q={sug.q} />
      {!results.length && !busy && !sug.items.length ? (
        <Text color={MUTED}>  Gõ từ, cụm hoặc cả câu tiếng Anh rồi ⏎.</Text>
      ) : null}
      {results.map((x, i) => (
        <Box key={x.q} flexDirection="column">
          {x.rows.length > 1 || x.error ? (
            <Box marginTop={1}>
              <Text dimColor={i > 0}>  {x.q}</Text>
            </Box>
          ) : null}
          {x.error ? <Text color={BAD}>    ✗ {x.error}</Text> : <IpaTable rows={x.rows} />}
        </Box>
      ))}
      <Keys
        items={[
          ['⏎', 'tra'],
          ['esc', 'đóng, về bài'],
        ]}
      />
    </Box>
  );
}

function ViEnView({ cfg, onBack, embedded = false }: { cfg: Config; onBack: () => void; embedded?: boolean }) {
  const { exit } = useApp();
  const api = useRef(client(cfg)).current;
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ q: string; r?: ViEn; error?: string }[]>([]);
  const input = useLineEditor(q, setQ, !busy);
  useInput((ch, key) => {
    if (key.ctrl && (ch === 'c' || ch === 'd')) return exit();
    if (key.escape || (key.ctrl && ch === 'g')) return onBack();
    if (!key.return || busy || !q.trim()) return;
    const text = q.trim();
    setBusy(true);
    api
      .viEn(text)
      .then((r) => ({ q: text, r }))
      .catch((e) => ({ q: text, error: (e as Error).message }))
      .then((x) => {
        setResults((p) => [x, ...p.filter((y) => y.q !== text)].slice(0, 3));
        setQ('');
        setBusy(false);
      });
  });
  return (
    <Box flexDirection="column" paddingX={embedded ? 0 : 1}>
      <Text>
        <Text color={WARM} bold>
          ▍Việt → Anh
        </Text>
        <Text color={MUTED}> · Google + AI (cách nói, mức độ thông dụng) · ^G hoặc esc để đóng</Text>
      </Text>
      <Box borderStyle="round" borderColor={WARM} paddingX={1}>
        <Text color={WARM}>› </Text>
        {busy ? (
          <Text color={MUTED}>
            <Spinner type="dots" /> đang tra…
          </Text>
        ) : (
          input
        )}
      </Box>
      {!results.length && !busy ? <Text color={MUTED}>  Gõ tiếng Việt (từ, cụm hoặc câu) rồi ⏎.</Text> : null}
      {results.map((x, i) => (
        <Box key={x.q} flexDirection="column" marginTop={1}>
          <Text bold={i === 0} dimColor={i > 0}>
            {'  '}
            {x.q}
          </Text>
          {x.error ? <Text color={BAD}>    ✗ {x.error}</Text> : null}
          {x.r?.google ? (
            <Text dimColor={i > 0}>
              <Text color={MUTED}>    Google  </Text>
              <Text bold>{x.r.google}</Text>
            </Text>
          ) : null}
          {x.r?.options.map((o, j) => (
            <Text key={o.en} dimColor={i > 0}>
              <Text color={MUTED}>{j === 0 ? '    AI      ' : '            '}</Text>
              <Text bold color={BRAND}>
                {o.en}
              </Text>
              <Text color={LEVEL_COLOR[o.level] ?? MUTED}> · {o.level}</Text>
              {o.note ? <Text color={MUTED}> · {o.note}</Text> : null}
            </Text>
          ))}
          {x.r?.aiError ? <Text color={MUTED}>    AI      ✗ {x.r.aiError}</Text> : null}
          {x.r?.kho.length ? (
            <Text dimColor={i > 0}>
              <Text color={MUTED}>    Kho     </Text>
              {x.r.kho.map((k) => `${k.word} (${k.meaning})`).join(' · ')}
            </Text>
          ) : null}
        </Box>
      ))}
      <Keys
        items={[
          ['⏎', 'tra'],
          ['esc', embedded ? 'đóng, về bài' : 'quay lại'],
        ]}
      />
    </Box>
  );
}

type VocabPhase =
  | { s: 'idle' }
  | { s: 'busy'; msg: string }
  | {
      s: 'found';
      q: string;
      detail: WordDetail | null;
      others: WordItem[];
      ipa: { w: string; e?: IpaEntry }[];
    }
  | { s: 'preview'; q: string; p: WordPreview; useFix: boolean }
  | { s: 'saved'; word: string }
  | { s: 'error'; msg: string };

const tokensOf = (text: string) => (text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).slice(0, 30);
const ipaKey = (w: string) => w.toLowerCase().replace(/^'+|'+$/g, '');

/**
 * Từ vựng (gộp cả IPA): gõ từ / cụm / câu → có trong kho thì thẻ đầy đủ + IPA; chưa có thì IPA
 * từng từ + hỏi "Thêm bằng AI?" → xem trước (gợi ý sửa chính tả, cảnh báo trùng) → ⏎ mới lưu.
 * Lịch sử tra lưu trên máy (lookups.json), ô trống thì hiện để chọn lại.
 */
function VocabView({
  cfg,
  onBack,
  embedded = false,
}: {
  cfg: Config;
  onBack: () => void;
  /** Mở như popup trong trang luyện (^F): bỏ tiêu đề riêng, ^F / esc là đóng. */
  embedded?: boolean;
}) {
  const { exit } = useApp();
  const api = useRef(client(cfg)).current;
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState<VocabPhase>({ s: 'idle' });
  const [recent, setRecent] = useState<Lookup[]>(() => loadLookups());
  /** ^G: chuyển sang tra Việt → Anh; ô nhập + gợi ý ở đây phải tắt để phím không lọt vào cả hai. */
  const [vien, setVien] = useState(false);
  const typing =
    !vien && (phase.s === 'idle' || phase.s === 'found' || phase.s === 'saved' || phase.s === 'error');
  const input = useLineEditor(q, setQ, typing);
  // Vừa tra xong (ô nhập vẫn là chữ đó) thì khỏi gợi ý lại.
  const justSearched = phase.s === 'found' && q.trim() === phase.q;
  // Gợi ý theo từ cuối đang gõ — gõ cả câu (để xem IPA) vẫn gợi ý được.
  const token = q.match(/[A-Za-z]+$/)?.[0] ?? '';
  const sug = useSuggest(
    api,
    q.trim() ? token : '',
    typing && !justSearched,
    (w) => setQ(`${q.slice(0, q.length - token.length)}${w}`),
    recent.slice(0, 8).map((r) => ({ word: r.q, inDb: !!r.meaning, meaning: r.meaning })),
  );

  const lookup = (text: string) => {
    const query = text.trim();
    if (!query) return;
    setPhase({ s: 'busy', msg: 'đang tra…' });
    const toks = tokensOf(query);
    Promise.all([
      api.searchWords(query),
      toks.length
        ? api.ipa(toks).catch(() => ({ words: {} as Record<string, IpaEntry> }))
        : { words: {} as Record<string, IpaEntry> },
    ])
      .then(async ([r, ip]) => {
        const exact = r.items.find((w) => w.word.trim().toLowerCase() === query.toLowerCase()) ?? null;
        const detail = exact ? await api.wordDetail(exact.id).catch(() => null) : null;
        // Chỉ giữ từ mà chính nó chứa chữ đang tìm — /words/page khớp cả nghĩa, ví dụ nên rất nhiễu.
        const others = r.items
          .filter((w) => w !== exact && w.word.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 5);
        setRecent(saveLookup({ q: exact?.word ?? query, meaning: exact?.meaning }));
        setPhase({
          s: 'found',
          q: query,
          detail,
          others,
          ipa: toks.map((w) => ({ w, e: ip.words[ipaKey(w)] })),
        });
      })
      .catch((e) => setPhase({ s: 'error', msg: (e as Error).message }));
  };
  const preview = (word: string) => {
    setPhase({ s: 'busy', msg: `AI đang soạn thẻ "${word}"…` });
    api
      .previewWord(word)
      .then((p) => setPhase({ s: 'preview', q: word, p, useFix: true }))
      .catch((e) => setPhase({ s: 'error', msg: (e as Error).message }));
  };
  const save = (word: string, p: WordPreview) => {
    setPhase({ s: 'busy', msg: `đang lưu "${word}"…` });
    api
      .createWord(word, p)
      .then(() => {
        setPhase({ s: 'saved', word });
        setRecent(saveLookup({ q: word, meaning: p.data.entries[0]?.meaning_vi }));
        setQ('');
      })
      .catch((e) => setPhase({ s: 'error', msg: (e as Error).message }));
  };

  useInput((ch, key) => {
    if (key.ctrl && (ch === 'c' || ch === 'd')) return exit();
    if (vien) return;
    if (embedded && key.ctrl && ch === 'f') return onBack();
    if (key.ctrl && ch === 'g') return setVien(true);
    if (phase.s === 'busy') return;
    if (phase.s === 'preview') {
      if (key.escape) return setPhase({ s: 'idle' });
      if (phase.p.suggested && (key.tab || key.leftArrow || key.rightArrow))
        return setPhase({ ...phase, useFix: !phase.useFix });
      if (key.return) save(phase.p.suggested && phase.useFix ? phase.p.suggested : phase.q, phase.p);
      return;
    }
    if (key.escape) return onBack();
    if (!key.return) return;
    // Chưa có trong kho, ô nhập vẫn là chữ vừa tra → ⏎ = đồng ý thêm bằng AI.
    if (phase.s === 'found' && !phase.detail && q.trim() === phase.q) return preview(phase.q);
    const picked = sug.pick();
    const text = picked ? (sug.recent ? picked : `${q.slice(0, q.length - token.length)}${picked}`) : q;
    if (picked) setQ(text);
    lookup(text);
  });

  if (vien) return <ViEnView cfg={cfg} embedded={embedded} onBack={() => setVien(false)} />;

  const canAdd = phase.s === 'found' && !phase.detail && q.trim() === phase.q;
  const hint: [string, string][] =
    phase.s === 'preview'
      ? [
          ['⏎', 'lưu vào kho'],
          ...(phase.p.suggested ? ([['tab', 'đổi chữ lưu']] as [string, string][]) : []),
          ['esc', 'huỷ'],
        ]
      : canAdd
        ? [
            ['⏎', 'thêm bằng AI'],
            ['esc', embedded ? 'đóng, về bài' : 'về màn chào'],
          ]
        : [
            ['⏎', 'tra'],
            ['^G', 'Việt → Anh'],
            ['esc', embedded ? 'đóng, về bài' : 'về màn chào'],
          ];

  return (
    <Box flexDirection="column" paddingX={embedded ? 0 : 1}>
      {embedded ? (
        <Text>
          <Text color={WARM} bold>
            ▍Tra từ
          </Text>
          <Text color={MUTED}> · bài đang làm vẫn giữ nguyên · ^F hoặc esc để đóng</Text>
        </Text>
      ) : (
        <Header stats={null} title="Từ vựng · tra từ, IPA, thêm bằng AI" />
      )}
      <Box borderStyle="round" borderColor={WARM} paddingX={1}>
        <Box>
          <Text color={WARM}>› </Text>
          {typing ? input : <Text color={MUTED}>{q}</Text>}
        </Box>
      </Box>
      <SuggestList items={sug.items} sel={sug.sel} q={sug.q} recent={sug.recent} />
      {phase.s === 'idle' && !sug.items.length ? (
        <Text color={MUTED}>  Gõ một từ, cụm hoặc cả câu tiếng Anh rồi ⏎ — tra kho + IPA.</Text>
      ) : null}
      {phase.s === 'busy' ? (
        <Text color={BRAND}>
          {'  '}
          <Spinner type="dots" /> {phase.msg}
        </Text>
      ) : null}
      {phase.s === 'error' ? <Text color={BAD}>  ✗ {phase.msg}</Text> : null}
      {phase.s === 'saved' ? <Text color={BRAND}>  ✓ Đã thêm "{phase.word}" vào kho — trên web có ngay.</Text> : null}
      {phase.s === 'found' && !sug.items.length ? (
        <>
          {phase.detail ? (
            <DetailCard d={phase.detail} cmu={phase.ipa.length === 1 ? phase.ipa[0]?.e : undefined} />
          ) : (
            <>
              <IpaTable rows={phase.ipa} />
              <Box marginTop={1}>
                <Text>
                  {'  '}Chưa có <Text bold>"{phase.q}"</Text> trong kho. <Text color={WARM}>Thêm bằng AI? ⏎ có</Text>
                  <Text color={MUTED}> · gõ chữ khác để tra tiếp</Text>
                </Text>
              </Box>
            </>
          )}
          {phase.others.length ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={MUTED}>  {phase.detail ? 'cũng liên quan' : 'gần giống trong kho'}</Text>
              {phase.others.map((w) => (
                <Text key={w.id}>
                  {'    '}
                  <Text bold>{w.word}</Text>
                  <Text color={MUTED}> — {w.meaning}</Text>
                </Text>
              ))}
            </Box>
          ) : null}
        </>
      ) : null}
      {phase.s === 'preview' ? <PreviewCard phase={phase} /> : null}
      <Keys items={hint} />
    </Box>
  );
}

/** Xem trước thẻ AI soạn: gợi ý sửa chính tả, cảnh báo trùng, nghĩa + ví dụ + họ từ. */
function PreviewCard({ phase }: { phase: Extract<VocabPhase, { s: 'preview' }> }) {
  const { p, q, useFix } = phase;
  const core = p.data.entries.find((e) => e.level === 'core') ?? p.data.entries[0];
  const family = p.data.entries.filter((e) => e !== core);
  const saveAs = p.suggested && useFix ? p.suggested : q;
  return (
    <Box flexDirection="column" marginTop={1}>
      {p.suggested ? (
        <Box flexDirection="column" borderStyle="round" borderColor={WARM} paddingX={1}>
          <Text>
            Có phải ý bạn là <Text bold color={BRAND}>{p.suggested}</Text>? <Text color={MUTED}>(bạn gõ "{q}")</Text>
          </Text>
          <Text>
            <Text color={useFix ? WARM : MUTED}>{useFix ? '●' : '○'} lưu là {p.suggested}</Text>
            {'    '}
            <Text color={!useFix ? WARM : MUTED}>{!useFix ? '●' : '○'} giữ "{q}"</Text>
          </Text>
        </Box>
      ) : null}
      {p.existing?.length ? (
        <Text color={BAD}>
          {'  '}⚠ Đã có trong kho: {p.existing.map((e) => `${e.word} — ${e.meaning}`).join(' · ')} — lưu nữa sẽ thành thẻ trùng.
        </Text>
      ) : null}
      {core ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {'  '}
            <Text bold color={BRAND}>
              {saveAs}
            </Text>
            {core.ipa ? <Text color={MUTED}> /{core.ipa.replace(/^\/|\/$/g, '')}/</Text> : null}
            <Text color={MUTED}> · {core.pos}</Text>
          </Text>
          <Text>{`  ${core.meaning_vi}`}</Text>
          {core.definition_en ? <Text color={MUTED}>{`  ${core.definition_en}`}</Text> : null}
          {core.examples?.map((ex) => (
            <Text key={ex}>
              {'  '}
              <Bolded text={ex} />
            </Text>
          ))}
        </Box>
      ) : null}
      {family.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={MUTED}>  họ từ</Text>
          {family.map((e) => (
            <Text key={`${e.word}-${e.pos}`}>
              {'    '}
              <Text bold>{e.word}</Text>
              <Text color={MUTED}>
                {' '}
                {e.pos} — {e.meaning_vi}
              </Text>
            </Text>
          ))}
        </Box>
      ) : null}
      {p.data.synonyms?.length ? (
        <Text color={MUTED}>
          {'  '}đồng nghĩa: {p.data.synonyms.map((s) => `${s.word} (${s.vi})`).join(' · ')}
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Autocomplete chung (IPA, Từ vựng): gợi ý theo `token` (gõ ≥2 chữ), hoãn 150ms.
 * ↑↓ chọn · Tab điền (mục đang chọn, mặc định mục đầu) · `pick()` lấy mục đã chọn bằng ↑↓ cho ⏎.
 */
function useSuggest(
  api: Client,
  token: string,
  active: boolean,
  accept: (word: string) => void,
  /** Hiện khi chưa gõ gì (vd lịch sử đã tra). */
  fallback: Suggestion[] = [],
) {
  const [fetched, setFetched] = useState<Suggestion[]>([]);
  /** -1 = không chọn mục nào → ⏎ dùng đúng chữ đã gõ. */
  const [sel, setSel] = useState(-1);
  const t = token.toLowerCase();
  useEffect(() => {
    setSel(-1);
    if (!active || t.length < 2) return setFetched([]);
    let live = true;
    const id = setTimeout(() => {
      api
        .suggest(t)
        // Giữ cả mục trùng đúng chữ đã gõ, đưa lên đầu: nó cho biết từ đã có trong kho (kèm nghĩa).
        .then((r) => {
          if (!live) return;
          const same = r.items.filter((s) => s.word.toLowerCase() === t);
          setFetched([...same, ...r.items.filter((s) => s.word.toLowerCase() !== t)]);
        })
        .catch(() => live && setFetched([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [api, t, active]);
  const items = !active ? [] : t ? fetched : fallback;
  useInput(
    (_ch, key) => {
      if (!items.length) return;
      // Vòng -1 → 0 … n-1 → -1: luôn quay lại được "không chọn" (giữ chữ đã gõ).
      if (key.downArrow) setSel((s) => (s >= items.length - 1 ? -1 : s + 1));
      if (key.upArrow) setSel((s) => (s <= -1 ? items.length - 1 : s - 1));
      if (key.tab) {
        const w = items[Math.max(0, sel)]?.word;
        if (w) accept(w);
      }
    },
    { isActive: active },
  );
  return { items, sel, q: token, recent: !t, pick: () => (sel >= 0 ? items[sel]?.word : undefined) };
}

/** Tô sáng đoạn khớp với chữ đang gõ (lần xuất hiện đầu, không phân biệt hoa/thường). */
function Highlight({ text, q, bold, dim }: { text: string; q: string; bold?: boolean; dim?: boolean }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0)
    return (
      <Text bold={bold} dimColor={dim}>
        {text}
      </Text>
    );
  return (
    <Text bold={bold} dimColor={dim}>
      {text.slice(0, i)}
      <Text color={BRAND} underline bold>
        {text.slice(i, i + q.length)}
      </Text>
      {text.slice(i + q.length)}
    </Text>
  );
}

/** Cột từ tối đa chừng này ký tự — kho có cả câu dài, không thì đẩy cột nghĩa ra tận mép. */
const SUGGEST_W = 28;
/** Cắt chữ dài còn `n` ký tự, cố giữ đoạn khớp `q` trong phần hiện ra. */
function clip(text: string, q: string, n: number): string {
  if (text.length <= n) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  const start = i + q.length > n - 1 ? Math.max(0, i - 6) : 0;
  const cut = text.slice(start, start + n - (start ? 2 : 1));
  return `${start ? '…' : ''}${cut}…`;
}

function SuggestList({
  items,
  sel,
  q,
  recent = false,
}: {
  items: Suggestion[];
  sel: number;
  q: string;
  recent?: boolean;
}) {
  if (!items.length) return null;
  const shown = items.map((s) => clip(s.word, q, SUGGEST_W));
  const w = Math.max(...shown.map((t) => t.length));
  return (
    <Box flexDirection="column" marginLeft={2}>
      {recent ? <Text color={MUTED}>  đã tra gần đây</Text> : null}
      {items.map((s, i) => (
        // ● xanh = đã có trong kho (chữ sáng + nghĩa) · ○ mờ = chỉ có trong từ điển.
        <Text key={s.word} wrap="truncate-end">
          <Text color={WARM}>{i === sel ? '▸' : ' '}</Text>
          <Text color={s.inDb ? BRAND : FAINT}>{s.inDb ? '● ' : '○ '}</Text>
          <Highlight text={shown[i] ?? s.word} q={q} bold={i === sel || s.inDb} dim={!s.inDb && i !== sel} />
          {' '.repeat(w - (shown[i] ?? s.word).length)}
          {s.inDb ? <Text>  {s.meaning}</Text> : <Text color={FAINT}>  chưa có trong kho</Text>}
        </Text>
      ))}
      <Text>
        <Text color={BRAND}>  ● </Text>
        <Text color={MUTED}>trong kho   </Text>
        <Text color={FAINT}>○ </Text>
        <Text color={MUTED}>chưa có (từ điển)</Text>
      </Text>
      <Text color={MUTED}>
        {sel >= 0
          ? `  ⏎ dùng "${items[sel]?.word}" · ↑↓ về "${q || '…'}" để giữ chữ đã gõ`
          : recent
            ? '  ↑↓ chọn từ đã tra · ⏎ tra lại'
            : `  ⏎ tìm "${q}" · ↓ chọn gợi ý · tab điền`}
      </Text>
    </Box>
  );
}

const HISTORY_FILTERS = [
  { id: 'weak', label: 'Cần cải thiện' },
  { id: 'all', label: 'Tất cả' },
] as const;
const HISTORY_PAGE = 8;

const scoreColor = (n: number) => (n >= 8 ? BRAND : n >= 6 ? WARM : BAD);
const pad2 = (n: number) => String(n).padStart(2, '0');
/** "15/09 10:05" — tự ghép vì toLocaleString('vi-VN') của Node ra "10:05 15-09". */
const when = (ts: number) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Tô đỏ đúng những mảnh AI chỉ ra là sai (khớp nguyên văn) — giống web. */
function MarkWrong({ text, wrong }: { text: string; wrong: string[] }) {
  const parts = wrong
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  if (!parts.length) return <Text>{text}</Text>;
  return (
    <Text>
      {text.split(new RegExp(`(${parts.join('|')})`, 'g')).map((chunk, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: mảnh text không có id riêng
          <Text key={i} color={BAD} underline>
            {chunk}
          </Text>
        ) : (
          chunk
        ),
      )}
    </Text>
  );
}

/**
 * Lịch sử theo bài (cùng endpoint với tab Lịch sử trên web): ↑↓ chọn bài, bài đang chọn
 * mở ra đoạn đã viết (lỗi tô đỏ), cần chú ý, đoạn đúng; ⏎ xem từng câu; r học lại.
 */
function HistoryView({
  api,
  axis,
  onRetry,
  onClose,
}: {
  api: Client;
  axis: string;
  onRetry: (d: Drill) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<'weak' | 'all'>('weak');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [error, setError] = useState('');
  const [cur, setCur] = useState(0);
  const [detail, setDetail] = useState(false);

  useEffect(() => {
    setData(null);
    setError('');
    api
      .history(filter, page, HISTORY_PAGE)
      .then((d) => {
        setData(d);
        setCur(0);
        setDetail(false);
      })
      .catch((e) => setError((e as Error).message));
  }, [api, filter, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const items = data?.items ?? [];
  const sel = items[cur];

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'l')) return onClose();
    if (key.tab) {
      setFilter((f) => (f === 'weak' ? 'all' : 'weak'));
      return setPage(1);
    }
    if (key.upArrow) {
      setDetail(false);
      return setCur((c) => Math.max(0, c - 1));
    }
    if (key.downArrow) {
      setDetail(false);
      return setCur((c) => Math.min(items.length - 1, c + 1));
    }
    if (key.leftArrow && page > 1) return setPage(page - 1);
    if (key.rightArrow && page < pages) return setPage(page + 1);
    if (key.return && sel) return setDetail((d) => !d);
    if (input === 'r' && sel) onRetry(sel.drill);
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold>Lịch sử </Text>
        {HISTORY_FILTERS.map((f) => (
          <Text key={f.id} color={f.id === filter ? WARM : MUTED} bold={f.id === filter}>
            {f.id === filter ? ` [${f.label}] ` : `  ${f.label}  `}
          </Text>
        ))}
        {data ? (
          <Text color={MUTED}>
            {' '}
            · {data.total} bài · trang {page}/{pages}
          </Text>
        ) : null}
      </Text>
      {error ? <Text color={BAD}>✗ {error}</Text> : null}
      {!data && !error ? (
        <Text color={BRAND}>
          <Spinner type="dots" /> Đang tải…
        </Text>
      ) : null}
      {data && !items.length ? (
        <Text color={MUTED}>
          {filter === 'weak' ? 'Không còn bài nào cần cải thiện 🎉 — Tab để xem tất cả.' : 'Chưa làm bài nào.'}
        </Text>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {items.map((p, i) => {
          const active = i === cur;
          const good = p.lines.filter((l) => l.meaningOk && l.tenseOk).length;
          const avg = Math.round((p.lines.reduce((n, l) => n + l.score, 0) / p.lines.length) * 10) / 10;
          const total = p.drill.lines?.length ?? p.lines.length;
          const first = p.lines[0]?.vi ?? '';
          return (
            <Box key={p.drillKey} flexDirection="column" marginBottom={active ? 1 : 0}>
              <Text>
                <Text color={active ? WARM : MUTED}>{active ? '▸ ' : '  '}</Text>
                <Text bold color={scoreColor(avg)}>
                  {String(avg).padStart(4)}/10
                </Text>
                <Text color={MUTED}>
                  {'  '}đúng {good}/{p.lines.length}
                  {p.lines.length < total ? ` · làm ${p.lines.length}/${total}` : ''} · {when(p.lastAt)}
                  {'  '}
                </Text>
                <Text bold={active} dimColor={!active}>
                  {first.length > 48 ? `${first.slice(0, 47)}…` : first}
                </Text>
              </Text>
              {active ? (
                <Box
                  flexDirection="column"
                  marginLeft={4}
                  paddingLeft={1}
                  borderStyle="bold"
                  borderTop={false}
                  borderRight={false}
                  borderBottom={false}
                  borderColor={scoreColor(avg)}
                >
                  {p.drill.context ? <Text color={MUTED}>🗣 {p.drill.context}</Text> : null}
                  <Text color={MUTED}>bạn viết</Text>
                  <Text>
                    {p.lines.map((l) => (
                      <Text key={l.id}>
                        <MarkWrong
                          text={l.answer}
                          wrong={p.summary?.lines.find((x) => x.index === l.lineIndex)?.wrong ?? []}
                        />{' '}
                      </Text>
                    ))}
                  </Text>
                  {p.summary && (p.summary.overall || p.summary.focus.length) ? (
                    <Box flexDirection="column" marginTop={1}>
                      <Text color={WARM}>cần chú ý</Text>
                      {p.summary.overall ? <Text>{p.summary.overall}</Text> : null}
                      {p.summary.focus.map((f) => (
                        <Text key={f} color={MUTED}>
                          • {f}
                        </Text>
                      ))}
                    </Box>
                  ) : null}
                  <Box flexDirection="column" marginTop={1}>
                    <Text color={BRAND}>đoạn đúng</Text>
                    <Text bold>{p.lines.map((l) => l.corrected || l.answer).join(' ')}</Text>
                  </Box>
                  {detail ? (
                    <Box flexDirection="column" marginTop={1}>
                      {p.lines.map((l) => (
                        <Box key={l.id} flexDirection="column" marginBottom={1}>
                          <Text>
                            <Text color={scoreColor(l.score)}>
                              {l.meaningOk && l.tenseOk ? '✓' : '✗'} {l.score}/10{' '}
                            </Text>
                            <Text color={MUTED}>
                              {String(l.lineIndex + 1).padStart(2, '0')} {l.vi}
                            </Text>
                          </Text>
                          <Text>
                            {'   '}› {l.answer}
                            <Text color={MUTED}>
                              {'   '}nghĩa {l.meaningOk ? '✓' : '✗'} · {axis} {l.tenseOk ? '✓' : '✗'}
                            </Text>
                          </Text>
                          {l.corrected && norm(l.corrected) !== norm(l.answer) ? (
                            <Text color={BRAND}>{`   → ${l.corrected}`}</Text>
                          ) : null}
                          {l.tenseNote ? <Text color={MUTED}>{`   ⏱ ${l.tenseNote}`}</Text> : null}
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Text color={MUTED}>⏎ xem từng câu ({p.lines.length})</Text>
                  )}
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Keys
        items={[
          ['↑↓', 'chọn bài'],
          ['⏎', 'từng câu'],
          ['r', 'học lại bài này'],
          ['tab', 'lọc'],
          ['←→', 'trang'],
          ['esc', 'về bài đang làm'],
        ]}
      />
    </Box>
  );
}

const patch = <T,>(a: T[], i: number, v: T): T[] => {
  const n = [...a];
  n[i] = v;
  return n;
};
/** Số dòng terminal một đoạn chữ chiếm khi xuống dòng trong bề rộng w (ước lượng). */
const rowsOf = (s: string, w: number) => Math.max(1, Math.ceil(s.length / Math.max(10, w)));

/** Kích thước terminal, cập nhật khi kéo giãn cửa sổ. */
function useTermSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ cols: stdout.columns || 80, rows: stdout.rows || 24 });
  useEffect(() => {
    const on = () => setSize({ cols: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on('resize', on);
    return () => {
      stdout.off('resize', on);
    };
  }, [stdout]);
  return size;
}

/** Chiều cao (ước lượng) của khối nhận xét — để biết đoạn có vừa màn hình không. */
function feedbackRows(fb: Feedback, sample: string, w: number, lean = false): number {
  const right = fb.corrected || sample;
  let n = 1 + rowsOf(fb.comment, w);
  if (fb.tenseNote) n += rowsOf(fb.tenseNote, w);
  if (fb.fixes?.length) n += 1 + fb.fixes.reduce((k, f) => k + rowsOf(`${f.wrong} → ${f.right} · ${f.why}`, w), 0);
  n += 1 + rowsOf(right, w - 2);
  if (lean) return n + 1;
  for (const p of fb.preps ?? []) n += rowsOf(`${p.phrase} · ${p.why}`, w - 2);
  const alts = (fb.natural ?? []).length + (norm(sample) !== norm(right) ? 1 : 0);
  if (alts) n += 2 + alts * rowsOf(right, w - 2);
  if (fb.styleNote) n += 1;
  return n;
}

function Practice({ cfg, kind, onBack }: { cfg: Config; kind: Kind; onBack: () => void }) {
  const { exit } = useApp();
  const api = useRef<Client>(client(cfg, kind.id)).current;
  const [drill, setDrill] = useState<Drill | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [feedbacks, setFeedbacks] = useState<(Feedback | null)[]>([]);
  const [cur, setCur] = useState(0);
  /** Gợi ý 2 tầng: 0 tắt · 1 cấu trúc · 2 thêm từ vựng chính. */
  const [hint, setHint] = useState(0);
  const [vocab, setVocab] = useState<Vocab | 'loading' | { error: string } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [view, setView] = useState<'drill' | 'history' | 'lookup' | 'vien' | 'ipa'>('drill');
  const [frameIdx, setFrameIdx] = useState(() => Math.max(0, FRAMES.findIndex((f) => f.name === cfg.frame)));
  const frame = FRAMES[frameIdx] ?? FRAMES[0]!;
  /** ^K: bảng phím tắt đầy đủ; mặc định chỉ một dòng gợi ý theo tình huống. */
  const [showKeys, setShowKeys] = useState(false);
  /** Câu vừa chấm xong → chạy hiệu ứng đúng/sai; key đổi mỗi lần chấm để chạy lại từ đầu. */
  const [burst, setBurst] = useState<{ i: number; key: number } | null>(null);
  const streak = useRef(0);
  const endBurst = useCallback(() => setBurst(null), []);
  const [busy, setBusy] = useState<string | null>('Đang mở bài…');
  const [error, setError] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [wrapped, setWrapped] = useState(false);
  /** Câu trả lời lúc được chấm — để biết đã sửa lại chưa. */
  const [gradedAs, setGradedAs] = useState<string[]>([]);
  const seen = useRef<string[]>([]);
  const summarized = useRef('');
  /** Câu đang chờ AI chấm (chấm chạy nền, vẫn gõ câu khác được). */
  const [pending, setPending] = useState<boolean[]>([]);
  /** Đề đang mở — kết quả chấm về muộn của đề cũ thì không được ghi đè đề mới. */
  const drillKey = useRef('');
  const inflight = useRef(new Set<Promise<void>>());
  const term = useTermSize();

  const steps = drill ? linesOf(drill) : [];
  const allGraded = steps.length > 0 && feedbacks.every(Boolean);

  const reloadStats = useCallback(() => {
    api.stats().then(setStats).catch(() => {});
  }, [api]);

  const load = useCallback(
    (d: Drill, a?: string[], f?: (Feedback | null)[]) => {
      const n = linesOf(d).length;
      const ans = a?.length === n ? a : Array(n).fill('');
      const fbs = f?.length === n ? f : Array(n).fill(null);
      drillKey.current = linesOf(d)[0]?.vi ?? d.vi;
      setDrill(d);
      setAnswers(ans);
      setFeedbacks(fbs);
      setPending(Array(n).fill(false));
      setGradedAs(ans.map((x, i) => (fbs[i] ? x : '')));
      setSummary(null);
      summarized.current = '';
      setHint(0);
      setVocab(null);
      setReveal(false);
      const first = fbs.findIndex((x) => !x);
      setCur(first < 0 ? 0 : first);
    },
    [],
  );

  const nextDrill = useCallback(async () => {
    setBusy('Đang lấy đề mới…');
    setError('');
    try {
      const d = await api.drill(seen.current.slice(-8));
      if (d.wrapped) setWrapped(true);
      seen.current = [...seen.current, d.vi].slice(-12);
      load(d);
      const n = linesOf(d).length;
      void api
        .saveState({ drill: d, answers: Array(n).fill(''), feedbacks: Array(n).fill(null) })
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [api, load]);

  // Mở lên: làm tiếp bài dở (kể cả bài đang làm trên web), không có thì lấy đề mới.
  useEffect(() => {
    reloadStats();
    api
      .state()
      .then((s) => {
        if (s?.drill?.lines?.length) {
          load(s.drill, s.answers, s.feedbacks);
          setBusy(null);
        } else void nextDrill();
      })
      .catch((e) => {
        setError((e as Error).message);
        setBusy(null);
      });
  }, [api, load, nextDrill, reloadStats]);

  // Gõ dở cũng lưu (hoãn 1s) — mở web lên vẫn thấy chữ đang gõ.
  useEffect(() => {
    if (!drill) return;
    const t = setTimeout(() => {
      void api.saveState({ drill, answers, feedbacks }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [api, drill, answers, feedbacks]);

  // Chấm xong cả đoạn → xin AI tổng kết một lần.
  useEffect(() => {
    if (!drill || !allGraded || steps.length < 2) return;
    const sig = `${steps[0]?.vi}|${answers.join('\u0000')}`;
    if (summarized.current === sig) return;
    summarized.current = sig;
    api
      .summary({
        drillKey: steps[0]?.vi ?? '',
        lines: steps.map((l, i) => ({
          vi: l.vi,
          answer: answers[i] ?? '',
          corrected: feedbacks[i]?.corrected ?? '',
          meaningOk: Boolean(feedbacks[i]?.meaningOk),
          tenseOk: Boolean(feedbacks[i]?.tenseOk),
        })),
      })
      .then(setSummary)
      .catch(() => {
        summarized.current = '';
      });
  }, [api, drill, allGraded, steps, answers, feedbacks]);

  /** Câu chưa làm kế tiếp (bỏ qua câu đang chấm), ưu tiên phía dưới; -1 nếu hết. */
  const nextOpen = (from: number, pend = pending) => {
    const open = (j: number) => j !== from && !feedbacks[j] && !pend[j];
    const down = steps.findIndex((_, j) => j > from && open(j));
    return down >= 0 ? down : steps.findIndex((_, j) => open(j));
  };

  /** Chấm chạy nền: gửi đi rồi chuyển ngay sang câu kế tiếp, không bắt chờ AI. */
  function grade(i: number) {
    const line = steps[i];
    const raw = answers[i] ?? '';
    const answer = raw.trim();
    if (!line || !answer || pending[i]) return;
    const key = drillKey.current;
    const pend = patch(pending, i, true);
    setPending(pend);
    setError('');
    const j = nextOpen(i, pend);
    if (j >= 0) {
      setCur(j);
      setHint(0);
      setReveal(false);
    }
    const job = (async () => {
      try {
        const fb = await api.check(line.vi, answer);
        const same = drillKey.current === key;
        if (same) {
          setFeedbacks((f) => patch(f, i, fb));
          setGradedAs((g) => patch(g, i, raw));
          streak.current = fb.meaningOk && fb.tenseOk ? streak.current + 1 : 0;
          setBurst({ i, key: Date.now() });
        }
        // Lịch sử vẫn ghi dù đã sang đề khác — bài đó đã làm thật.
        await api
          .result({
            drillKey: key || line.vi,
            lineIndex: i,
            vi: line.vi,
            answer,
            score: fb.score,
            meaningOk: fb.meaningOk,
            tenseOk: fb.tenseOk,
            corrected: fb.corrected,
            tenseNote: fb.tenseNote,
          })
          .catch(() => {});
        reloadStats();
      } catch (e) {
        if (drillKey.current === key) setError(`Câu ${i + 1}: ${(e as Error).message}`);
      } finally {
        if (drillKey.current === key) setPending((p) => patch(p, i, false));
      }
    })();
    inflight.current.add(job);
    void job.finally(() => inflight.current.delete(job));
  }

  const move = (d: number) => {
    setCur((c) => Math.max(0, Math.min(steps.length - 1, c + d)));
    setHint(0);
    setReveal(false);
  };

  async function quit(back = false) {
    if (inflight.current.size) {
      setBusy('Đang chờ chấm xong…');
      await Promise.allSettled([...inflight.current]);
    }
    if (drill) await api.saveState({ drill, answers, feedbacks }).catch(() => {});
    back ? onBack() : exit();
  }

  // Học lại một bài từ lịch sử: nạp đúng đề đó, ô trả lời để trống — như web.
  const retry = (d: Drill) => {
    load(d);
    const n = linesOf(d).length;
    void api.saveState({ drill: d, answers: Array(n).fill(''), feedbacks: Array(n).fill(null) }).catch(() => {});
    setView('drill');
  };

  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === 'd')) return void quit();
    if (view !== 'drill') return;
    if (key.ctrl && input === 'l') return setView('history');
    // ^F: popup tra từ — Practice vẫn mounted nên câu đang gõ, kết quả chấm, câu đang chọn giữ nguyên.
    if (key.ctrl && input === 'f') return setView('lookup');
    // ^G: popup tra Việt → Anh (Google + AI) — bài vẫn giữ nguyên như ^F.
    if (key.ctrl && input === 'g') return setView('vien');
    // ^P: popup tra IPA (không AI, không tốn token). ^I không dùng được: terminal gửi giống Tab.
    if (key.ctrl && input === 'p') return setView('ipa');
    if (key.ctrl && input === 'k') return setShowKeys((v) => !v);
    if (key.ctrl && input === 't') {
      const next = (frameIdx + 1) % FRAMES.length;
      setFrameIdx(next);
      savePrefs({ frame: FRAMES[next]?.name });
      return;
    }
    // Esc: đang mở gợi ý / câu mẫu thì đóng; không mở gì thì lưu bài rồi về menu — không bao giờ thoát.
    if (key.escape) {
      if (showKeys) return setShowKeys(false);
      if (hint || reveal) {
        setHint(0);
        setReveal(false);
      } else void quit(true);
      return;
    }
    if (busy) return;
    if (key.ctrl && input === 'n') return void nextDrill();
    if (key.ctrl && input === 'x' && wrapped) {
      setWrapped(false);
      seen.current = [];
      void api.reset().then(reloadStats).then(nextDrill);
      return;
    }
    if (!drill) return;
    if (key.upArrow) return move(-1);
    if (key.downArrow) return move(1);
    if (key.tab) {
      const next = (hint + 1) % 3;
      setHint(next);
      // Tầng 2 lần đầu trong đoạn → xin từ vựng cho cả đoạn một lần (server cache vĩnh viễn).
      if (next === 2 && (vocab === null || (typeof vocab === 'object' && 'error' in vocab))) {
        setVocab('loading');
        api
          .vocab(steps.map((x) => ({ vi: x.vi, answer: x.answer })))
          .then(setVocab)
          .catch((e) => setVocab({ error: (e as Error).message }));
      }
      return;
    }
    if (key.ctrl && input === 'r') return setReveal((r) => !r);
    // Câu đã chấm là chỉ đọc; ^U = viết lại (xoá bài + kết quả câu này, mở lại ô nhập). Lịch sử vẫn giữ.
    if (key.ctrl && input === 'u' && feedbacks[cur] && !pending[cur]) {
      setFeedbacks((f) => patch(f, cur, null));
      setAnswers((a) => patch(a, cur, ''));
      setGradedAs((g) => patch(g, cur, ''));
      setBurst(null);
      setSummary(null);
      summarized.current = '';
      return;
    }
    if (key.return) {
      if (pending[cur]) return;
      if (allGraded) return void nextDrill();
      if (feedbacks[cur]) {
        const j = nextOpen(cur);
        if (j >= 0) {
          setCur(j);
          setHint(0);
          setReveal(false);
        }
        return;
      }
      grade(cur);
    }
  });

  const setAnswer = (v: string) =>
    setAnswers((a) => {
      const next = [...a];
      next[cur] = v;
      return next;
    });

  if (view === 'ipa') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Header stats={stats} kind={kind} />
        <Box borderStyle="round" borderColor={frame.color} paddingX={1} flexDirection="column">
          <IpaView cfg={cfg} onBack={() => setView('drill')} />
        </Box>
      </Box>
    );
  }

  if (view === 'vien') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Header stats={stats} kind={kind} />
        <Box borderStyle="round" borderColor={frame.color} paddingX={1} flexDirection="column">
          <ViEnView cfg={cfg} embedded onBack={() => setView('drill')} />
        </Box>
      </Box>
    );
  }

  if (view === 'lookup') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Header stats={stats} kind={kind} />
        <Box borderStyle="round" borderColor={frame.color} paddingX={1} flexDirection="column">
          <VocabView cfg={cfg} embedded onBack={() => setView('drill')} />
        </Box>
      </Box>
    );
  }

  if (view === 'history') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Header stats={stats} kind={kind} />
        <HistoryView api={api} axis={kind.axis} onRetry={retry} onClose={() => setView('drill')} />
      </Box>
    );
  }

  const done = feedbacks.filter(Boolean).length;
  const right = feedbacks.filter((f) => f?.meaningOk && f?.tenseOk).length;
  const grading = pending.filter(Boolean).length;
  // Một dòng phím theo tình huống — đủ dùng lúc đó; ^K mở bảng đầy đủ.
  const curFb = feedbacks[cur];
  const quickKeys: [string, string][] = [
    ...((hint || reveal
      ? [['esc', 'đóng gợi ý']]
      : allGraded
        ? [
            ['⏎', 'đoạn mới'],
            ['^U', 'viết lại'],
            ['^L', 'lịch sử'],
          ]
        : curFb
          ? [
              ['⏎', 'câu tiếp'],
              ['^U', 'viết lại'],
              ['↑↓', 'đổi câu'],
            ]
          : [
              ['⏎', 'chấm'],
              ['tab', 'gợi ý'],
              ['↑↓', 'đổi câu'],
            ]) as [string, string][]),
    ['^F', 'tra từ'],
    ['^G', 'Việt→Anh'],
    ['^P', 'IPA'],
    ['^K', 'phím tắt'],
  ];

  // ── Khung nhìn: ước lượng chiều cao từng câu; không vừa màn hình thì chỉ hiện các câu
  // quanh câu đang làm, phần còn lại thu thành một dòng "↑ / ↓ n câu".
  // ponytail: ước lượng theo số ký tự (không đo thật) — lệch vài dòng thì còn biên an toàn.
  // trừ viền + lề trong của khung câu
  const W = term.cols - 6;
  const lineRows = (i: number, lean = false) => {
    const l = steps[i];
    const fb = feedbacks[i];
    if (!l) return 0;
    let n = rowsOf(`${l.vi} 10/10`, W - 5);
    if (i !== cur) {
      if (fb) {
        const ans = gradedAs[i] || answers[i] || '';
        n += rowsOf(shownAnswer(fb, ans), W - 6) + rowsOf(fb.corrected || l.answer, W - 6);
        if (burst?.i === i) n += 1;
      } else if (answers[i]) n += rowsOf(answers[i] ?? '', W - 6);
      return n;
    }
    n += 2 + rowsOf(shownAnswer(fb, answers[i] || ' '), W - 6); // 2 = viền trên + dưới của khung câu đang làm
    if (pending[i]) n += 1;
    if (hint) n += rowsOf(`${l.hint} · ${l.patterns?.join(' · ')}`, W - 7) + (hint === 2 ? 6 : 0);
    if (reveal && !fb) n += rowsOf(l.answer, W - 11);
    if (fb) n += burst?.i === i ? 6 : feedbackRows(fb, l.answer, W - 6, lean);
    if (l.reply && (fb || reveal)) n += 1 + rowsOf(l.reply, W - 20) + (l.replyVi ? rowsOf(l.replyVi, W - 20) : 0);
    return n;
  };
  const chrome =
    2 +
    (drill?.context ? rowsOf(drill.context, W - 3) : 0) +
    2 +
    (allGraded ? 4 + (summary ? rowsOf(summary.overall, W - 4) + summary.focus.length : 1) : 0) +
    (wrapped ? 2 : 0) +
    (busy ? 1 : 0) +
    (error ? rowsOf(error, W) : 0) +
    (showKeys ? 11 : 2) +
    2;
  let from = 0;
  let to = steps.length - 1;
  const budget = term.rows - chrome;
  // Câu đang làm một mình đã không vừa → thu gọn khối nhận xét của nó.
  const lean = lineRows(cur) > budget;
  const heights = steps.map((_, i) => (i === cur ? lineRows(i, lean) : lineRows(i)));
  if (heights.reduce((a, b) => a + b, 0) > budget) {
    from = to = Math.min(cur, steps.length - 1);
    let used = heights[from] ?? 0;
    const markers = (a: number, b: number) => (a > 0 ? 1 : 0) + (b < steps.length - 1 ? 1 : 0);
    for (let grow = true; grow; ) {
      grow = false;
      // Ưu tiên hiện câu sắp làm, rồi mới tới câu đã qua.
      for (const [a, b] of [
        [from, to + 1],
        [from - 1, to],
      ] as const) {
        if (a < 0 || b >= steps.length || (a === from && b === to)) continue;
        const add = heights[a === from ? b : a] ?? 0;
        if (used + add + markers(a, b) <= budget) {
          used += add;
          from = a;
          to = b;
          grow = true;
        }
      }
    }
  }
  const tally = (a: number, b: number) => {
    const fbs = feedbacks.slice(a, b);
    const ok = fbs.filter((f) => f?.meaningOk && f?.tenseOk).length;
    const bad = fbs.filter((f) => f && !(f.meaningOk && f.tenseOk)).length;
    return [ok ? `✓${ok}` : '', bad ? `✗${bad}` : ''].filter(Boolean).join(' ');
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header stats={stats} kind={kind} />
      {drill ? (
        <>
          {drill.context ? <Text color={MUTED}>🗣 {drill.context}</Text> : null}
          <Text color={MUTED}>
            Đoạn {steps.length} câu · đã chấm {done}/{steps.length} · đúng {right}
            {grading ? ` · đang chấm ${grading}` : ''}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {from > 0 ? (
              <Text color={MUTED}>
                {`  ↑ ${from} câu trên`}
                {tally(0, from) ? ` (${tally(0, from)})` : ''}
              </Text>
            ) : null}
            {steps.map((l, i) => {
              if (i < from || i > to) return null;
              const fb = feedbacks[i];
              const active = i === cur;
              const mark = fb ? (fb.meaningOk && fb.tenseOk ? '✓' : '✗') : active ? '▸' : '·';
              return (
                // Câu đang làm: khung bo tròn sáng; câu khác: không viền, chữ faint, lùi 2 cột cho thẳng hàng.
                // key đổi theo active: Ink không trả bề dày viền về 0 khi borderBottom true → false
                // (còn giữ chỗ 1 dòng trống), nên dựng lại Box thay vì đổi prop.
                <Box
                  key={`${i}-${l.vi}-${active ? 'on' : 'off'}`}
                  flexDirection="column"
                  borderStyle={active ? 'round' : undefined}
                  borderColor={frame.color}
                  paddingLeft={active ? 1 : 2}
                  paddingRight={active ? 1 : 0}
                >
                  <Hang
                    dim={!active}
                    bold={active}
                    mark={
                      <Text>
                        {pending[i] ? (
                          <Text color={WARM}>
                            <Spinner type="dots" />{' '}
                          </Text>
                        ) : (
                          <Text color={fb ? toneOf(fb) : active ? frame.color : MUTED}>{mark} </Text>
                        )}
                        <Text color={MUTED}>{String(i + 1).padStart(2, '0')} </Text>
                      </Text>
                    }
                  >
                    {l.vi}
                    {!active && fb ? <Text color={toneOf(fb)}> {fb.score}/10</Text> : null}
                    {pending[i] && !active ? <Text color={MUTED}> · đang chấm…</Text> : null}
                  </Hang>
                  {active ? (
                    <>
                      {fb ? (
                        // Đã chấm: chỉ đọc, không con trỏ — hiện luôn câu AI đã đánh dấu lỗi.
                        <AnsweredLine fb={fb} answer={gradedAs[i] || answers[i] || ''} width={W} color={frame.color} />
                      ) : busy || pending[i] ? (
                        <Hang indent={3} color={MUTED} mark={<Text color={frame.color}>› </Text>}>
                          {answers[i]}
                        </Hang>
                      ) : (
                        <Box marginLeft={3}>
                          <Box flexShrink={0}>
                            <Text color={frame.color}>› </Text>
                          </Box>
                          <AnswerInput value={answers[i] ?? ''} onChange={setAnswer} wide={term.cols >= 90} />
                        </Box>
                      )}
                      {pending[i] ? (
                        <Box marginLeft={5}>
                          <Text color={BRAND}>
                            <Spinner type="dots" /> AI đang chấm câu này…
                          </Text>
                        </Box>
                      ) : null}
                      {hint ? (
                        <Box flexDirection="column" marginLeft={3}>
                          <Hang mark={<Text>💡 </Text>} color={WARM}>
                            {l.hint}
                            {l.patterns?.length ? <Text color={MUTED}> · {l.patterns.join(' · ')}</Text> : null}
                          </Hang>
                          {hint === 2 ? <VocabHint vocab={vocab} index={i} /> : null}
                        </Box>
                      ) : null}
                      {reveal && !fb ? (
                        <Hang indent={3} color={BRAND} mark={<Text color={MUTED}>◆ mẫu </Text>}>
                          {l.answer}
                        </Hang>
                      ) : null}
                      {fb && burst?.i === i ? (
                        <Verdict key={burst.key} fb={fb} streak={streak.current} onEnd={endBurst} />
                      ) : fb ? (
                        <FeedbackView fb={fb} sample={l.answer} axis={kind.axis} lean={lean} width={W} />
                      ) : null}
                      {/* Mạch hỏi / ráp câu / be: câu đáp của người kia, như web — hiện khi đã chấm hoặc xem mẫu. */}
                      {l.reply && (fb || reveal) ? (
                        <Box flexDirection="column" marginLeft={3} marginTop={1}>
                          <Text>
                            <Text color={MUTED}>↩ người kia đáp </Text>
                            {l.reply}
                          </Text>
                          {l.replyVi ? <Text color={MUTED}>{`                ${l.replyVi}`}</Text> : null}
                        </Box>
                      ) : null}
                    </>
                  ) : fb ? (
                    <>
                      {burst?.i === i ? (
                        <Verdict key={burst.key} compact fb={fb} streak={streak.current} onEnd={endBurst} />
                      ) : null}
                      <GradedLines dim width={W} answer={gradedAs[i] || answers[i] || ''} fb={fb} sample={l.answer} />
                    </>
                  ) : answers[i] ? (
                    <Hang indent={3} dim color={MUTED} mark={<Text color={MUTED}>› </Text>}>
                      {answers[i]}
                    </Hang>
                  ) : null}
                </Box>
              );
            })}
            {to < steps.length - 1 ? (
              <Text color={MUTED}>
                {`  ↓ ${steps.length - 1 - to} câu dưới`}
                {tally(to + 1, steps.length) ? ` (${tally(to + 1, steps.length)})` : ''}
              </Text>
            ) : null}
          </Box>
          {allGraded ? (
            <Box flexDirection="column" borderStyle="round" borderColor={BRAND} paddingX={1}>
              <Text bold color={BRAND}>
                Xong đoạn · đúng {right}/{steps.length}
              </Text>
              {summary ? (
                <>
                  <Text>{summary.overall}</Text>
                  {summary.focus.map((f) => (
                    <Text key={f} color={WARM}>
                      → {f}
                    </Text>
                  ))}
                </>
              ) : steps.length > 1 ? (
                <Text color={MUTED}>
                  <Spinner type="dots" /> AI đang tổng kết đoạn…
                </Text>
              ) : null}
              <Text color={MUTED}>⏎ sang đoạn mới</Text>
            </Box>
          ) : null}
        </>
      ) : null}
      {wrapped ? (
        <Text color={WARM}>⟳ Đã đi hết kho đề. ^X để luyện lại từ đầu (thống kê về 0, lịch sử vẫn giữ).</Text>
      ) : null}
      {busy ? (
        <Text color={BRAND}>
          <Spinner type="dots" /> {busy}
        </Text>
      ) : null}
      {error ? <Text color={BAD}>✗ {error}</Text> : null}
      {showKeys ? <KeysHelp frame={frame.name} /> : <Keys items={quickKeys} />}
    </Box>
  );
}

export function Login({ apiUrl }: { apiUrl: string }) {
  const { exit } = useApp();
  const [key, setKey] = useState('');
  const [state, setState] = useState<'input' | 'checking' | 'ok'>('input');
  const [error, setError] = useState('');
  const input = useLineEditor(key, setKey, state === 'input', true);
  useInput((ch, k) => {
    if (k.escape || (k.ctrl && ch === 'c')) return exit();
    if (!k.return || state !== 'input' || !key.trim()) return;
    const cfg = { apiUrl, apiKey: key.trim() };
    setState('checking');
    setError('');
    client(cfg)
      .stats()
      .then(() => {
        saveConfig(cfg);
        setState('ok');
        setTimeout(() => exit(), 50);
      })
      .catch((e) => {
        setError((e as Error).message);
        setState('input');
      });
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header stats={null} />
      {state === 'ok' ? (
        <Text color={BRAND}>✓ Đã lưu key. Gõ `veng` để bắt đầu luyện.</Text>
      ) : (
        <>
          <Text>
            Dán <Text bold>CLI_API_KEY</Text> <Text color={MUTED}>({apiUrl})</Text>
          </Text>
          <Box>
            <Text color={WARM}>› </Text>
            {input}
          </Box>
          {state === 'checking' ? (
            <Text color={BRAND}>
              <Spinner type="dots" /> Đang kiểm tra…
            </Text>
          ) : null}
          {error ? <Text color={BAD}>✗ {error}</Text> : null}
        </>
      )}
    </Box>
  );
}
