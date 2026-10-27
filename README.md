# veng

Luyện **thì tiếng Anh** ngay trong terminal: dịch Việt → Anh từng câu, AI chấm nghĩa và thì.
Chạy được trên Ghostty, iTerm2, Terminal.app, WezTerm, Windows Terminal, tmux…

Dùng chung dữ liệu với trang web **English Reflex** (`/tenses?panel=practice`): cùng kho đề, cùng tiến độ
và lịch sử. Làm dở trên web, mở `veng` là làm tiếp (và ngược lại).

## Cài

```bash
brew tap nmvuong92/veng https://github.com/nmvuong92/veng
brew trust nmvuong92/veng     # Homebrew mới bắt xác nhận tap bên ngoài
brew install veng
veng login        # dán CLI_API_KEY một lần, lưu ở ~/.config/veng/config.json (chmod 600)
veng
```

Cập nhật: `brew upgrade veng`.

## Lệnh

| Lệnh | |
|---|---|
| `veng` | luyện tập |
| `veng login` / `veng logout` | lưu / xoá key |
| `veng stats` | xem tiến độ |

Biến môi trường (ghi đè file cấu hình): `VENG_API_KEY`, `VENG_API_URL`.

## Phím

| Phím | |
|---|---|
| `⏎` | chấm câu · đã chấm thì sang câu chưa làm · xong đoạn thì sang đoạn mới |
| `↑` `↓` | đổi câu |
| `Tab` | gợi ý: lần 1 cấu trúc · lần 2 thêm từ vựng · lần 3 tắt |
| `Ctrl+R` | xem câu mẫu |
| `Ctrl+N` | đề khác |
| `Esc` | đóng gợi ý / câu mẫu |
| `Ctrl+C` | lưu bài dở rồi thoát |
| `Ctrl+A/E/U/W` | sửa dòng như shell |

## Phát triển

```bash
npm i
VENG_API_URL=http://localhost:5174/api VENG_API_KEY=... npm run dev
npm run build        # → dist/veng.mjs (một file, đã gói hết thư viện)
```

Ra bản mới: `git tag v0.2.0 && git push --tags` → Action tự build, tạo Release, cập nhật `Formula/veng.rb`.

`CLI_API_KEY` chỉ gọi được `/api/drills/*` của server — lộ thì đổi key ở GitHub Environment
`production` của repo server rồi deploy lại.
