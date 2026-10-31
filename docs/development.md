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
├── statusline.ts       Chạy lệnh statusLine, lấy dòng đầu stdout
├── version.ts          Đọc phiên bản từ package.json
└── ui/
    ├── App.tsx            Màn hình chính, bố cục, phím/chuột
    ├── InputBox.tsx       Ô nhập capsule, con trỏ, history
    ├── useKeys.ts         Parse phím thô, chuột, paste
    ├── markdown.ts        Render markdown → ANSI
    ├── Transcript.tsx     Item → dòng, thẻ tool, diff
    ├── Header.tsx         Header thương hiệu, badge chế độ
    ├── StatusBar.tsx      Footer trạng thái
    ├── Welcome.tsx        Màn hình chào
    ├── QueuePanel.tsx     Bảng hàng đợi
    ├── ApprovalPanel.tsx  Hiển thị hộp duyệt
    ├── approval.ts        Dựng nội dung duyệt
    ├── diff.ts            Diff dòng LCS
    ├── format.ts          Định dạng token/thời gian/đường dẫn/độ rộng
    ├── theme.ts           Palette, glyph, icon tool, viền ASCII
    ├── git.ts             Đọc nhánh git
    ├── hitTest.ts         Tọa độ chuột → dòng transcript
    ├── useTranscriptLines.ts Cache dòng + bản đồ click
    └── commands.ts        Gợi ý lệnh gạch chéo

test/
├── tools.test.ts        Tool file, shell theo nền tảng, input reducer
├── keys.test.ts         Parse phím/chuột, markdown, khung spinner
├── instructions.test.ts Nạp PILL.md
├── agent.test.ts        System prompt, chế độ plan/build và lọc tool
├── config.test.ts       Đọc chế độ agent và thứ tự ưu tiên cấu hình
├── statusline.test.ts   Dòng trạng thái: đọc settings.json, chạy lệnh, lấy dòng đầu stdout
├── diff.test.ts         Diff dòng LCS, giới hạn và đánh dấu truncated
├── ui.test.ts           Format, hit-test, nội dung duyệt, thẻ tool
└── mock-server.mjs      Mock API (không phải test tự động)
```

Chi tiết luồng dữ liệu: xem [architecture.md](architecture.md).

## Test

Dùng `node:test` có sẵn của Node, không cần framework:

```bash
npm test
```

113 test, bao gồm:

| Nhóm | Nội dung |
|---|---|
| Tool | ghi/đọc file, edit từ chối khớp nhiều lần, bash trả lỗi không ném kèm `exitCode`, glob/grep, pattern bắt đầu bằng `-`, shell và thư mục tạm theo nền tảng, Glob bỏ qua thư mục hệ thống và dừng khi bị huỷ, grep dừng khi bị huỷ |
| Input | Enter gửi, `\`+Enter xuống dòng, history, Ctrl+P/Ctrl+N, con trỏ nhiều dòng, paste |
| Phím | mũi tên khi escape bị tách, lăn chuột, click chuột trái, release/kéo/Shift+click bị bỏ qua, bracketed paste, tiếng Việt, Alt+phím (kể cả chữ hoa và ký tự ngoài ASCII) không bị nhầm thành Escape |
| Markdown | heading theo cấp, bullet, quote lồng nhau, khối code (thụt lề, cắt dòng, màu mặc định), bảng box-drawing, căn lề, thu hẹp, wrap, cặp surrogate, đậm/nghiêng/đậm nghiêng/gạch ngang |
| PILL.md | global + project, thư mục cha, file rỗng |
| Agent | system prompt: thư mục làm việc, thư mục tạm, 6 tool, các mục chính; prompt plan và lọc tool chỉ đọc |
| Cấu hình | đọc `PILL_MODE`/`mode`, chấp nhận build/plan, bỏ giá trị lạ |
| Trạng thái | đọc `statusLine`, lấy dòng đầu stdout, JSON gửi qua stdin (gồm `mode`), thư mục chạy, timeout, lệnh lỗi |
| Diff | nhận diện dòng thay đổi, thêm/bớt, giới hạn và đánh dấu truncated, hai chuỗi rỗng |
| UI | format token/thời gian/đường dẫn, đo độ rộng ANSI, hit-test chuột, phát hiện lệnh nguy hiểm, hộp duyệt `Edit`/`bash`/ghi đè (ngắt dòng lệnh dài), thẻ tool có thời gian và thống kê căn phải, header badge/thu gọn, footer tự bỏ số liệu phụ, ô nhập capsule, welcome đầy đủ/gọn, bảng hàng đợi giới hạn theo chiều cao |
| Tự duyệt | `canAutoApprove` cho mọi tool trừ lệnh nguy hiểm, hộp duyệt chỉ mời `Alt+M` khi được phép, badge `AUTO` trên header, footer hiện `tự duyệt mọi tool` |

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
| Welcome | Mở TUI khi chưa gửi gì — thấy tên phiên, mô tả và gợi ý lệnh |
| Header | Badge `PLAN`/`BUILD`, thư mục, nhánh git; thu gọn khi terminal hẹp |
| Chế độ | Bấm `Tab`: badge header đổi `PLAN`/`BUILD`, viền và tiêu đề prompt đổi màu, placeholder đổi; `/plan`, `/build`, `/mode` hoạt động. Đang chạy thì `Tab` bị bỏ qua |
| Plan chỉ đọc | Ở chế độ plan, model chỉ được cấp `Read`/`grep`/`Glob`; thử mock trả `Write` — phải thấy lỗi `bị khoá ở chế độ plan` và file không được tạo |
| Kích thước | Chạy ở 80×24 rồi kéo rộng 120×40 — không tràn footer, transcript tự co |
| Gõ nhanh không mất ký tự | Gõ liên tục 30+ ký tự |
| History | Gửi tin, bấm `↑` — phải hiện lại tin cũ, **không** hiện `^[[A` |
| Cuộn | `PageUp`/`PageDown`, lăn chuột; footer báo `↑ N dòng · PageDown` |
| Duyệt tool | Gửi "chạy lệnh", bấm `y`; thử `n`, `Esc`, và `d` để mở rộng |
| Diff khi duyệt | Mock trả `Edit` — hộp duyệt phải hiện `+N −M`, dòng thêm/xoá đúng màu |
| Thẻ tool | Sau khi chạy, thẻ hiện thời gian, số dòng/kết quả, `exit N` với bash |
| Mở rộng tool | Click tiêu đề thẻ hoặc `Ctrl+T`; marker đổi `▸`/`▾` |
| Thinking | Mock trả `reasoning_content`; click tiêu đề hoặc `Ctrl+O` để mở/đóng |
| Xếp hàng | Trong lúc agent chạy, gõ tin mới + Enter → bảng hàng đợi và `n tin chờ` ở footer; bấm `Esc`, lượt hiện tại dừng nhưng tin chờ vẫn chạy tiếp |
| Gợi ý lệnh | Gõ `/`, dùng `Tab`/`↑↓`, `Esc` đóng |
| Token | Footer hiện `↑N ↓N` sau mỗi lượt |
| Dòng trạng thái | Đặt `statusLine` trong `settings.json`, gửi một tin — footer phải hiện dòng đầu stdout của lệnh, spinner và `n tin chờ` vẫn nối sau |
| Markdown inline | Cho mock trả dòng có `` `code` ``, `**đậm**`, `*nghiêng*`, `***đậm nghiêng***`, `~~gạch ngang~~` — transcript phải tô đúng style và không còn dấu markdown |
| Markdown khối | Cho mock trả code fence có dòng thụt lề và dòng rất dài, tiêu đề `#`..`######`, quote `> > >` — code phải cắt đúng khung và không tô màu, sáu cấp tiêu đề phải khác nhau, quote phải hiện vạch theo cấp |
| Spinner | Gửi "chạy lệnh" rồi để hộp duyệt mở — footer phải đổi khung braille liên tục, dừng khi lượt kết thúc |

Mock chính chỉ trả text thường và tool `bash`. Muốn kiểm thinking hoặc diff, sửa tạm `test/mock-server.mjs` để trả `reasoning_content` hoặc tool call `Edit` (nhớ tạo file đích trước khi duyệt).

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
- **Giao diện**: ưu tiên `COLORS`/`GLYPHS` trong `src/ui/theme.ts`; không hardcode mã màu mới rải rác
- **Tool mới**: khai báo trong `createTools()`, xem [tools.md](tools.md#thêm-tool-mới)
- **Tool file**: giữ tên và tham số theo Claude Code (`Read`/`Write`/`Edit` dùng `file_path` tuyệt đối); tool ghi phải kiểm tra `ToolState.readFiles` trước khi đụng file đang có

## Gỡ lỗi

**TUI không render, không có output:**

Kiểm tra TTY — `main.tsx` từ chối chạy khi không phải terminal tương tác:

```bash
node -e "console.log(process.stdin.isTTY)"   # phải là true
```

**`^[[A` hiện trong prompt:**

Nghĩa là escape sequence không được parse. Kiểm tra `src/ui/useKeys.ts` — logic gộp byte bị tách nằm trong `parseInput()`.

**Click không mở/đóng thẻ:**

Chỉ dòng **tiêu đề** của thinking/tool nhận click; click vào thân hoặc item khác bị bỏ qua. Hộp duyệt đang mở sẽ chặn mọi click, và `Shift+click` được giữ cho chọn văn bản. Nếu dùng tmux/screen, bật chuyển tiếp chuột (`tmux set -g mouse on`) rồi thử lại; test `parseInput nhận diện click...` xác nhận parser đọc đúng SGR.

**Mất ký tự khi gõ nhanh:**

Kiểm tra các cặp state/ref trong `App.tsx`. Ref phải được cập nhật **đồng thời** với state (qua `applyInput`, `setBusySync`...), không qua `useEffect`.

**TUI giật khi stream:**

Kiểm tra `STREAM_FLUSH_MS` trong `App.tsx` (mặc định 60ms). Tăng nếu máy chậm.

**Lỗi API:**

Bật log bằng cách chạy trực tiếp:

```bash
PILL_API_KEY=... PILL_BASE_URL=... node dist/src/main.js 2>err.log
```

**Dòng trạng thái không hiện:**

Lệnh trong `statusLine` phải exit 0 và in **dòng đầu không rỗng** ra stdout trong vòng 5 giây. Lệnh lỗi, không in gì, hoặc quá hạn thì footer quay về dòng mặc định và không có thông báo lỗi — kiểm tra bằng cách chạy lệnh thủ công với JSON mẫu:

```bash
echo '{"version":"pill 1.0.0","model":"gpt-4o-mini","mode":"build","cwd":"/du-an","tokens":{"prompt":0,"completion":0},"busy":false,"queued":0}' | sh ~/.pill/statusline.sh
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
