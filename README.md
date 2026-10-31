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

Biến môi trường chính: `PILL_API_KEY` (bắt buộc), `PILL_BASE_URL`, `PILL_MODEL`, `PILL_MODE`, `PILL_MAX_STEPS`, `PILL_CONFIG_DIR`. Chi tiết và ví dụ với provider khác: [docs/configuration.md](docs/configuration.md).

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

Bố cục một cột, tự co theo kích thước terminal (kiểm thử ở 80×24). Phong cách tối giản, một màu nhấn cyan (plan dùng tím), viền bo tròn và badge chế độ:

- **Header**: thương hiệu, badge `▐ BUILD ▌` / `▐ PLAN ▌`, thư mục và nhánh git; tự thu gọn khi hẹp.
- **Welcome**: logo capsule, mô tả và gợi ý `/help`, `Tab`; chuyển bản gọn khi terminal thấp hoặc hẹp.
- **Transcript**: tin nhắn `❯`, markdown, thinking `✻`, thẻ tool có icon + tên gốc, kết quả/diff nằm dưới rail `│`.
- **Hàng đợi / hộp duyệt**: nằm ngay trên ô nhập; hiện tối đa 2 tin khi thấp, 3 tin khi cao; hộp duyệt có viền vàng, kèm gợi ý `Alt+M` để bật chế độ tự duyệt.
- **Ô nhập**: khung capsule với tiêu đề `nhập` / `plan` / `đang xử lý`.
- **Footer**: model, effort, token, số tool, thời gian, trạng thái `tự duyệt mọi tool` và gợi ý phím; số liệu phụ tự bỏ khi hẹp để spinner và số tin chờ luôn hiện.

## Phím tắt

| Phím | Tác dụng |
|---|---|
| `Enter` | Gửi tin nhắn |
| `Tab` | Đổi chế độ `build` ↔ `plan` (khi bảng gợi ý lệnh đang đóng) |
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
| Click tiêu đề Suy nghĩ/tool | Mở/đóng riêng mục đó |
| `d` (khi chờ duyệt) | Xem đầy đủ / thu gọn nội dung duyệt |
| `y` / `n` (khi chờ duyệt) | Đồng ý / từ chối tool |
| `Alt+M` | Bật/tắt chế độ tự duyệt mọi tool (không hỏi khi chạy) |
| `a` (khi chờ duyệt bash thường) | Bật chế độ tự duyệt ngay từ hộp duyệt |
| `Esc` | Huỷ lượt đang chạy; tin trong hàng đợi vẫn chạy tiếp |
| `Ctrl+C` | Xoá input / thoát |
| `Ctrl+D` | Thoát |

Gõ tin nhắn trong lúc agent đang chạy sẽ **xếp hàng**, hiện trong bảng ngay trên ô nhập và tự động chạy sau khi lượt hiện tại xong. Bấm `Esc` để huỷ lượt đang chạy không xoá hàng đợi — tin kế tiếp vẫn được chạy. `Esc` dừng được cả khi tool đang chạy dở: `Glob`/`grep` kiểm tra tín hiệu huỷ trong lúc quét nên không phải chờ quét xong. Lệnh gạch chéo xếp hàng cũng được thực thi như lệnh, không gửi cho model. Click trong lúc hộp duyệt đang mở bị bỏ qua; `Shift+click` vẫn dành cho chọn văn bản.

Model có hỗ trợ `reasoning_content` sẽ hiển thị khối **✻ Suy nghĩ** kèm thời gian suy nghĩ. Thẻ tool hiện thời gian chạy, số dòng/kết quả, diff `+N −M` với `Edit`, mã thoát với `bash`, và kết quả thu gọn mở rộng được bằng click hoặc `Ctrl+T`.

### Chế độ tự duyệt

Bấm `Alt+M` bất cứ lúc nào — kể cả khi agent đang chạy — để bật/tắt chế độ tự duyệt. Khi bật, `Write`, `Edit` và `bash` chạy ngay không hỏi. Header đổi badge thành `BUILD AUTO` (hoặc `PLAN AUTO`) màu vàng, footer nối thêm `tự duyệt mọi tool`, và mỗi lần bật/tắt đều có dòng thông báo trong hội thoại.

**Lệnh nguy hiểm vẫn luôn hỏi.** `rm`, `sudo`, `git reset --hard`, force push, `curl | sh`… do `isDangerousCommand()` đánh dấu sẽ mở hộp duyệt như thường và không hiện gợi ý `Alt+M`, vì đó đúng là nhóm cần người xem trước.

Trong hộp duyệt còn có `[a]` cho lệnh bash thường — cùng bật chế độ này, tiện khi đang đứng giữa hộp duyệt. `/auto on|off` (tên cũ `/trust`) cũng đổi được, và `/clear` tắt chế độ cùng hội thoại.

Footer hiển thị model, effort (khi ≥ 80 cột), token đã dùng trong phiên (`↑` prompt, `↓` completion), số tool, thời gian lượt đang chạy và số tin chờ; phiên bản chỉ hiện khi terminal rộng (≥ 110 cột). Khi hẹp, footer tự bỏ bớt số tool/thời gian để spinner và số tin chờ luôn còn chỗ. `/clear` đặt lại token về 0. Khi bật tự duyệt, footer nối thêm `tự duyệt mọi tool`. Khi agent đang chạy, footer hiện spinner braille kèm `đang xử lý (Esc huỷ)`; dưới 70 cột rút gọn còn `đang xử lý`. Khi cuộn lên, footer báo số dòng đã cuộn và cách về cuối. Gợi ý phím bên phải tự ẩn khi không đủ chỗ để tránh chồng chữ.

Muốn footer hiện thông tin riêng (nhánh git, thư mục, chi phí…), cấu hình `statusLine` trong `settings.json` — PillAgents chạy lệnh của bạn và lấy dòng đầu stdout:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.pill/statusline.sh"
  }
}
```

Lệnh nhận JSON của phiên qua stdin (`model`, `effort`, `mode`, `cwd`, `tokens`, `busy`, `queued`). Chi tiết và script mẫu: [docs/configuration.md](docs/configuration.md#dòng-trạng-thái-tự-cấu-hình).

Lệnh: `/plan`, `/build`, `/mode`, `/auto on|off`, `/clear`, `/model <tên>`, `/effort <mức>`, `/help`, `/exit`.

Mọi thay đổi đáng chú ý được ghi trong [CHANGELOG.md](CHANGELOG.md).

## Chế độ plan và build

Giống OpenCode, PillAgents có hai chế độ:

| Chế độ | Tool | Dùng khi |
|---|---|---|
| `build` (mặc định) | Đủ 6 tool, ghi/sửa/chạy lệnh cần duyệt | Triển khai, sửa lỗi, chạy test |
| `plan` | Chỉ `Read`, `grep`, `Glob` | Khảo sát code và lập kế hoạch trước khi sửa |

Bấm `Tab` để đổi chế độ khi agent đang rảnh, hoặc dùng `/plan` / `/build`. Header hiện badge `PLAN` màu tím hoặc `BUILD` màu cyan; `/mode` xem chế độ hiện tại. Hội thoại được giữ nguyên khi đổi chế độ.

Ở chế độ `plan`, model không được cấp `Write`, `Edit` hay `bash`, và system prompt yêu cầu trả về kế hoạch thay vì tự sửa. Nếu model vẫn gọi tool bị khoá, agent từ chối và ghi lỗi vào hội thoại — không có thay đổi nào được thực hiện.

Đặt chế độ mặc định bằng `--mode plan`, biến `PILL_MODE` hoặc `mode` trong `settings.json`. Chế độ hiện tại cũng được lưu vào file phiên.

## Tool

| Tool | Cần duyệt | Mô tả |
|---|---|---|
| `Read` | Không | Đọc file kèm số dòng |
| `Write` | Có | Ghi đè file, tạo thư mục cha |
| `Edit` | Có | Thay chuỗi chính xác |
| `bash` | Có | Chạy lệnh shell |
| `grep` | Không | Tìm theo regex (ripgrep, fallback Node) |
| `Glob` | Không | Liệt kê file theo pattern |

Ở chế độ `plan`, chỉ ba tool đọc (`Read`, `grep`, `Glob`) được cấp cho model. Phiên được lưu tại `~/.pill/sessions/`.

Tên `Read`, `Write`, `Edit`, `Glob` và tham số `file_path` theo quy ước của Claude Code. Ba tool file **bắt buộc** đường dẫn tuyệt đối, và `Write`/`Edit` từ chối file chưa được `Read` trong phiên để không ghi đè mù. Chi tiết: [docs/tools.md](docs/tools.md#phải-read-trước-khi-writeedit).

## Test

```bash
npm test
```

`test/mock-server.mjs` là mock API dùng để kiểm thử TUI không cần key thật.

## Ghi chú kỹ thuật

Gọi model qua SDK `openai` (retry 2 lần, backoff; `AbortSignal` để huỷ lượt). Hỗ trợ `reasoning_content` của DeepSeek/OpenRouter và proxy bỏ qua `stream: true`.

Chi tiết: [docs/architecture.md](docs/architecture.md).
