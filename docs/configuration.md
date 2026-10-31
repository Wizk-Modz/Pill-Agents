# Cấu hình

## Thư mục cấu hình

PillAgents lưu cấu hình và phiên làm việc trong một thư mục riêng, tự xác định theo hệ điều hành:

| Hệ điều hành | Đường dẫn |
|---|---|
| Linux, macOS, Termux | `~/.pill` |
| Windows | `%USERPROFILE%\.pill` |

Ghi đè bằng biến `PILL_CONFIG_DIR`:

```bash
PILL_CONFIG_DIR=/path/to/config pill
```

Cấu trúc thư mục:

```
~/.pill/
├── settings.json          # cấu hình
├── PILL.md                # hướng dẫn chung cho mọi dự án
└── sessions/              # phiên tự động lưu
    └── 2026-10-17T14-30-00-000Z.json
```

## settings.json

```json
{
  "env": {
    "PILL_API_KEY": "sk-...",
    "PILL_BASE_URL": "https://api.openai.com/v1",
    "PILL_MODEL": "gpt-4o-mini",
    "PILL_MODE": "build",
    "PILL_MAX_STEPS": "25"
  }
}
```

Sao chép từ `settings.example.json` trong repo:

```bash
mkdir -p ~/.pill
cp settings.example.json ~/.pill/settings.json
```

> **Bảo mật:** `settings.json` chứa API key — không commit vào git. Nếu đặt trong thư mục dự án, thêm vào `.gitignore`.

## Biến môi trường

Thứ tự ưu tiên:

```
1. Biến môi trường thật (cao nhất)
2. settings.json → env
3. Giá trị mặc định
```

| Biến | Mặc định | Mô tả |
|---|---|---|
| `PILL_API_KEY` | — | API key (**bắt buộc**) |
| `PILL_BASE_URL` | `https://api.openai.com/v1` | Endpoint |
| `PILL_MODEL` | `gpt-4o-mini` | Model |
| `PILL_MODE` | `build` | Chế độ mặc định: `build` hoặc `plan` |
| `PILL_MAX_STEPS` | `25` | Số bước tool tối đa mỗi lượt |
| `PILL_CONFIG_DIR` | `~/.pill` | Thư mục cấu hình |

Fallback: nếu không có `PILL_API_KEY`, đọc tiếp `OPENAI_API_KEY`.

Cũng hỗ trợ file `.env` ở thư mục dự án khi chạy `npm start` (dùng `--env-file-if-exists`).

## PILL.md

File hướng dẫn được chèn vào system prompt, tương tự `CLAUDE.md`.

| Vị trí | Phạm vi |
|---|---|
| `~/.pill/PILL.md` | Mọi dự án |
| `PILL.md` ở thư mục cha | Dự án con |
| `PILL.md` ở thư mục làm việc | Riêng dự án đó |

Nạp theo thứ tự từ xa đến gần — file gần thư mục làm việc nhất có ưu tiên cao nhất trong prompt. File rỗng bị bỏ qua.

Nội dung được chèn kèm chỉ thị ưu tiên cao hơn hành vi mặc định:

```
Hướng dẫn của người dùng và dự án được nêu dưới đây. Tuân thủ nghiêm ngặt.
QUAN TRỌNG: những hướng dẫn này GHI ĐÈ hành vi mặc định, phải làm đúng như đã viết.

Contents of ~/.pill/PILL.md (hướng dẫn chung của người dùng cho mọi dự án):
...
Contents of /du-an/PILL.md (hướng dẫn của dự án):
...
```

### Ví dụ

`~/.pill/PILL.md` — sở thích cá nhân:

```markdown
# Quy tắc chung

- Trả lời bằng tiếng Việt.
- Không dùng emoji trong câu trả lời.
- Với thay đổi lớn, giải thích ngắn gọn trước khi làm.
```

`<dự-an>/PILL.md` — quy tắc dự án:

```markdown
# Quy tắc dự án

- Dùng pnpm, không dùng npm.
- Chạy `pnpm test` trước khi báo hoàn thành.
- Mọi hàm phải có một dòng comment mô tả chức năng.
- Không commit khi chưa được yêu cầu.
```

### Lưu ý

- Nạp **một lần** lúc tạo agent. Sửa file giữa phiên cần `/clear` mới có hiệu lực.
- Nội dung được tính vào context — viết ngắn gọn, chỉ nêu điều agent không tự suy ra được.
- Không hỗ trợ cú pháp `@file` để nhúng file khác.

## Lệnh trong phiên

| Lệnh | Tác dụng |
|---|---|
| `/plan` | Chuyển sang chế độ plan (chỉ đọc) |
| `/build` | Chuyển sang chế độ build (đầy đủ tool) |
| `/mode` | Xem chế độ hiện tại |
| `/clear` | Xoá hội thoại, nạp lại PILL.md và tắt tự duyệt bash |
| `/trust` | Xem trạng thái tự duyệt bash |
| `/trust on` / `/trust off` | Bật/tắt tự duyệt bash cho phần còn lại của phiên |
| `/model` | Xem model hiện tại |
| `/model <tên>` | Đổi model cho phiên này |
| `/effort` | Xem mức suy luận hiện tại |
| `/effort <mức>` | Đổi mức: `low`, `medium`, `high`, `xhigh`, `max` |
| `/help` | Xem phím tắt |
| `/exit`, `/quit` | Thoát |

Lệnh không nhận diện được sẽ báo `Lệnh không hỗ trợ: <tên>`.

Khi hộp duyệt đang mở: `y` chạy một lần, `n`/`Esc` từ chối, `d` mở rộng nội dung. Với lệnh `bash` thường, `a` bật tự duyệt mọi lệnh bash còn lại trong phiên; lựa chọn này không áp dụng cho `write_file`/`edit_file` và không áp dụng cho lệnh nguy hiểm (`rm`, `sudo`, force push, `curl | sh`…). Footer hiện `bash tự duyệt` khi bật; `/trust off` hoặc `/clear` tắt ngay.

## Chế độ plan và build

PillAgents có hai chế độ, lấy cảm hứng từ OpenCode:

| Chế độ | Tool được cấp | Hành vi |
|---|---|---|
| `build` | Cả 6 tool | Sửa file, chạy lệnh; tool ghi/exec vẫn cần duyệt |
| `plan` | `read_file`, `grep`, `glob` | Chỉ khảo sát và trả kế hoạch; không sửa file, không chạy lệnh |

Đổi chế độ bằng `Tab` khi agent đang rảnh, hoặc `/plan` / `/build`. Chế độ hiện tại hiện ở header (`PLAN`/`BUILD`) và trong dữ liệu gửi `statusLine`. Hội thoại, lịch sử và token được giữ nguyên khi đổi chế độ; `/clear` cũng không đổi chế độ.

Chế độ mặc định lấy theo thứ tự: `PILL_MODE` (biến môi trường hoặc `settings.json → env`) → `mode` ở cấp cao nhất của `settings.json` → `build`. Có thể đặt cho một lần chạy:

```bash
pill --mode plan
```

Hoặc trong `settings.json`:

```json
{
  "mode": "plan",
  "env": {
    "PILL_API_KEY": "sk-..."
  }
}
```

Ở chế độ plan, agent chốt danh sách tool tại đầu mỗi lượt. Nếu model vẫn gọi `write_file`, `edit_file` hoặc `bash`, agent trả lỗi `Tool ... bị khoá ở chế độ plan.` và không thực thi. Đổi chế độ giữa lượt đang chạy không có hiệu lực cho tới lượt sau.

## Token usage

Footer hiển thị token đã dùng trong phiên:

```
pill 1.0.0 · gpt-4o-mini · ↑1.2k ↓340
```

- `↑` — prompt token (nội dung gửi lên model)
- `↓` — completion token (nội dung model sinh ra)

Số liệu cộng dồn qua các lượt và các bước tool trong cùng phiên. `/clear` đặt lại về 0. Số từ 1000 trở lên được rút gọn (`1.2k`).

Cần endpoint trả `usage` khi `stream_options.include_usage` bật — hầu hết provider tương thích OpenAI đều hỗ trợ; nếu không, phần token tự ẩn.

## Dòng trạng thái tự cấu hình

Mặc định PillAgents tự dựng footer. Muốn hiển thị thông tin riêng, thêm `statusLine` vào `settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.pill/statusline.sh"
  }
}
```

Lệnh chạy lại khi trạng thái phiên đổi (model, effort, chế độ, token, đang xử lý, số tin chờ), gộp các lần đổi liền nhau trong 150ms. **Dòng đầu không rỗng** của stdout thay cho phần thông tin phiên tự dựng (`model · effort · token · số tool · thời gian`); phần spinner `đang xử lý` và `n tin chờ` vẫn nối phía sau. Mã màu ANSI trong stdout được giữ nguyên, nên script tự tô màu được.

Lệnh nhận JSON của phiên qua stdin:

| Trường | Ý nghĩa |
|---|---|
| `version` | Chuỗi phiên bản, ví dụ `pill 1.0.0` |
| `model` | Model đang dùng |
| `effort` | Mức suy luận, không có nếu chưa đặt |
| `mode` | `build` hoặc `plan` |
| `cwd` | Thư mục dự án |
| `tokens.prompt`, `tokens.completion` | Token đã dùng trong phiên |
| `busy` | Đang chạy lượt hay không |
| `queued` | Số tin đang xếp hàng |

Ví dụ `~/.pill/statusline.sh` (cần `jq`):

```sh
#!/bin/sh
payload=$(cat)
model=$(printf '%s' "$payload" | jq -r .model)
prompt=$(printf '%s' "$payload" | jq -r .tokens.prompt)
completion=$(printf '%s' "$payload" | jq -r .tokens.completion)
printf '\033[36m%s\033[0m · %s · ↑%s ↓%s\n' "$(basename "$(pwd)")" "$model" "$prompt" "$completion"
```

Đặt quyền chạy: `chmod +x ~/.pill/statusline.sh`.

### Lưu ý

- Lệnh chạy trong thư mục dự án, qua shell của nền tảng (`/bin/sh -c`, Windows `cmd.exe /d /s /c`) và có sẵn `TMPDIR`, `TMP`, `TEMP`.
- Lệnh lỗi, không in gì, hoặc chạy quá 5 giây → footer quay về dòng mặc định, không hiện thông báo lỗi.
- Chỉ dòng đầu được dùng; dòng dài hơn 500 ký tự bị cắt bớt.

## Chạy với provider khác

Mọi endpoint tương thích OpenAI đều dùng được — chỉ cần đổi `PILL_BASE_URL` và `PILL_MODEL`.

**DeepSeek:**

```json
{
  "env": {
    "PILL_API_KEY": "sk-...",
    "PILL_BASE_URL": "https://api.deepseek.com/v1",
    "PILL_MODEL": "deepseek-chat"
  }
}
```

DeepSeek phát `reasoning_content` — PillAgents hiển thị thành khối `✻ Suy nghĩ` và tự thu gọn sau khi xong.

**OpenRouter:**

```json
{
  "env": {
    "PILL_API_KEY": "sk-or-...",
    "PILL_BASE_URL": "https://openrouter.ai/api/v1",
    "PILL_MODEL": "anthropic/claude-sonnet-5-5"
  }
}
```

**Groq:**

```json
{
  "env": {
    "PILL_API_KEY": "gsk_...",
    "PILL_BASE_URL": "https://api.groq.com/openai/v1",
    "PILL_MODEL": "llama-3.3-70b-versatile"
  }
}
```

**Proxy nội bộ / self-hosted (Ollama, LM Studio, vLLM):**

```json
{
  "env": {
    "PILL_API_KEY": "không-cần-thật",
    "PILL_BASE_URL": "http://localhost:11434/v1",
    "PILL_MODEL": "qwen2.5-coder"
  }
}
```

Nếu proxy bỏ qua `stream: true` và trả JSON thường, PillAgents tự phát hiện và gọi lại không stream — vẫn hoạt động, chỉ không có hiệu ứng gõ dần.

## Phiên làm việc

Mỗi lượt tự động lưu vào `~/.pill/sessions/<timestamp>.json`, gồm model, chế độ, thư mục làm việc và toàn bộ hội thoại.

Lỗi khi lưu phiên không chặn agent — chỉ bỏ qua im lặng.

Chưa hỗ trợ khôi phục phiên (`--resume`); file lưu để tra cứu lại nội dung.

## Ưu tiên khi có nhiều nguồn cấu hình

Ví dụ cụ thể — `settings.json` đặt `gpt-4o-mini`, chạy lệnh với biến môi trường:

```bash
PILL_MODEL=gpt-5 pill      # dùng gpt-5, biến môi trường thắng
pill                        # dùng gpt-4o-mini từ settings.json
```
