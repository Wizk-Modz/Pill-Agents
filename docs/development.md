# Phát triển

## Yêu cầu

| | Version | Ghi chú |
|---|---|---|
| Node.js | ≥ 22.9 | Cần `fs.glob` (22.0) và `--env-file-if-exists` (22.9); khuyến nghị 24 |
| npm | ≥ 10 | |

## Cài đặt

```bash
npm install
npm run build
```

## Lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run build` | Biên dịch TypeScript sang `dist/` |
| `npm start` | Chạy TUI (nạp `.env` nếu có) |
| `npm run dev` | Build rồi chạy |
| `npm test` | Build rồi chạy toàn bộ test |

## Cấu trúc

```
src/
├── main.tsx            Điểm vào
├── config.ts           Đọc settings.json + env
├── instructions.ts     Nạp PILL.md
├── types.ts            Kiểu dữ liệu chung
├── llm.ts              Gọi API qua SDK openai
├── tools.ts            6 tool
├── agent.ts            Vòng lặp agent
└── ui/
    ├── App.tsx         Màn hình chính
    ├── InputBox.tsx    Ô nhập
    ├── useKeys.ts      Parse phím thô
    ├── markdown.ts     Render markdown → ANSI
    ├── Transcript.tsx  Item → dòng hiển thị
    └── commands.ts     Gợi ý lệnh gạch chéo

test/
├── tools.test.ts        Tool file, shell theo nền tảng, input reducer
├── keys.test.ts         Parse phím và markdown
├── instructions.test.ts Nạp PILL.md
├── agent.test.ts        System prompt
└── mock-server.mjs      Mock API (không phải test tự động)
```

Chi tiết luồng dữ liệu: xem [architecture.md](architecture.md).

## Test

Dùng `node:test` có sẵn của Node, không cần framework:

```bash
npm test
```

40 test, bao gồm:

| Nhóm | Nội dung |
|---|---|
| Tool | ghi/đọc file, edit từ chối khớp nhiều lần, bash trả lỗi không ném, glob/grep, pattern bắt đầu bằng `-`, shell và thư mục tạm theo nền tảng |
| Input | Enter gửi, `\`+Enter xuống dòng, history, Ctrl+P/Ctrl+N, con trỏ nhiều dòng, paste |
| Phím | mũi tên khi escape bị tách, chuột SGR, bracketed paste, tiếng Việt |
| Markdown | heading/bullet/code, bảng box-drawing, căn lề, thu hẹp, wrap, cặp surrogate |
| PILL.md | global + project, thư mục cha, file rỗng |
| Agent | system prompt nêu thư mục làm việc và thư mục tạm |

Test không cần API key — không nhóm nào gọi mạng.

### Viết test mới

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

test('mô tả ngắn gọn hành vi', async () => {
  assert.equal(thucTe, mongDoi);
});
```

Với test cần file, dùng `withTempDir()` có sẵn trong `tools.test.ts` để tạo thư mục tạm và tự dọn. Không hardcode `/tmp`: dùng `tmpdir()` của `node:os` — Termux dùng `$PREFIX/tmp`, Windows dùng `%TEMP%`.

## Kiểm thử TUI

TUI cần terminal thật, không test tự động được bằng `node:test`. Cách kiểm chứng thủ công:

**1. Chạy mock API** (không cần key thật):

```bash
node test/mock-server.mjs        # cổng 8799
```

**2. Chạy TUI trỏ vào mock:**

```bash
PILL_API_KEY=test \
PILL_BASE_URL=http://localhost:8799/v1 \
PILL_MODEL=mock \
npm start
```

Mock trả về:
- Tin thường → stream text "Xin chào từ mock server."
- Tin chứa `chạy lệnh` → trả tool call `bash` để kiểm tra luồng duyệt

**3. Kiểm tra các luồng:**

| Luồng | Cách kiểm |
|---|---|
| Gõ nhanh không mất ký tự | Gõ liên tục 30+ ký tự |
| History | Gửi tin, bấm `↑` — phải hiện lại tin cũ, **không** hiện `^[[A` |
| Cuộn | `PageUp`/`PageDown`, lăn chuột |
| Duyệt tool | Gửi "chạy lệnh", bấm `y` |
| Xếp hàng | Trong lúc agent chạy, gõ tin mới + Enter → hiện `⏳ 1 chờ` |
| Thinking | Cần mock trả `reasoning_content` (mock chính không có) |

## Thêm provider

Chỉ cần đổi `PILL_BASE_URL` — không cần sửa code. Xem [configuration.md](configuration.md#chạy-với-provider-khác).

Nếu provider có trường đặc biệt (như `reasoning_content` của DeepSeek), xử lý trong `src/llm.ts`. SDK không strip field lạ, nên chỉ cần cast để đọc:

```ts
const extras = delta as { reasoning_content?: string | null };
if (extras.reasoning_content) options.onReasoning?.(extras.reasoning_content);
```

## Quy ước code

- **Comment**: mỗi hàm một dòng mô tả chức năng, tiếng Việt có dấu đầy đủ
- **Tên**: `camelCase` cho biến/hàm, `PascalCase` cho class/component, `SCREAMING_SNAKE` cho hằng
- **File > 300 dòng**: cân nhắc tách module
- **Tool mới**: khai báo trong `createTools()`, xem [tools.md](tools.md#thêm-tool-mới)

## Gỡ lỗi

**TUI không render, không có output:**

Kiểm tra TTY — `main.tsx` từ chối chạy khi không phải terminal tương tác:

```bash
node -e "console.log(process.stdin.isTTY)"   # phải là true
```

**`^[[A` hiện trong prompt:**

Nghĩa là escape sequence không được parse. Kiểm tra `src/ui/useKeys.ts` — logic gộp byte bị tách nằm trong `parseInput()`.

**Mất ký tự khi gõ nhanh:**

Kiểm tra các cặp state/ref trong `App.tsx`. Ref phải được cập nhật **đồng thời** với state (qua `applyInput`, `setBusySync`...), không qua `useEffect`.

**TUI giật khi stream:**

Kiểm tra `STREAM_FLUSH_MS` trong `App.tsx` (mặc định 60ms). Tăng nếu máy chậm.

**Lỗi API:**

Bật log bằng cách chạy trực tiếp:

```bash
PILL_API_KEY=... PILL_BASE_URL=... node dist/src/main.js 2>err.log
```

## Đóng góp

Repo dùng branch theo tính năng:

```bash
git checkout -b feat/tinh-nang-moi
```

Commit message theo Conventional Commits:

```
<loại>(<phạm vi>): <mô tả ngắn ở thể mệnh lệnh>
```

Loại: `feat`, `fix`, `style`, `refactor`, `perf`, `test`, `docs`, `ci`, `chore`.

Ví dụ:

```
feat(ui): render bảng markdown bằng khung box-drawing
fix(config): đọc PILL_CONFIG_DIR cho session file
docs(tools): bổ sung giới hạn output từng tool
```

Trước khi commit:

```bash
npm test          # phải pass hết
npx tsc -p .      # phải không lỗi
```
