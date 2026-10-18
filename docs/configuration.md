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
| `/clear` | Xoá hội thoại, nạp lại PILL.md |
| `/model` | Xem model hiện tại |
| `/model <tên>` | Đổi model cho phiên này |
| `/help` | Xem phím tắt |
| `/exit`, `/quit` | Thoát |

Lệnh không nhận diện được sẽ báo `Lệnh không hỗ trợ: <tên>`.

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

DeepSeek phát `reasoning_content` — PillAgents hiển thị thành khối `✻ Thinking`.

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

Mỗi lượt tự động lưu vào `~/.pill/sessions/<timestamp>.json`, gồm model, thư mục làm việc và toàn bộ hội thoại.

Lỗi khi lưu phiên không chặn agent — chỉ bỏ qua im lặng.

Chưa hỗ trợ khôi phục phiên (`--resume`); file lưu để tra cứu lại nội dung.

## Ưu tiên khi có nhiều nguồn cấu hình

Ví dụ cụ thể — `settings.json` đặt `gpt-4o-mini`, chạy lệnh với biến môi trường:

```bash
PILL_MODEL=gpt-5 pill      # dùng gpt-5, biến môi trường thắng
pill                        # dùng gpt-4o-mini từ settings.json
```
