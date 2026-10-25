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

Prompt nền dựng sẵn gồm 5 mục — môi trường, cách làm việc, tool đang có, viết code, trả lời ([chi tiết](docs/architecture.md#system-prompt-dựng-sẵn)); phần PILL.md được nối tiếp phía sau nên quy tắc của dự án luôn thắng.

```markdown
# Quy tắc dự án

- Dùng pnpm, không dùng npm.
- Chạy `pnpm test` trước khi báo hoàn thành.
- Trả lời bằng tiếng Việt.
```

Chi tiết: [docs/configuration.md](docs/configuration.md#pillmd).

## Giao diện

Bố cục một cột, tự co theo kích thước terminal (kiểm thử ở 80×24):

- **Header**: phiên bản, model, effort, thư mục và nhánh git; thu gọn khi hẹp.
- **Welcome**: hiện khi phiên chưa có tin nhắn, kèm gợi ý lệnh.
- **Transcript**: markdown, thinking, thẻ tool và diff; chỉ vùng này cuộn.
- **Hàng đợi / hộp duyệt**: nằm ngay trên ô nhập, tối đa 3 tin xếp hàng hiển thị.
- **Footer**: trạng thái phiên, token, số tool, thời gian và gợi ý phím theo ngữ cảnh.

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
| `Ctrl+O` | Mở/đóng toàn bộ khối thinking |
| `Ctrl+T` | Mở/đóng toàn bộ kết quả tool |
| Click tiêu đề Thinking/tool | Mở/đóng riêng mục đó |
| `d` (khi chờ duyệt) | Xem đầy đủ / thu gọn nội dung duyệt |
| `y` / `n` (khi chờ duyệt) | Đồng ý / từ chối tool |
| `Esc` | Huỷ lượt đang chạy |
| `Ctrl+C` | Xoá input / thoát |
| `Ctrl+D` | Thoát |

Gõ tin nhắn trong lúc agent đang chạy sẽ **xếp hàng**, hiện trong bảng ngay trên ô nhập và tự động chạy sau khi lượt hiện tại xong. Lệnh gạch chéo xếp hàng cũng được thực thi như lệnh, không gửi cho model. Click trong lúc hộp duyệt đang mở bị bỏ qua; `Shift+click` vẫn dành cho chọn văn bản.

Model có hỗ trợ `reasoning_content` sẽ hiển thị khối **✻ Thinking** kèm thời gian suy nghĩ. Thẻ tool hiện thời gian chạy, số dòng/kết quả, diff `+N −M` với `edit_file`, mã thoát với `bash`, và kết quả thu gọn mở rộng được bằng click hoặc `Ctrl+T`.

Footer hiển thị phiên bản, token đã dùng trong phiên (`↑` prompt, `↓` completion), số tool, thời gian lượt đang chạy và số tin chờ; khi terminal đủ rộng (≥ 100 cột) footer hiện thêm model/effort, còn header luôn có các thông tin này. `/clear` đặt lại token về 0. Khi agent đang chạy, footer hiện spinner braille kèm `đang xử lý (Esc huỷ)`; khi cuộn lên, footer báo số dòng đã cuộn và cách về cuối. Gợi ý phím bên phải tự ẩn khi không đủ chỗ để tránh chồng chữ.

Muốn footer hiện thông tin riêng (nhánh git, thư mục, chi phí…), cấu hình `statusLine` trong `settings.json` — PillAgents chạy lệnh của bạn và lấy dòng đầu stdout:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.pill/statusline.sh"
  }
}
```

Lệnh nhận JSON của phiên qua stdin (`model`, `effort`, `cwd`, `tokens`, `busy`, `queued`). Chi tiết và script mẫu: [docs/configuration.md](docs/configuration.md#dòng-trạng-thái-tự-cấu-hình).

Lệnh: `/clear`, `/model <tên>`, `/effort <mức>`, `/help`, `/exit`.

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
