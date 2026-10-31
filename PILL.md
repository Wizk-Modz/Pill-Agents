# PillAgents — hướng dẫn dự án

File này hướng dẫn coding agent khi làm việc với repo này.

Coding agent chạy trong terminal, hoạt động với mọi endpoint tương thích OpenAI.
Viết bằng TypeScript, TUI dùng Ink, gọi model qua SDK `openai`.

## Đồng bộ tài liệu hướng dẫn

Ba file `AGENTS.md`, `CLAUDE.md` và `PILL.md` phải có cùng nội dung hướng dẫn. Khi sửa quy tắc, cấu trúc, lệnh, test hoặc quy ước, cập nhật đồng thời cả ba file; chỉ khác tiêu đề và câu giới thiệu về đối tượng đọc. Không để lệch số test, số dòng hay danh sách lệnh giữa ba file.

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
├── config.ts         Đọc settings.json + env, kiểu Effort, chế độ mặc định
├── instructions.ts   Nạp PILL.md global + project
├── types.ts          Kiểu dữ liệu chung (AgentMode, ChatMessage, ToolSpec, Usage)
├── llm.ts            Gọi API qua SDK openai, streaming, usage, effort
├── tools.ts          6 tool: read/write/edit file, bash, grep, glob
├── agent.ts          Vòng lặp agent, chọn tool theo chế độ, quản lý hội thoại, lưu phiên
├── statusline.ts     Chạy lệnh statusLine, lấy dòng đầu stdout
└── ui/
    ├── App.tsx       Màn hình chính, bố cục, state, phím/chuột
    ├── Header.tsx    Header thương hiệu, badge chế độ, thư mục, nhánh git
    ├── StatusBar.tsx Footer trạng thái, token, thời gian
    ├── Welcome.tsx   Màn hình chào capsule, bản gọn theo chiều cao
    ├── QueuePanel.tsx Bảng tin nhắn xếp hàng
    ├── ApprovalPanel.tsx Hộp duyệt viền vàng
    ├── InputBox.tsx  Ô nhập capsule nhiều dòng, con trỏ, history
    ├── useKeys.ts    Parser phím thô, chuột, paste
    ├── markdown.ts   Markdown → segment → ANSI
    ├── Transcript.tsx Item hội thoại → dòng, thẻ tool, diff
    ├── approval.ts   Nội dung duyệt, cảnh báo lệnh nguy hiểm
    ├── diff.ts       Diff dòng LCS
    ├── format.ts     Token, thời gian, đường dẫn, độ rộng ANSI
    ├── theme.ts      Palette, glyph, icon tool, viền ASCII
    ├── git.ts        Đọc nhánh git
    ├── hitTest.ts    Tọa độ chuột → dòng transcript
    ├── useTranscriptLines.ts Cache dòng + bản đồ click
    └── commands.ts   Gợi ý lệnh gạch chéo

test/                 node:test, không framework
docs/                 Tài liệu chi tiết
```

## Quy tắc code

- **Comment**: mỗi hàm một dòng mô tả chức năng, tiếng Việt **có dấu đầy đủ**.
  Không thêm phần tham chiếu như `(xem file X)` nếu không cần.
- **Tên**: `camelCase` cho biến/hàm, `PascalCase` cho class/component,
  `SCREAMING_SNAKE_CASE` cho hằng.
- **File > 300 dòng**: cân nhắc tách module. `App.tsx` hiện ~746 dòng.
- **Không thêm dependency** khi stdlib hoặc dependency có sẵn làm được.
  Mọi dependency phải pin version chính xác, không dùng `^` hay `latest`.
- **Không dead code**: xoá import, hàm, biến không dùng ngay khi phát hiện.
- **Đa nền tảng**: không hardcode đường dẫn POSIX. Thư mục tạm lấy từ `os.tmpdir()`
  (biến `$TMPDIR`) — Termux dùng `$PREFIX/tmp`, Windows dùng `%TEMP%`; shell lấy qua `resolveShell()`.
- **Giao diện**: ưu tiên `COLORS`/`GLYPHS` trong `src/ui/theme.ts`; không hardcode
  mã màu mới rải rác. Icon tool lấy từ `toolIcon()`.

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
`pendingRef`/`pendingApproval`, `scrollRef`/`scrollTop`, `modeRef`/`mode`.

### Tool call phải luôn có kết quả

API yêu cầu mỗi `tool_call` phải có message `role: 'tool'` tương ứng.
Khi huỷ giữa chừng, `pushCancelled()` ghi kết quả cho các tool chưa chạy —
không được bỏ qua, nếu không lượt sau sẽ lỗi.

### Chế độ plan/build phải khoá ở agent, không chỉ ở UI

`send()` chốt `config.mode` đầu lượt, chọn prompt và `toolsForMode()` tương ứng.
`runToolCalls()` dùng đúng map tool đã gửi model; nếu model tự gọi tool bị khoá ở
chế độ plan, agent phải trả kết quả lỗi và **không chạy** tool. Không được chỉ ẩn
tool khỏi danh sách API rồi vẫn tra `this.toolMap` đầy đủ lúc thực thi.

Hai prompt dùng chung nội dung PILL.md đã nạp lúc tạo agent hoặc `/clear`; đổi
chế độ không đọc lại file. Hội thoại được giữ nguyên khi đổi chế độ.

### Huỷ lượt không xoá hàng đợi

`abort()` chỉ dừng lượt hiện tại và từ chối tool đang chờ; **không** xoá
`queueRef` hay `queue`. `finally` trong `runTurn()` lấy tin kế tiếp và chạy tiếp.
Hàng đợi chỉ hiện ở `QueuePanel` và footer, không ghi item “đã xếp hàng” vào
transcript để không còn chữ chờ cũ.

### Parse phím không dùng `useInput` của Ink

Terminal có thể gửi escape sequence bị tách (`\x1b` rồi `[A`), Ink hiểu nhầm
thành text → hiện literal `^[[A`. `useKeys.ts` buffer lại và chờ 60ms cho
sequence dở dang. Cũng bật SGR mouse `\x1b[?1000h\x1b[?1006h` để nhận lăn chuột
và click trái; click chỉ có hiệu lực trên dòng tiêu đề thinking/tool, bị chặn
khi đang duyệt tool, và `Shift+click` được giữ cho chọn văn bản.

### Render dùng ANSI string

Ink hỗ trợ ANSI trong `<Text>`. Mỗi dòng transcript là **một** `<Text>` chứa
chuỗi đã tô màu, không lồng nhiều `<Text>` cho từng style — giảm mạnh số node React.
Cache dòng theo `item.id`, xoá cache khi đổi `columns`, khi tool có kết quả mới
hoặc khi toggle thinking/tool. `useTranscriptLines.ts` dựng song song bản đồ
`owners` để biết dòng nào thuộc item nào và có phải tiêu đề click được không.

### Proxy có thể không chuẩn

- `reasoning_content` (DeepSeek/OpenRouter) không có trong type SDK → đọc qua cast.
- Proxy bỏ qua `stream: true` → SDK trả stream rỗng; `llm.ts` phát hiện
  (`chunks === 0`) và gọi lại không stream.
- Proxy không trả `usage` → footer ẩn phần token, không lỗi.

## Test

Dùng `node:test` có sẵn, không cần framework. Hiện 107 test:

| File | Nội dung |
|---|---|
| `test/tools.test.ts` | Ghi/đọc/sửa file, bash, exitCode, glob, grep, input reducer |
| `test/keys.test.ts` | Parse phím/chuột/click, paste, markdown inline, bảng, khối code, tiêu đề, quote lồng, khung spinner |
| `test/instructions.test.ts` | Nạp PILL.md global/project/cha |
| `test/agent.test.ts` | System prompt, chế độ plan, lọc tool chỉ đọc |
| `test/config.test.ts` | Đọc chế độ build/plan, thứ tự ưu tiên và giá trị lạ |
| `test/statusline.test.ts` | Dòng trạng thái: đọc settings.json, chạy lệnh, lấy dòng đầu stdout |
| `test/diff.test.ts` | Diff dòng LCS, thêm/bớt, giới hạn, truncated |
| `test/ui.test.ts` | Format, độ rộng ANSI, hit-test, nội dung duyệt, thẻ tool, header/footer, ô nhập, welcome, hàng đợi |

Test không gọi mạng — dùng thư mục tạm qua `withTempDir()`.

Trước khi báo hoàn thành: `npm test` phải pass hết, `npx tsc -p .` không lỗi.

## Kiểm thử TUI

TUI cần terminal thật, không test tự động được. Kiểm tra thủ công các luồng:

| Luồng | Cách kiểm |
|---|---|
| Gõ nhanh | Gõ liên tục 30+ ký tự, không được mất chữ |
| History | Gửi tin, bấm `↑` — phải hiện lại tin cũ, **không** hiện `^[[A` |
| Cuộn | `PageUp`/`PageDown`, lăn chuột; footer báo số dòng đã cuộn |
| Duyệt tool | Gửi "chạy lệnh", bấm `y`; thử `n`, `Esc`, `d` mở rộng |
| Mở rộng | Click tiêu đề thinking/tool, `Ctrl+O`, `Ctrl+T` |
| Kích thước | 80×24 và 120×40, resize qua lại không tràn footer |
| Xếp hàng | Trong lúc agent chạy, gõ tin mới + Enter → `↳ n tin đang chờ`; bấm `Esc`, lượt hiện tại dừng nhưng tin chờ vẫn chạy tiếp |
| Thinking | Cần mock trả `reasoning_content` |
| Diff | Cần mock trả `Edit` |
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
