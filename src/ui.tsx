import { Box, Text, Transform, useApp, useInput, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import Spinner from 'ink-spinner';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  type Client,
  type Config,
  client,
  type Drill,
  type Feedback,
  type HistoryPage,
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
  useEffect(() => setCur((c) => Math.min(c, value.length)), [value]);
  // Con trỏ khối nhấp nháy ~530ms như terminal; gõ / di chuyển thì sáng lại và đếm nhịp từ đầu.
  const [on, setOn] = useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: value/cur chỉ để khởi động lại nhịp
  useEffect(() => {
    setOn(true);
    if (!active) return;
    const id = setInterval(() => setOn((o) => !o), 530);
    return () => clearInterval(id);
  }, [value, cur, active]);
  useInput(
    (input, key) => {
      if (key.return || key.tab || key.upArrow || key.downArrow || key.escape) return;
      if (key.leftArrow) return setCur((c) => Math.max(0, c - 1));
      if (key.rightArrow) return setCur((c) => Math.min(value.length, c + 1));
      if (key.backspace || key.delete) {
        if (cur === 0) return;
        onChange(value.slice(0, cur - 1) + value.slice(cur));
        return setCur(cur - 1);
      }
      if (key.ctrl) {
        if (input === 'a') return setCur(0);
        if (input === 'e') return setCur(value.length);
        if (input === 'u') {
          onChange(value.slice(cur));
          return setCur(0);
        }
        if (input === 'w') {
          const start = value.slice(0, cur).replace(/\S+\s*$/, '').length;
          onChange(value.slice(0, start) + value.slice(cur));
          return setCur(start);
        }
        return; // các Ctrl khác là phím tắt của màn hình
      }
      if (key.meta || !input) return;
      const text = input.replace(/[\r\n]+/g, ' ');
      onChange(value.slice(0, cur) + text + value.slice(cur));
      setCur(cur + text.length);
    },
    { isActive: active },
  );
  const shown = mask ? '•'.repeat(value.length) : value;
  return (
    <Text>
      {shown.slice(0, cur)}
      <Text inverse={on}>{shown[cur] ?? ' '}</Text>
      {shown.slice(cur + 1)}
    </Text>
  );
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: bỏ qua mã màu ANSI ở đầu dòng
const LEAD_SPACE = /^((?:\x1b\[[0-9;]*m)*) /;

/** Dòng hai cột: dấu/số cố định bên trái, chữ bên phải — câu dài xuống dòng vẫn thẳng hàng với đầu câu. */
function Hang({
  mark,
  indent = 0,
  trim = true,
  dim = false,
  children,
}: {
  mark: ReactNode;
  indent?: number;
  /** Câu không đang làm: chữ "faint" (terminal không có opacity). */
  dim?: boolean;
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
        <Transform transform={(line, i) => (trim && i > 0 ? line.replace(LEAD_SPACE, '$1') : line)}>
          <Text dimColor={dim}>{children}</Text>
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

function Header({ stats, kind }: { stats: Stats | null; kind?: Kind }) {
  return (
    <Box justifyContent="space-between" marginBottom={1}>
      <Text>
        <Gradient colors={[BRAND, WARM]}>▍veng</Gradient>
        <Text color={MUTED}> · {kind ? kind.label : 'luyện dịch'} · Việt → Anh, AI chấm</Text>
      </Text>
      {stats ? (
        <Text color={MUTED}>
          {stats.doneDrills}/{stats.totalDrills} đoạn · ⌀ <Text color={WARM}>{stats.avg}</Text> · đúng{' '}
          {kind?.axis} {stats.tenseOk}/{stats.lines}
        </Text>
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
}: {
  fb: Feedback;
  sample: string;
  axis: string;
  /** Màn hình thấp: bỏ cách nói khác / giới từ / lưu ý vặt để cả khối vừa màn hình. */
  lean?: boolean;
}) {
  const right = fb.corrected || sample;
  const alts = lean ? [] : [
    ...(norm(sample) !== norm(right) ? [sample] : []),
    ...(fb.natural ?? []),
  ].filter((x, i, arr) => x && norm(x) !== norm(right) && arr.findIndex((y) => norm(y) === norm(x)) === i);
  // Câu đúng nằm ngay dưới câu đã nhập (✓ thẳng cột với ›) để so từng chữ; nhận xét xuống dưới.
  return (
    <Box flexDirection="column" marginLeft={3}>
      <Hang mark={<Text color={BRAND}>✓ </Text>}>
        <Text bold color={BRAND}>
          {right}
        </Text>
      </Hang>
      {(lean ? [] : (fb.preps ?? [])).map((p) => (
        <Hang key={p.phrase} indent={2} mark={<Text color={MUTED}>· </Text>}>
          <Text color={WARM}>{p.phrase}</Text>
          <Text color={MUTED}> · {p.why}</Text>
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
        {fb.fixes?.length ? (
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
function GradedLines({ answer, fb, sample, dim = false }: { answer: string; fb: Feedback; sample: string; dim?: boolean }) {
  const ok = fb.meaningOk && fb.tenseOk;
  const right = fb.corrected || sample;
  const perfect = ok && norm(right) === norm(answer);
  return (
    <>
      <Hang indent={3} dim={dim} mark={<Text color={toneOf(fb)}>{ok ? '✓ ' : '✗ '}</Text>}>
        {answer}
      </Hang>
      {perfect ? null : (
        <Hang indent={3} dim={dim} mark={<Text color={BRAND}>→ </Text>}>
          <Text color={BRAND}>{right}</Text>
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
      ],
    ],
    [
      'Đề',
      [
        ['^N', 'đề khác'],
        ['^L', 'lịch sử'],
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

function AnswerInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return useLineEditor(value, onChange, true);
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
function Splash({ lines, onDone }: { lines: number | null; onDone: () => void }) {
  const [t, setT] = useState(0);
  // Mỗi ô một độ trễ ngẫu nhiên — chữ hiện lấm tấm chứ không thẳng tắp.
  const jitter = useRef(LOGO.map((row) => [...row].map(() => Math.random() * 260))).current;
  const quote = useRef(QUOTES[Math.floor(Math.random() * QUOTES.length)] as string).current;
  const { exit } = useApp();
  const start = useRef(Date.now());
  // Dải màu cứ trôi trong lúc chờ Enter cho màn hình "sống".
  useEffect(() => {
    const id = setInterval(() => setT(Date.now() - start.current), 40);
    return () => clearInterval(id);
  }, []);
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === 'd')) return exit();
    if (key.return) return onDone();
    start.current = Math.min(start.current, Date.now() - SPLASH_MS);
  });
  const ready = t >= SPLASH_MS;

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
      <Box marginTop={1}>
        {ready ? (
          <Text color={Math.floor(t / 600) % 2 ? MUTED : WARM}>⏎ Enter để bắt đầu</Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
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
  const [splash, setSplash] = useState(true);
  const endSplash = useCallback(() => setSplash(false), []);
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
    { isActive: !kind && !splash },
  );
  if (splash) {
    const total = Object.values(progress).reduce((n, st) => n + st.lines, 0);
    return <Splash lines={total || null} onDone={endSplash} />;
  }
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
          ['^C', 'thoát'],
        ]}
      />
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
  const [view, setView] = useState<'drill' | 'history'>('drill');
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
    if (key.return) {
      if (pending[cur]) return;
      if (allGraded && !answerChanged(cur)) return void nextDrill();
      if (feedbacks[cur] && !answerChanged(cur)) {
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

  // Đã chấm mà sửa câu thì Enter chấm lại; chưa sửa thì Enter đi tiếp.
  const answerChanged = (i: number) => feedbacks[i] != null && gradedAs[i] !== answers[i];

  const setAnswer = (v: string) =>
    setAnswers((a) => {
      const next = [...a];
      next[cur] = v;
      return next;
    });

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
      : allGraded && !answerChanged(cur)
        ? [
            ['⏎', 'đoạn mới'],
            ['^L', 'lịch sử'],
          ]
        : curFb && !answerChanged(cur)
          ? [
              ['⏎', 'câu tiếp'],
              ['↑↓', 'đổi câu'],
            ]
          : [
              ['⏎', curFb ? 'chấm lại' : 'chấm'],
              ['tab', 'gợi ý'],
              ['↑↓', 'đổi câu'],
            ]) as [string, string][]),
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
        n += rowsOf(ans, W - 6) + rowsOf(fb.corrected || l.answer, W - 6);
        if (burst?.i === i) n += 1;
      } else if (answers[i]) n += rowsOf(answers[i] ?? '', W - 6);
      return n;
    }
    n += 2 + rowsOf(answers[i] || ' ', W - 6); // 2 = viền trên + dưới của khung câu đang làm
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
                // Câu đang làm: khung bo tròn sáng; câu khác: chỉ vạch mờ bên trái, chữ faint.
                // key đổi theo active: Ink không trả bề dày viền về 0 khi borderBottom true → false
                // (còn giữ chỗ 1 dòng trống), nên dựng lại Box thay vì đổi prop.
                <Box
                  key={`${i}-${l.vi}-${active ? 'on' : 'off'}`}
                  flexDirection="column"
                  borderStyle={active ? 'round' : 'single'}
                  borderColor={active ? frame.color : FAINT}
                  borderTop={active}
                  borderRight={active}
                  borderBottom={active}
                  paddingLeft={1}
                  paddingRight={active ? 1 : 0}
                >
                  <Hang
                    dim={!active}
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
                    <Text bold={active}>{l.vi}</Text>
                    {!active && fb ? <Text color={toneOf(fb)}> {fb.score}/10</Text> : null}
                    {pending[i] && !active ? <Text color={MUTED}> · đang chấm…</Text> : null}
                  </Hang>
                  {active ? (
                    <>
                      <Hang indent={3} trim={false} mark={<Text color={frame.color}>› </Text>}>
                        {busy ? answers[i] : <AnswerInput value={answers[i] ?? ''} onChange={setAnswer} />}
                      </Hang>
                      {pending[i] ? (
                        <Box marginLeft={5}>
                          <Text color={BRAND}>
                            <Spinner type="dots" /> AI đang chấm câu này…
                          </Text>
                        </Box>
                      ) : null}
                      {hint ? (
                        <Box flexDirection="column" marginLeft={3}>
                          <Hang mark={<Text>💡 </Text>}>
                            <Text color={WARM}>{l.hint}</Text>
                            {l.patterns?.length ? <Text color={MUTED}> · {l.patterns.join(' · ')}</Text> : null}
                          </Hang>
                          {hint === 2 ? <VocabHint vocab={vocab} index={i} /> : null}
                        </Box>
                      ) : null}
                      {reveal && !fb ? (
                        <Hang indent={3} mark={<Text color={MUTED}>◆ mẫu </Text>}>
                          <Text color={BRAND}>{l.answer}</Text>
                        </Hang>
                      ) : null}
                      {fb && burst?.i === i ? (
                        <Verdict key={burst.key} fb={fb} streak={streak.current} onEnd={endBurst} />
                      ) : fb ? (
                        <FeedbackView fb={fb} sample={l.answer} axis={kind.axis} lean={lean} />
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
                      <GradedLines dim answer={gradedAs[i] || answers[i] || ''} fb={fb} sample={l.answer} />
                    </>
                  ) : answers[i] ? (
                    <Hang indent={3} dim mark={<Text color={MUTED}>› </Text>}>
                      <Text color={MUTED}>{answers[i]}</Text>
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
          <Text>
            <Text color={WARM}>› </Text>
            {input}
          </Text>
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
