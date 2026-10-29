# veng

Luyện dịch **Việt → Anh** ngay trong terminal, AI chấm từng câu. Có 14 loại: các thì, bị động, đặt câu hỏi,
câu điều kiện, ráp câu, mốc thời gian, công thức câu, be / being, 32 engine, cụm động từ, collocation,
tính từ mô tả, động từ trái nghĩa, báo cáo tháng.
Chạy được trên Ghostty, iTerm2, Terminal.app, WezTerm, Windows Terminal, tmux…

Dùng chung dữ liệu với trang web **English Reflex** (phần Luyện của từng trang): cùng kho đề,
cùng tiến độ và lịch sử. Làm dở trên web, mở `veng` là làm tiếp (và ngược lại).

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
| `veng` | chọn loại (nhớ loại lần trước) rồi luyện |
| `veng login` / `veng logout` | lưu / xoá key |
| `veng stats` | tiến độ từng loại |

Biến môi trường (ghi đè file cấu hình): `VENG_API_KEY`, `VENG_API_URL`.

## Phím

| Phím | |
|---|---|
| `⏎` | chấm câu · đã chấm thì sang câu chưa làm · xong đoạn thì sang đoạn mới |
| `↑` `↓` | đổi câu |
| `Tab` | gợi ý: lần 1 cấu trúc · lần 2 thêm từ vựng · lần 3 tắt |
| `Ctrl+R` | xem câu mẫu |
| `Ctrl+N` | đề khác |
| `Ctrl+U` | trên câu đã chấm: viết lại (câu đã chấm là chỉ đọc) |
| `Ctrl+T` | đổi màu khung câu đang làm (vàng · ngọc · tím · xanh · hồng · bạc), nhớ cho lần sau |
| `Ctrl+F` | popup tra từ (IPA, nghĩa, thêm bằng AI) — bài đang làm giữ nguyên; `Ctrl+F`/`Esc` để đóng |
| `Ctrl+G` | popup tra Việt → Anh: Google Translate + AI (cách nói, mức độ thông dụng) + từ trong kho; bài giữ nguyên |
| `Ctrl+L` | lịch sử: `↑↓` chọn bài · `⏎` xem từng câu · `r` học lại · `Tab` cần cải thiện / tất cả · `←→` trang · `Esc` quay lại |
| `Esc` | đóng gợi ý / câu mẫu · không mở gì thì lưu bài, về menu |
| `Ctrl+C` | lưu bài dở rồi thoát |
| `Ctrl+A/E/U/W` | sửa dòng như shell |

Ở menu: `↑↓` + `⏎`, hoặc bấm `1`–`9`, `a`–`e` để nhảy con trỏ tới mục đó, rồi `⏎` để vào.

## Phát triển

```bash
npm i
VENG_API_URL=http://localhost:5174/api VENG_API_KEY=... npm run dev
npm run build        # → dist/veng.mjs (một file, đã gói hết thư viện)
```

Ra bản mới: `git tag v0.2.0 && git push --tags` → Action tự build, tạo Release, cập nhật `Formula/veng.rb`.

`CLI_API_KEY` chỉ gọi được `/api/drills/*` của server — lộ thì đổi key ở GitHub Environment
`production` của repo server rồi deploy lại.
