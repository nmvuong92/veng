import { render } from 'ink';
import { client, clearConfig, CONFIG_PATH, defaultUrl, loadConfig } from './api.js';
import { Login, Practice } from './ui.js';

declare const __VERSION__: string;

const HELP = `veng — luyện thì tiếng Anh ngay trong terminal (dịch Việt → Anh, AI chấm)

  veng            luyện tập (làm tiếp bài dở trên web nếu có)
  veng login      nhập API key một lần, lưu ở ${CONFIG_PATH}
  veng logout     xoá key đã lưu
  veng stats      xem tiến độ
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
    const s = await client(cfg).stats();
    console.log(
      `Vòng ${s.cycle} · ${s.doneDrills}/${s.totalDrills} đoạn · ${s.lines} câu đã chấm · ⌀ ${s.avg}/10\n` +
        `Tốt ≥8: ${s.good} · Khá 6–7: ${s.fair} · Cần luyện lại <6: ${s.weak} · đúng thì ${s.tenseOk}/${s.lines}`,
    );
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
  await render(<Practice cfg={cfg} />, { exitOnCtrlC: false }).waitUntilExit();
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
});
