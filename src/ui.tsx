import { Box, Text, useApp, useInput } from 'ink';
import Gradient from 'ink-gradient';
import Spinner from 'ink-spinner';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Client,
  type Config,
  client,
  type Drill,
  type Feedback,
  KINDS,
  type Kind,
  linesOf,
  type Stats,
  type Summary,
  type Vocab,
  saveConfig,
  saveLastKind,
} from './api.js';

const BRAND = '#3fa796';
const WARM = '#d6a23a';
const BAD = '#e0645c';

/** Ô nhập một dòng, phím kiểu readline. Tự viết vì ink-text-input nuốt Ctrl+chữ thành ký tự. */
function useLineEditor(value: string, onChange: (v: string) => void, active: boolean, mask = false) {
  const [cur, setCur] = useState(value.length);
  useEffect(() => setCur((c) => Math.min(c, value.length)), [value]);
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
      <Text inverse>{shown[cur] ?? ' '}</Text>
      {shown.slice(cur + 1)}
    </Text>
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
      <Text color="gray">{'○'.repeat(10 - n)}</Text>
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
        <Text color="gray"> · {kind ? kind.label : 'luyện dịch'} · Việt → Anh, AI chấm</Text>
      </Text>
      {stats ? (
        <Text color="gray">
          {stats.doneDrills}/{stats.totalDrills} đoạn · ⌀ <Text color={WARM}>{stats.avg}</Text> · đúng{' '}
          {kind?.axis} {stats.tenseOk}/{stats.lines}
        </Text>
      ) : null}
    </Box>
  );
}

/** Khối chấm: thanh dọc màu theo kết quả, gọn một cột — điểm, nhận xét, sửa lỗi, câu đúng, cách nói khác. */
function FeedbackView({ fb, sample, axis }: { fb: Feedback; sample: string; axis: string }) {
  const right = fb.corrected || sample;
  const alts = [
    ...(norm(sample) !== norm(right) ? [sample] : []),
    ...(fb.natural ?? []),
  ].filter((x, i, arr) => x && norm(x) !== norm(right) && arr.findIndex((y) => norm(y) === norm(x)) === i);
  return (
    <Box
      flexDirection="column"
      marginLeft={4}
      paddingLeft={1}
      borderStyle="bold"
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderColor={toneOf(fb)}
    >
      <Text>
        <ScoreDots fb={fb} />
        {'   '}
        <Check ok={fb.meaningOk} label="nghĩa" />
        {'   '}
        <Check ok={fb.tenseOk} label={axis} />
      </Text>
      <Text color="gray">{fb.comment}</Text>
      {fb.tenseNote ? <Text color="gray">⏱ {fb.tenseNote}</Text> : null}
      {fb.fixes?.length ? (
        <Box flexDirection="column" marginTop={1}>
          {fb.fixes.map((f) => (
            <Text key={`${f.wrong}→${f.right}`}>
              <Text color={BAD} strikethrough>
                {f.wrong}
              </Text>
              <Text color="gray"> → </Text>
              <Text color={BRAND}>{f.right}</Text>
              {f.why ? <Text color="gray"> · {f.why}</Text> : null}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text color={BRAND}>✓ </Text>
          <Text bold>{right}</Text>
        </Text>
        {fb.preps?.map((p) => (
          <Text key={p.phrase}>
            <Text color={WARM}>  {p.phrase}</Text>
            <Text color="gray"> · {p.why}</Text>
          </Text>
        ))}
        {alts.length ? (
          <>
            <Text color="gray">cách nói khác</Text>
            {alts.map((x) => (
              <Text key={x}>
                <Text color={WARM}>≈ </Text>
                {x}
              </Text>
            ))}
          </>
        ) : null}
      </Box>
      {fb.styleNote ? <Text color="gray">· {fb.styleNote}</Text> : null}
    </Box>
  );
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();

/** Câu đã chấm (khi không đang làm): dòng 1 câu mình viết + ✓/✗, dòng 2 câu đúng — đúng hẳn thì bỏ. */
function GradedLines({ answer, fb, sample }: { answer: string; fb: Feedback; sample: string }) {
  const ok = fb.meaningOk && fb.tenseOk;
  const right = fb.corrected || sample;
  const perfect = ok && norm(right) === norm(answer);
  return (
    <>
      <Text>
        <Text color={toneOf(fb)}>{`    ${ok ? '✓' : '✗'} `}</Text>
        <Text color="gray">{answer}</Text>
      </Text>
      {perfect ? null : (
        <Text>
          <Text color={BRAND}>{'    → '}</Text>
          <Text color={BRAND}>{right}</Text>
        </Text>
      )}
    </>
  );
}

function VocabHint({ vocab, index }: { vocab: Vocab | 'loading' | { error: string } | null; index: number }) {
  if (vocab === 'loading' || vocab === null)
    return (
      <Text color="gray">
        <Spinner type="dots" /> đang lấy từ vựng…
      </Text>
    );
  if ('error' in vocab) return <Text color={BAD}>✗ {vocab.error}</Text>;
  const words = vocab.lines.find((l) => l.index === index)?.words ?? [];
  if (!words.length) return <Text color="gray">📖 câu này không có từ nào đáng chú ý</Text>;
  const w = Math.max(...words.map((x) => x.vi.length));
  return (
    <Box flexDirection="column">
      <Text color="gray">📖 từ vựng</Text>
      {words.map((x) => (
        <Text key={`${x.vi}-${x.en}`}>
          {'   '}
          {x.vi.padEnd(w)}
          <Text color="gray"> → </Text>
          <Text color={BRAND} bold>
            {x.en}
          </Text>
          <Text color="gray"> {x.pos}</Text>
        </Text>
      ))}
    </Box>
  );
}

function Keys({ items }: { items: [string, string][] }) {
  return (
    <Box marginTop={1} flexWrap="wrap">
      {items.map(([k, label]) => (
        <Text key={k}>
          <Text color={WARM}>{k}</Text>
          <Text color="gray"> {label}   </Text>
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
const SPLASH_MS = 2600;

/**
 * Màn chào ~2s: chữ VENG "giải mã" từ nhiễu quét trái → phải, dải màu lướt qua,
 * khẩu hiệu tự gõ. Bấm phím bất kỳ để bỏ qua.
 */
function Splash({ lines, onDone }: { lines: number | null; onDone: () => void }) {
  const [t, setT] = useState(0);
  // Mỗi ô một độ trễ ngẫu nhiên — chữ hiện lấm tấm chứ không thẳng tắp.
  const jitter = useRef(LOGO.map((row) => [...row].map(() => Math.random() * 260))).current;
  const quote = useRef(QUOTES[Math.floor(Math.random() * QUOTES.length)] as string).current;
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const el = Date.now() - start;
      setT(el);
      if (el >= SPLASH_MS) {
        clearInterval(id);
        onDone();
      }
    }, 40);
    return () => clearInterval(id);
  }, [onDone]);
  useInput(() => onDone());

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
        <Text color="gray">{typed('▍ phản xạ Việt → Anh · ngay trong terminal', 650)}</Text>
        <Text bold color={WARM}>
          {typed(`“${quote}”`, 900)}
        </Text>
        {lines ? (
          <Text color="gray">{typed(`  ${lines} câu đã luyện — tiếp nào.`, 1300)}</Text>
        ) : null}
      </Box>
    </Box>
  );
}

/** Phím chọn nhanh ở menu: 1–9 rồi a–z. */
const HOTKEYS = '123456789abcdefghijklmnopqrstuvwxyz';
const LABEL_W = Math.max(...KINDS.map((k) => k.label.length)) + 2;

/** Một dòng tiến độ ở menu: thanh đoạn đã làm / kho đề · số đoạn · điểm TB. */
function KindProgress({ st }: { st?: Stats }) {
  if (!st) return <Text color="gray">…</Text>;
  const W = 12;
  const n = st.doneDrills ? Math.max(1, Math.round((st.doneDrills / Math.max(1, st.totalDrills)) * W)) : 0;
  return (
    <Text>
      <Text color={BRAND}>{'━'.repeat(n)}</Text>
      <Text color="gray">{'─'.repeat(W - n)}</Text>
      <Text color="gray">{` ${`${st.doneDrills}/${st.totalDrills}`.padStart(7)}`}</Text>
      {st.lines ? (
        <Text>
          {'  ⌀ '}
          <Text color={st.avg >= 8 ? BRAND : st.avg >= 6 ? WARM : BAD}>{st.avg}</Text>
          <Text color="gray"> · {st.lines} câu</Text>
        </Text>
      ) : (
        <Text color="gray">  chưa luyện</Text>
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
      <Text color="gray">Luyện gì hôm nay?</Text>
      <Box flexDirection="column" marginY={1}>
        {KINDS.map((k, i) => (
          <Text key={k.id}>
            <Text color={i === cur ? WARM : undefined} bold={i === cur}>
              {i === cur ? ' ▸ ' : '   '}
            </Text>
            <Text color="gray">{HOTKEYS[i]} </Text>
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
  const [busy, setBusy] = useState<string | null>('Đang mở bài…');
  const [error, setError] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [wrapped, setWrapped] = useState(false);
  /** Câu trả lời lúc được chấm — để biết đã sửa lại chưa. */
  const [gradedAs, setGradedAs] = useState<string[]>([]);
  const seen = useRef<string[]>([]);
  const summarized = useRef('');

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
      setDrill(d);
      setAnswers(ans);
      setFeedbacks(fbs);
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

  async function grade(i: number) {
    const line = steps[i];
    const answer = answers[i]?.trim();
    if (!line || !answer || busy) return;
    setBusy('AI đang chấm…');
    setError('');
    try {
      const fb = await api.check(line.vi, answer);
      const next = [...feedbacks];
      next[i] = fb;
      setFeedbacks(next);
      setGradedAs((g) => {
        const n = [...g];
        n[i] = answers[i] ?? '';
        return n;
      });
      await api
        .result({
          drillKey: steps[0]?.vi ?? line.vi,
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
      if (drill) void api.saveState({ drill, answers, feedbacks: next }).catch(() => {});
      reloadStats();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const move = (d: number) => {
    setCur((c) => Math.max(0, Math.min(steps.length - 1, c + d)));
    setHint(0);
    setReveal(false);
  };

  async function quit(back = false) {
    if (drill) await api.saveState({ drill, answers, feedbacks }).catch(() => {});
    back ? onBack() : exit();
  }

  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === 'd')) return void quit();
    // Esc: đang mở gợi ý / câu mẫu thì đóng; không mở gì thì lưu bài rồi về menu — không bao giờ thoát.
    if (key.escape) {
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
      if (allGraded && !answerChanged(cur)) return void nextDrill();
      if (feedbacks[cur] && !answerChanged(cur)) {
        const n = feedbacks.findIndex((f, i) => !f && i > cur);
        const any = n < 0 ? feedbacks.findIndex((f) => !f) : n;
        if (any >= 0) {
          setCur(any);
          setHint(0);
          setReveal(false);
        }
        return;
      }
      void grade(cur);
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

  const done = feedbacks.filter(Boolean).length;
  const right = feedbacks.filter((f) => f?.meaningOk && f?.tenseOk).length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header stats={stats} kind={kind} />
      {drill ? (
        <>
          {drill.context ? <Text color="gray">🗣 {drill.context}</Text> : null}
          <Text color="gray">
            Đoạn {steps.length} câu · đã chấm {done}/{steps.length} · đúng {right}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {steps.map((l, i) => {
              const fb = feedbacks[i];
              const active = i === cur;
              const mark = fb ? (fb.meaningOk && fb.tenseOk ? '✓' : '✗') : active ? '▸' : '·';
              return (
                <Box key={`${i}-${l.vi}`} flexDirection="column" marginBottom={active ? 1 : 0}>
                  <Text>
                    <Text color={fb ? toneOf(fb) : active ? WARM : 'gray'}>{mark} </Text>
                    <Text color="gray">{String(i + 1).padStart(2, '0')} </Text>
                    <Text bold={active} dimColor={!active && !fb}>
                      {l.vi}
                    </Text>
                    {!active && fb ? <Text color={toneOf(fb)}> {fb.score}/10</Text> : null}
                  </Text>
                  {active ? (
                    <>
                      <Text>
                        <Text color={WARM}>{'    › '}</Text>
                        {busy ? <Text>{answers[i]}</Text> : <AnswerInput value={answers[i] ?? ''} onChange={setAnswer} />}
                      </Text>
                      {hint ? (
                        <Box flexDirection="column" marginLeft={4}>
                          <Text color={WARM}>
                            💡 {l.hint}
                            {l.patterns?.length ? <Text color="gray"> · {l.patterns.join(' · ')}</Text> : null}
                          </Text>
                          {hint === 2 ? <VocabHint vocab={vocab} index={i} /> : null}
                        </Box>
                      ) : null}
                      {reveal && !fb ? (
                        <Box marginLeft={4}>
                          <Text>
                            <Text color="gray">◆ mẫu </Text>
                            <Text color={BRAND}>{l.answer}</Text>
                          </Text>
                        </Box>
                      ) : null}
                      {fb ? <FeedbackView fb={fb} sample={l.answer} axis={kind.axis} /> : null}
                      {/* Mạch hỏi / ráp câu / be: câu đáp của người kia, như web — hiện khi đã chấm hoặc xem mẫu. */}
                      {l.reply && (fb || reveal) ? (
                        <Box flexDirection="column" marginLeft={4} marginTop={1}>
                          <Text>
                            <Text color="gray">↩ người kia đáp </Text>
                            {l.reply}
                          </Text>
                          {l.replyVi ? <Text color="gray">{`                ${l.replyVi}`}</Text> : null}
                        </Box>
                      ) : null}
                    </>
                  ) : fb ? (
                    <GradedLines answer={gradedAs[i] || answers[i] || ''} fb={fb} sample={l.answer} />
                  ) : answers[i] ? (
                    <Text color="gray">{`    › ${answers[i]}`}</Text>
                  ) : null}
                </Box>
              );
            })}
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
                <Text color="gray">
                  <Spinner type="dots" /> AI đang tổng kết đoạn…
                </Text>
              ) : null}
              <Text color="gray">⏎ sang đoạn mới</Text>
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
      <Keys
        items={[
          ['⏎', 'chấm / câu tiếp'],
          ['↑↓', 'đổi câu'],
          ['tab', 'gợi ý ×2'],
          ['^R', 'xem mẫu'],
          ['^N', 'đề khác'],
          ['esc', 'đóng gợi ý / menu'],
          ['^C', 'lưu & thoát'],
        ]}
      />
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
            Dán <Text bold>CLI_API_KEY</Text> <Text color="gray">({apiUrl})</Text>
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
