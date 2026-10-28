import { render } from 'ink';
import { client, clearConfig, CONFIG_PATH, defaultUrl, KINDS, loadConfig } from './api.js';
import { App, Login } from './ui.js';

declare const __VERSION__: string;

const HELP = `veng — luyện dịch Việt → Anh ngay trong terminal, AI chấm
  (thì, bị động, câu hỏi, điều kiện, ráp câu, cụm động từ… — cùng kho đề với web)

  veng            chọn loại rồi luyện (làm tiếp bài dở trên web nếu có)
  veng login      nhập API key một lần, lưu ở ${CONFIG_PATH}
  veng logout     xoá key đã lưu
  veng stats      xem tiến độ từng loại
  veng --version

Biến môi trường: VENG_API_KEY, VENG_API_URL (mặc định ${defaultUrl()})`;

async function main() {
  const cmd = process.argv[2];
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') return console.log(HELP);
  if (cmd === '-v' || cmd === '--version') return console.log(__VERSION__);
  if (cmd === 'logout') {
    clearConfig();
    return console.log('Đã xoá key.');
  }
  if (cmd === 'login') {
    await render(<Login apiUrl={loadConfig()?.apiUrl ?? defaultUrl()} />).waitUntilExit();
    return;
  }
  const cfg = loadConfig();
  if (!cfg) {
    await render(<Login apiUrl={defaultUrl()} />).waitUntilExit();
    if (!loadConfig()) return;
    return main();
  }
  if (cmd === 'stats') {
    const all = await Promise.all(KINDS.map((k) => client(cfg, k.id).stats()));
    const w = Math.max(...KINDS.map((k) => k.label.length));
    KINDS.forEach((k, i) => {
      const s = all[i];
      console.log(
        `${k.label.padEnd(w)}  ${`${s.doneDrills}/${s.totalDrills}`.padStart(7)} đoạn  ` +
          (s.lines
            ? `${String(s.lines).padStart(4)} câu · ⌀ ${s.avg}/10 · tốt ${s.good} · khá ${s.fair} · yếu ${s.weak} · đúng ${k.axis} ${s.tenseOk}/${s.lines}`
            : '   chưa luyện'),
      );
    });
    return;
  }
  if (cmd) {
    console.log(`Không hiểu lệnh "${cmd}".\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY) {
    console.error('veng cần chạy trong terminal tương tác.');
    process.exitCode = 1;
    return;
  }
  await render(<App cfg={cfg} />, { exitOnCtrlC: false }).waitUntilExit();
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
});
