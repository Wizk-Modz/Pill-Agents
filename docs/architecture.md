# Kiến trúc

Tài liệu này mô tả cách PillAgents vận hành bên trong: luồng dữ liệu, trách nhiệm từng module và lý do các quyết định thiết kế.

## Tổng quan

```
main.tsx  →  Agent  →  streamChat  →  API (OpenAI-compatible)
              ↓
           tools[]  →  file system / shell
              ↓
      AgentHandlers  →  App (Ink TUI)
```

Một lượt (turn) bắt đầu khi người dùng gửi tin nhắn và kết thúc khi model trả lời mà không gọi tool nào nữa, hoặc khi bị huỷ.

## Các module

| File | Trách nhiệm | Dòng |
|---|---|---|
| `src/main.tsx` | Điểm vào: nạp config, tạo agent, mở TUI | 144 |
| `src/config.ts` | Đọc `settings.json` và biến môi trường | 101 |
| `src/instructions.ts` | Nạp `PILL.md` global + project | 64 |
| `src/types.ts` | Kiểu dữ liệu dùng chung | 30 |
| `src/llm.ts` | Gọi API qua SDK `openai`, xử lý streaming | 153 |
| `src/tools.ts` | 6 tool: đọc/ghi/sửa file, bash, grep, glob | 259 |
| `src/agent.ts` | Vòng lặp agent, quản lý hội thoại, lưu phiên | 243 |
| `src/statusline.ts` | Chạy lệnh statusLine trong `settings.json` | 70 |
| `src/ui/App.tsx` | Màn hình chính, xử lý phím, xếp hàng tin nhắn | 649 |
| `src/ui/InputBox.tsx` | Ô nhập nhiều dòng, logic con trỏ, history | 264 |
| `src/ui/useKeys.ts` | Parse phím thô từ stdin | 246 |
| `src/ui/markdown.ts` | Render markdown thành chuỗi ANSI | 408 |
| `src/ui/Transcript.tsx` | Chuyển item hội thoại thành dòng hiển thị | 129 |
| `src/ui/commands.ts` | Gợi ý lệnh gạch chéo khi gõ `/` | 27 |

## Luồng một lượt

```
1. App.submit(text)
   ├─ đang bận?  → push vào queue, hiện "⏳ n chờ"
   └─ rảnh       → runTurn(text)

2. Agent.send(text, signal, handlers)
   push message user vào hội thoại
   lặp tối đa PILL_MAX_STEPS lần:
     a. streamChat()  → phát text/thinking qua handlers
     b. push message assistant vào hội thoại
     c. không có tool call?  → kết thúc lượt
     d. có tool call → runToolCalls()
          - tool cần duyệt? → handlers.approve() chờ người dùng
          - chạy tool, push kết quả vào hội thoại
     e. quay lại (a)

3. finally: lưu phiên ra ~/.pill/sessions/<timestamp>.json
```

**Điểm quan trọng:** mọi tool call trong một lượt đều phải có kết quả ghi vào hội thoại, kể cả khi bị huỷ. API yêu cầu mỗi `tool_call` phải có message `tool` tương ứng, nếu thiếu thì lượt sau sẽ lỗi.

Lượt xong, App lấy tin kế tiếp trong hàng đợi và đưa lại qua `submit()` — nên lệnh gạch chéo xếp hàng vẫn được thực thi như lệnh, không bị gửi cho model như tin nhắn thường.

## Quản lý state trong App

React state dùng cho render, nhưng sự kiện bàn phím đến bất đồng bộ nên cần bản sao trong `ref` để tránh đọc giá trị cũ. Các cặp `state`/`ref` được cập nhật **đồng thời tại chỗ ghi**, không qua `useEffect`:

```ts
const setBusySync = (value: boolean) => {
  busyRef.current = value;   // cho handler đọc ngay
  setBusy(value);            // cho render
};
```

Lý do: nếu chỉ dùng `useEffect(() => { ref.current = state }, [state])`, khi gõ nhanh nhiều ký tự trong cùng một frame, ref sẽ bị ghi đè bằng giá trị cũ và **mất ký tự**.

Các cặp tương tự: `inputRef`/`input`, `pendingRef`/`pendingApproval`, `scrollRef`/`scrollTop`.

## Streaming và throttle

Model phát về hàng trăm chunk nhỏ. Nếu `setState` mỗi chunk, Ink phải render lại liên tục và TUI giật.

Giải pháp: gom text vào `textRef` (không gây render), chỉ đẩy vào state mỗi 60ms:

```ts
const scheduleFlush = () => {
  if (flushTimer.current) return;
  flushTimer.current = setTimeout(() => {
    setStreaming(textRef.current);
  }, STREAM_FLUSH_MS);   // 60ms
};
```

Cuối lượt gọi `flushNow()` để không mất phần text còn lại.

## Đếm token

`streamChat()` bật `stream_options: { include_usage: true }`, nên chunk cuối của stream chứa thống kê token. Các chunk khác có `usage: null`.

```ts
if (chunk.usage) {
  usage = {
    promptTokens: chunk.usage.prompt_tokens,
    completionTokens: chunk.usage.completion_tokens,
    totalTokens: chunk.usage.total_tokens,
  };
}
```

Agent gọi `handlers.onUsage(usage)` sau **mỗi** lần gọi model — một lượt có tool call sẽ gọi API nhiều lần, nên token được cộng dồn qua các bước. App giữ tổng tích luỹ của phiên, hiển thị ở footer dạng `↑42 ↓7` (`formatTokens()` rút gọn số ≥ 1000 thành `1.2k`).

`/clear` đặt lại về 0.

Nếu proxy không trả `usage` (một số proxy cũ), `usage` là `undefined` và footer ẩn phần token — không gây lỗi.

## Dòng trạng thái

Footer có hai chế độ, chọn theo `statusLine` trong `settings.json`:

- Chưa cấu hình: App tự dựng dòng `pill 0.1.0 · model · effort` kèm token.
- Đã cấu hình: `runStatusLine()` chạy lệnh của người dùng và lấy dòng đầu của stdout.

`statusSignature` là chuỗi gộp các giá trị ảnh hưởng tới dòng trạng thái (lệnh, model, effort, token, đang bận, số tin chờ). Effect chạy lại khi chuỗi này đổi, gộp các lần đổi liền nhau bằng debounce 150ms; cách này tránh phải đưa cả object vào danh sách phụ thuộc, và `/model` hay `/effort` cũng kích hoạt làm mới vì chúng nằm trong chuỗi.

Lệnh nhận JSON của phiên qua stdin (`StatusLineInput`) nên script tự quyết định hiển thị gì. `runStatusLine()` chạy lệnh qua shell của nền tảng, trong thư mục dự án, kèm `childEnv()` giống tool `bash`. Lệnh lỗi, không in gì hoặc quá 5 giây đều trả `undefined` → App quay về dòng mặc định, không có thông báo lỗi nào hiện ra.

Phần spinner `đang xử lý (Esc huỷ)` và `⏳ n chờ` luôn được nối sau dòng trạng thái vì đây là thông tin người dùng cần thấy ngay. Spinner dùng bộ khung braille (`SPINNER_FRAMES`, đổi khung mỗi 120ms) để thấy rõ máy vẫn đang chạy. Khung hình spinner **không** nằm trong `statusSignature`, nên lệnh statusLine không bị chạy lại theo nhịp quay.

Chuỗi ANSI trong stdout được giữ nguyên: `<Text>` của Ink render mã màu, nên script tự tô màu được.

## Parse phím

Ink có sẵn `useInput` nhưng có 2 vấn đề:

1. **Escape sequence bị tách**: terminal có thể gửi `\x1b` rồi `[A` thành hai lần `data` riêng biệt, `useInput` hiểu `[A` là text → hiện literal `^[[A`.
2. **Không nhận chuột**: Ink không bật mouse tracking.

`src/ui/useKeys.ts` thay thế bằng parser riêng:

- Buffer dữ liệu vào, tìm escape sequence khớp; nếu chuỗi là **tiền tố** của sequence hợp lệ (ví dụ mới có `\x1b`) thì chờ thêm, hết 60ms mới kết luận
- Bật SGR mouse `\x1b[?1000h\x1b[?1006h` và alternate scroll `\x1b[?1007h` khi mount, tắt khi unmount
- Nhận bracketed paste `\x1b[200~...\x1b[201~`

Phát ra 4 loại sự kiện: `key`, `text`, `paste`, `wheel`.

## Render markdown

Hai tầng:

1. **Parse** (`markdown.ts`): markdown → `Segment[][]`, mỗi dòng là mảng segment có style
2. **Paint**: segment → chuỗi ANSI (`\x1b[1;36m...\x1b[0m`)

Ink hỗ trợ ANSI trong `<Text>`, nên mỗi dòng chỉ cần **một** `<Text>` thay vì lồng nhiều `<Text>` cho từng style — giảm mạnh số node React.

Hỗ trợ: heading, bullet, numbered, quote, code fence, bảng box-drawing, inline (code, link, đậm `**x**`, nghiêng `*x*`, đậm nghiêng `***x***`, gạch ngang `~~x~~`, và dạng gạch dưới `__x__`, `_x_`, `___x___`).

Dấu nhấn chỉ mở/đóng khi không sát khoảng trắng (nên `2 * 3 * 4` giữ nguyên dấu sao), và gạch dưới phải đứng ngoài từ (nên `snake_case_name`, `PILL_MAX_STEPS` không bị in nghiêng).

Tiêu đề theo cấp, mờ dần từ H1 tới H6: H1 đậm + gạch chân cyan, H2 đậm cyan, H3 đậm xanh dương, H4 đậm trắng, H5 đậm xám, H6 mờ xám. Dấu `#` không hiện trong transcript.

Khối code giữ đúng thụt lề và để màu chữ mặc định (hợp mọi theme), mở đầu mỗi dòng bằng vạch `│ ` xám mờ; dòng dài bị cắt theo đúng độ rộng khung, dòng trống trong khối vẫn giữ.

Quote lồng nhau đếm số dấu `>` để thêm vạch theo cấp (`│ │ │ `), từ cấp hai trở đi vạch bị làm mờ.

Bảng dùng ký tự `┌┬┐ ├┼┤ └┴┘`, căn lề theo dấu `:` trong dòng phân cách, tự thu hẹp cột khi hẹp màn hình.

## Cache dòng

Transcript dài → render lại toàn bộ sẽ chậm. Mỗi item được render một lần và cache theo `id`:

```ts
const cached = cache.get(String(item.id));
if (!cached) { cache.set(key, itemToLines(item, columns)); }
```

Cache bị xoá khi: đổi độ rộng terminal (kiểm tra ngay trong `useMemo`, vì `useEffect` chạy sau khi memo đã đọc cache cũ), tool có kết quả mới, toggle thinking.

## Cấu hình

Thứ tự ưu tiên (cao → thấp):

```
1. Biến môi trường (PILL_API_KEY, ...)
2. settings.json → env
3. Giá trị mặc định
```

Thư mục cấu hình tự xác định qua `homedir()`: `~/.pill` trên Linux/macOS/Termux, `%USERPROFILE%\.pill` trên Windows. Ghi đè bằng `PILL_CONFIG_DIR`.

## Nền tảng

Không hardcode đường dẫn POSIX:

- Shell của tool `bash` chọn theo nền tảng qua `resolveShell()`: `/bin/sh -c` trên Linux/macOS/Termux, `cmd.exe /d /s /c` trên Windows.
- Thư mục tạm luôn lấy từ `os.tmpdir()` (biến `$TMPDIR`), không mặc định `/tmp` — Termux dùng `$PREFIX/tmp`. Tiến trình con của `bash` được bổ sung `TMPDIR`/`TMP`/`TEMP` khi môi trường cha thiếu (`childEnv()`).
- `buildSystemPrompt()` nêu thư mục tạm thật của máy cho model, để model không tự đoán `/tmp`.

## System prompt dựng sẵn

`buildSystemPrompt()` dựng prompt nền theo 5 mục, viết tiếng Việt và gắn với thư mục làm việc:

| Mục | Nội dung |
|---|---|
| Môi trường | Vai trò, cơ chế duyệt tool, kết quả tool là dữ liệu (cảnh giác prompt injection), thư mục tạm thật của máy, shell theo nền tảng |
| Cách làm việc | Hành động khi đã đủ thông tin, bám phạm vi, xử lý yêu cầu mơ hồ, báo cáo trung thực, hỏi trước việc khó hoàn tác, không commit hay push khi chưa được yêu cầu |
| Tool đang có | Tool nào cần duyệt, gọi song song khi độc lập, đọc trước khi sửa, chạy build/lint/test sau khi sửa |
| Viết code | Giống code xung quanh, không mở rộng phạm vi, không abstraction sớm, không code chết, không thêm dependency |
| Trả lời | Ngắn gọn, markdown có nhãn ngôn ngữ, tham chiếu `đường_dẫn:dòng`, không thuật lại suy nghĩ nội bộ |

Prompt nền đứng trước phần PILL.md nạp ở mục dưới, nên quy tắc riêng của dự án luôn thắng.

## PILL.md

Nạp một lần lúc tạo agent, chèn vào cuối system prompt:

```
~/.pill/PILL.md                    ← hướng dẫn chung
<thư mục gốc>/PILL.md              ← từ thư mục cha
<thư mục dự án>/PILL.md            ← gần nhất, nạp sau cùng
```

Kèm chỉ thị ưu tiên cao hơn hành vi mặc định. Sửa PILL.md giữa phiên cần `/clear` mới có hiệu lực.

## Ghi chú về SDK

`streamChat()` bọc SDK `openai`. Hai điểm SDK không tự lo:

- **`reasoning_content`** (DeepSeek/OpenRouter) không có trong type chuẩn → đọc qua cast, SDK không strip field lạ
- **Proxy bỏ qua `stream: true`** trả JSON thường → SDK trả stream rỗng, client phát hiện (`chunks === 0`) và gọi lại không stream

Retry do SDK lo: 2 lần, exponential backoff.
