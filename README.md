# PillAgents

Coding agent chạy trong terminal, hoạt động với mọi endpoint tương thích OpenAI.

## Cài đặt

```bash
npm install
npm run build
cp .env.example .env   # điền PILL_API_KEY
```

## Chạy

```bash
npm start
# hoặc cài global
npm link && pill
```

Biến môi trường:

| Biến | Mặc định | Mô tả |
|---|---|---|
| `PILL_API_KEY` | — | API key (bắt buộc), fallback `OPENAI_API_KEY` |
| `PILL_BASE_URL` | `https://api.openai.com/v1` | Endpoint proxy |
| `PILL_MODEL` | `gpt-4o-mini` | Model |
| `PILL_MAX_STEPS` | `25` | Số bước tool tối đa mỗi lượt |

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
