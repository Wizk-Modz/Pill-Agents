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
| `src/main.tsx` | Điểm vào: nạp config, tạo agent, mở TUI | 38 |
| `src/config.ts` | Đọc `settings.json` và biến môi trường | 60 |
| `src/instructions.ts` | Nạp `PILL.md` global + project | 64 |
| `src/types.ts` | Kiểu dữ liệu dùng chung | 24 |
| `src/llm.ts` | Gọi API qua SDK `openai`, xử lý streaming | 131 |
| `src/tools.ts` | 6 tool: đọc/ghi/sửa file, bash, grep, glob | 240 |
| `src/agent.ts` | Vòng lặp agent, quản lý hội thoại, lưu phiên | 220 |
| `src/ui/App.tsx` | Màn hình chính, xử lý phím, xếp hàng tin nhắn | 493 |
| `src/ui/InputBox.tsx` | Ô nhập nhiều dòng, logic con trỏ, history | 254 |
| `src/ui/useKeys.ts` | Parse phím thô từ stdin | 246 |
| `src/ui/markdown.ts` | Render markdown thành chuỗi ANSI | 363 |
| `src/ui/Transcript.tsx` | Chuyển item hội thoại thành dòng hiển thị | 122 |

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

Hỗ trợ: heading, bullet, numbered, quote, code fence, bảng box-drawing, inline (bold/italic/code/link).

Bảng dùng ký tự `┌┬┐ ├┼┤ └┴┘`, căn lề theo dấu `:` trong dòng phân cách, tự thu hẹp cột khi hẹp màn hình.

## Cache dòng

Transcript dài → render lại toàn bộ sẽ chậm. Mỗi item được render một lần và cache theo `id`:

```ts
const cached = cache.get(String(item.id));
if (!cached) { cache.set(key, itemToLines(item, columns)); }
```

Cache bị xoá khi: đổi độ rộng terminal, tool có kết quả mới, toggle thinking.

## Cấu hình

Thứ tự ưu tiên (cao → thấp):

```
1. Biến môi trường (PILL_API_KEY, ...)
2. settings.json → env
3. Giá trị mặc định
```

Thư mục cấu hình tự xác định qua `homedir()`: `~/.pill` trên Linux/macOS/Termux, `%USERPROFILE%\.pill` trên Windows. Ghi đè bằng `PILL_CONFIG_DIR`.

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
