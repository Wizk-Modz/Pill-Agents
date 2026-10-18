# PillAgents

Coding agent chạy trong terminal, hoạt động với mọi endpoint tương thích OpenAI (OpenAI, DeepSeek, Groq, OpenRouter, proxy nội bộ…), dùng SDK chính thức `openai`.

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [Cấu hình](docs/configuration.md) | settings.json, biến môi trường, PILL.md, provider khác |
| [Tool](docs/tools.md) | 6 tool, tham số, giới hạn, cách thêm tool mới |
| [Kiến trúc](docs/architecture.md) | Luồng dữ liệu, quyết định thiết kế, quản lý state |
| [Phát triển](docs/development.md) | Build, test, kiểm thử TUI, quy ước code |

## Cài đặt

```bash
npm install
npm run build
```

```bash
mkdir -p ~/.pill
cp settings.example.json ~/.pill/settings.json   # rồi điền API key
```

## Chạy

```bash
npm start
# hoặc cài global
npm link && pill
```

Biến môi trường chính: `PILL_API_KEY` (bắt buộc), `PILL_BASE_URL`, `PILL_MODEL`, `PILL_MAX_STEPS`, `PILL_CONFIG_DIR`. Chi tiết và ví dụ với provider khác: [docs/configuration.md](docs/configuration.md).

## PILL.md — hướng dẫn cho agent

Tương tự `CLAUDE.md`, agent tự nạp `~/.pill/PILL.md` (mọi dự án) và `PILL.md` ở thư mục dự án cùng các thư mục cha (riêng dự án), chèn vào system prompt.

```markdown
# Quy tắc dự án

- Dùng pnpm, không dùng npm.
- Chạy `pnpm test` trước khi báo hoàn thành.
- Trả lời bằng tiếng Việt.
```

Chi tiết: [docs/configuration.md](docs/configuration.md#pillmd).

## Phím tắt

| Phím | Tác dụng |
|---|---|
| `Enter` | Gửi tin nhắn |
| `\` + `Enter` / `Shift+Enter` / `Ctrl+J` | Xuống dòng trong prompt |
| `↑` / `↓` | Lịch sử lệnh (hoặc di chuyển giữa các dòng khi soạn nhiều dòng) |
| `Shift+↑` / `Shift+↓` | Cuộn nội dung 3 dòng |
| `PageUp` / `PageDown` | Cuộn theo trang |
| Lăn chuột | Cuộn 3 dòng |
| `Ctrl+P` / `Ctrl+N` | Lịch sử lệnh |
| `Ctrl+A` / `Ctrl+E` | Về đầu / cuối dòng |
| `Ctrl+U` / `Ctrl+K` | Xoá từ đầu / đến cuối dòng |
| `Ctrl+O` | Mở/đóng khối thinking đã thu gọn |
| `Esc` | Huỷ lượt đang chạy |
| `Ctrl+C` | Xoá input / thoát |
| `Ctrl+D` | Thoát |

Gõ tin nhắn trong lúc agent đang chạy sẽ **xếp hàng**, tự động chạy sau khi lượt hiện tại xong.
Model có hỗ trợ `reasoning_content` sẽ hiển thị khối **✻ Thinking**.

Footer hiển thị token đã dùng trong phiên: `↑` là prompt, `↓` là completion. `/clear` đặt lại về 0.

Lệnh: `/clear`, `/model <tên>`, `/help`, `/exit`.

## Tool

| Tool | Cần duyệt | Mô tả |
|---|---|---|
| `read_file` | Không | Đọc file kèm số dòng |
| `write_file` | Có | Ghi đè file, tạo thư mục cha |
| `edit_file` | Có | Thay chuỗi chính xác |
| `bash` | Có | Chạy lệnh shell |
| `grep` | Không | Tìm theo regex (ripgrep, fallback Node) |
| `glob` | Không | Liệt kê file theo pattern |

Phiên được lưu tại `~/.pill/sessions/`.

## Test

```bash
npm test
```

`test/mock-server.mjs` là mock API dùng để kiểm thử TUI không cần key thật.

## Ghi chú kỹ thuật

Gọi model qua SDK `openai` (retry 2 lần, backoff; `AbortSignal` để huỷ lượt). Hỗ trợ `reasoning_content` của DeepSeek/OpenRouter và proxy bỏ qua `stream: true`.

Chi tiết: [docs/architecture.md](docs/architecture.md).
