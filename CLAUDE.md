# PillAgents — hướng dẫn cho Claude Code

File này hướng dẫn Claude Code (claude.ai/code) khi làm việc với code trong repo này.

Coding agent chạy trong terminal, hoạt động với mọi endpoint tương thích OpenAI.
Viết bằng TypeScript, TUI dùng Ink, gọi model qua SDK `openai`.

## Lệnh thường dùng

```bash
npm run build      # biên dịch TypeScript sang dist/
npm start          # chạy TUI (nạp .env nếu có)
npm test           # build rồi chạy toàn bộ test (node:test)
node dist/src/main.js --help   # xem tùy chọn CLI
```

Chạy thử TUI không cần API key thật:

```bash
node test/mock-server.mjs      # cửa sổ khác, cổng 8799
PILL_API_KEY=test PILL_BASE_URL=http://localhost:8799/v1 PILL_MODEL=mock npm start
```

## Cấu trúc

```
src/
├── main.tsx          Điểm vào, parse tham số CLI
├── config.ts         Đọc settings.json + env, kiểu Effort
├── instructions.ts   Nạp PILL.md global + project
├── types.ts          Kiểu dữ liệu chung (ChatMessage, ToolSpec, Usage)
├── llm.ts            Gọi API qua SDK openai, streaming, usage, effort
├── tools.ts          6 tool: read/write/edit file, bash, grep, glob
├── agent.ts          Vòng lặp agent, quản lý hội thoại, lưu phiên
└── ui/
    ├── App.tsx       Màn hình chính, state, xử lý phím
    ├── InputBox.tsx  Ô nhập nhiều dòng, con trỏ, history
    ├── useKeys.ts    Parser phím thô (escape bị tách, chuột, paste)
    ├── markdown.ts   Markdown → segment → ANSI
    ├── Transcript.tsx Item hội thoại → dòng hiển thị
    └── commands.ts   Gợi ý lệnh gạch chéo

test/                 node:test, không framework
docs/                 Tài liệu chi tiết
```

## Quy tắc code

- **Comment**: mỗi hàm một dòng mô tả chức năng, tiếng Việt **có dấu đầy đủ**.
  Không thêm phần tham chiếu như `(xem file X)` nếu không cần.
- **Tên**: `camelCase` cho biến/hàm, `PascalCase` cho class/component,
  `SCREAMING_SNAKE_CASE` cho hằng.
- **File > 300 dòng**: cân nhắc tách module. `App.tsx` hiện ~590 dòng.
- **Không thêm dependency** khi stdlib hoặc dependency có sẵn làm được.
  Mọi dependency phải pin version chính xác, không dùng `^` hay `latest`.
- **Không dead code**: xoá import, hàm, biến không dùng ngay khi phát hiện.
- **Đa nền tảng**: không hardcode đường dẫn POSIX. Thư mục tạm lấy từ `os.tmpdir()`
  (biến `$TMPDIR`) — Termux dùng `$PREFIX/tmp`, Windows dùng `%TEMP%`; shell lấy qua `resolveShell()`.

## Quy tắc quan trọng của dự án này

### State và ref phải đồng bộ tại chỗ ghi

Trong `App.tsx`, sự kiện bàn phím đến bất đồng bộ nên cần bản sao trong `ref`.
**Không** dùng `useEffect(() => { ref.current = state }, [state])` — nó ghi đè
bằng giá trị cũ khi có nhiều cập nhật trong cùng frame, gây **mất ký tự khi gõ nhanh**.

Luôn cập nhật cả hai tại chỗ:

```ts
const applyInput = (next: InputState) => {
  inputRef.current = next;   // cho handler đọc ngay
  setInput(next);            // cho render
};
```

Các cặp hiện có: `inputRef`/`input`, `busyRef`/`busy`,
`pendingRef`/`pendingApproval`, `scrollRef`/`scrollTop`.

### Tool call phải luôn có kết quả

API yêu cầu mỗi `tool_call` phải có message `role: 'tool'` tương ứng.
Khi huỷ giữa chừng, `pushCancelled()` ghi kết quả cho các tool chưa chạy —
không được bỏ qua, nếu không lượt sau sẽ lỗi.

### Parse phím không dùng `useInput` của Ink

Terminal có thể gửi escape sequence bị tách (`\x1b` rồi `[A`), Ink hiểu nhầm
thành text → hiện literal `^[[A`. `useKeys.ts` buffer lại và chờ 60ms cho
sequence dở dang. Cũng bật SGR mouse `\x1b[?1000h\x1b[?1006h` để nhận lăn chuột.

### Render dùng ANSI string

Ink hỗ trợ ANSI trong `<Text>`. Mỗi dòng transcript là **một** `<Text>` chứa
chuỗi đã tô màu, không lồng nhiều `<Text>` cho từng style — giảm mạnh số node React.
Cache dòng theo `item.id`, xoá cache khi đổi `columns` hoặc khi tool có kết quả mới.

### Proxy có thể không chuẩn

- `reasoning_content` (DeepSeek/OpenRouter) không có trong type SDK → đọc qua cast.
- Proxy bỏ qua `stream: true` → SDK trả stream rỗng; `llm.ts` phát hiện
  (`chunks === 0`) và gọi lại không stream.
- Proxy không trả `usage` → footer ẩn phần token, không lỗi.

## Test

Dùng `node:test` có sẵn, không cần framework. Hiện 40 test:

| File | Nội dung |
|---|---|
| `test/tools.test.ts` | Ghi/đọc/sửa file, bash, glob, grep, input reducer |
| `test/keys.test.ts` | Parse phím, chuột, paste, markdown, bảng |
| `test/instructions.test.ts` | Nạp PILL.md global/project/cha |
| `test/agent.test.ts` | System prompt: thư mục làm việc, thư mục tạm |

Test không gọi mạng — dùng thư mục tạm qua `withTempDir()`.

Trước khi báo hoàn thành: `npm test` phải pass hết, `npx tsc -p .` không lỗi.

## Kiểm thử TUI

TUI cần terminal thật, không test tự động được. Kiểm tra thủ công các luồng:

| Luồng | Cách kiểm |
|---|---|
| Gõ nhanh | Gõ liên tục 30+ ký tự, không được mất chữ |
| History | Gửi tin, bấm `↑` — phải hiện lại tin cũ, **không** hiện `^[[A` |
| Cuộn | `PageUp`/`PageDown`, lăn chuột |
| Duyệt tool | Gửi "chạy lệnh", bấm `y` |
| Xếp hàng | Trong lúc agent chạy, gõ tin mới + Enter → `⏳ 1 chờ` |
| Thinking | Cần mock trả `reasoning_content` |
| Gợi ý lệnh | Gõ `/`, dùng `Tab`/`↑↓` |
| Token | Footer hiện `↑N ↓N` sau mỗi lượt |

## Git

Branch theo tính năng: `feat/<tên>`. Nhánh chính: `main`.

Commit theo Conventional Commits:

```
<loại>(<phạm vi>): <mô tả ngắn ở thể mệnh lệnh>
```

Loại: `feat`, `fix`, `style`, `refactor`, `perf`, `test`, `docs`, `ci`, `chore`.

Ví dụ: `feat(usage): hiển thị token đã dùng trên footer`

**Không commit** khi chưa được yêu cầu. **Không commit** `.env` hay API key thật.

## Tài liệu

- [docs/architecture.md](docs/architecture.md) — luồng dữ liệu, quyết định thiết kế
- [docs/tools.md](docs/tools.md) — 6 tool, tham số, cách thêm tool mới
- [docs/configuration.md](docs/configuration.md) — settings.json, env, provider khác
- [docs/development.md](docs/development.md) — build, test, gỡ lỗi, quy ước commit
