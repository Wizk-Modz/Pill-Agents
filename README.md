# PillAgents

Coding agent chạy trong terminal, hoạt động với mọi endpoint tương thích OpenAI (OpenAI, DeepSeek, Groq, OpenRouter, proxy nội bộ…), dùng SDK chính thức `openai`.

## Cài đặt

```bash
npm install
npm run build
```

Cấu hình theo một trong hai cách:

**1. `settings.json` trong thư mục cấu hình** (khuyến nghị):

```bash
mkdir -p ~/.pill
cp settings.example.json ~/.pill/settings.json   # rồi điền key
```

Thư mục cấu hình tự xác định theo hệ điều hành: `~/.pill` trên Linux/macOS/Termux, `%USERPROFILE%\.pill` trên Windows. Ghi đè bằng biến `PILL_CONFIG_DIR`.

**2. File `.env`** ở thư mục dự án (dùng `--env-file-if-exists` khi chạy `npm start`).

## Chạy

```bash
npm start
# hoặc cài global
npm link && pill
```

Biến môi trường (đặt trong `env` của `settings.json` hoặc biến môi trường thật; biến môi trường được ưu tiên):

| Biến | Mặc định | Mô tả |
|---|---|---|
| `PILL_API_KEY` | — | API key (bắt buộc), fallback `OPENAI_API_KEY` |
| `PILL_BASE_URL` | `https://api.openai.com/v1` | Endpoint proxy |
| `PILL_MODEL` | `gpt-4o-mini` | Model |
| `PILL_MAX_STEPS` | `25` | Số bước tool tối đa mỗi lượt |
| `PILL_CONFIG_DIR` | `~/.pill` | Ghi đè thư mục cấu hình |

## PILL.md — hướng dẫn cho agent

Tương tự `CLAUDE.md`, agent tự động nạp file `PILL.md` và chèn vào system prompt:

| Vị trí | Phạm vi |
|---|---|
| `~/.pill/PILL.md` | Mọi dự án (hướng dẫn chung của bạn) |
| `PILL.md` ở thư mục dự án và các thư mục cha | Riêng dự án đó |

File ở thư mục gần thư mục làm việc nhất được nạp sau cùng. File rỗng bị bỏ qua. Nội dung được chèn kèm chỉ thị ưu tiên cao hơn hành vi mặc định.

Ví dụ `PILL.md` của dự án:

```markdown
# Quy tắc dự án

- Dùng pnpm, không dùng npm.
- Chạy `pnpm test` trước khi báo hoàn thành.
- Trả lời bằng tiếng Việt.
```

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

Gọi model qua SDK `openai` với `baseURL` trỏ tới endpoint cấu hình. SDK tự xử lý retry (2 lần, backoff) và timeout; `AbortSignal` được truyền vào để huỷ lượt.

Trường `reasoning_content` (DeepSeek/OpenRouter) không có trong type chuẩn của SDK nên được đọc qua cast — SDK không loại bỏ field lạ.

Nếu proxy bỏ qua `stream: true` và trả JSON thường, SDK trả stream rỗng; client tự gọi lại không stream để lấy dữ liệu.
