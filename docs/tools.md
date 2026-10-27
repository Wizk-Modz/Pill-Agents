# Tool

Agent tương tác với hệ thống qua 6 tool. Mỗi tool khai báo schema tham số cho model, và cờ `needsApproval` quyết định có hỏi người dùng trước khi chạy.

## Bảng tổng hợp

| Tool | Cần duyệt | Tham số bắt buộc | Tham số tùy chọn |
|---|---|---|---|
| `read_file` | Không | `path` | `offset`, `limit` |
| `write_file` | **Có** | `path`, `content` | — |
| `edit_file` | **Có** | `path`, `old_string`, `new_string` | `replace_all` |
| `bash` | **Có** | `command` | `timeout` |
| `grep` | Không | `pattern` | `path`, `glob` |
| `glob` | Không | `pattern` | — |

Chỉ tool ghi hoặc thực thi mới cần duyệt; tool chỉ đọc chạy thẳng.

Ở chế độ `plan`, model chỉ được cấp `read_file`, `grep` và `glob`. Ba tool còn lại bị khoá; nếu model vẫn gọi, agent trả lỗi thay vì thực thi. Agent lọc tool ở cả danh sách gửi API lẫn lúc chạy, nên không thể vượt giới hạn bằng tool call tự phát.

## read_file

Đọc file kèm số dòng (định dạng `số_dòng\tNội dung`). Dùng `offset`/`limit` để đọc từng phần file dài.

```
path    Đường dẫn file (tuyệt đối hoặc tương đối theo thư mục làm việc)
offset  Dòng bắt đầu, tính từ 1 (mặc định 1)
limit   Số dòng tối đa (mặc định 2000)
```

Khi còn dòng chưa đọc, kết quả kèm `...[còn N dòng]`.

## write_file

Ghi đè **toàn bộ** nội dung file, tự tạo thư mục cha nếu chưa có.

```
path     Đường dẫn file
content  Nội dung đầy đủ
```

Dùng cho file mới. Với file đã có, `edit_file` an toàn hơn vì không ghi đè phần khác.

## edit_file

Thay chuỗi chính xác trong file. Bắt buộc khớp **duy nhất một lần** trừ khi `replace_all` bật.

```
path         Đường dẫn file
old_string   Chuỗi cần thay
new_string   Chuỗi thay thế
replace_all  Thay mọi lần xuất hiện (mặc định false)
```

Trường hợp lỗi:

| Tình huống | Thông báo |
|---|---|
| Không tìm thấy `old_string` | `Không tìm thấy "old_string" trong file.` |
| Khớp nhiều lần, chưa bật `replace_all` | `"old_string" xuất hiện N lần; thêm replace_all=true hoặc chuỗi cụ thể hơn.` |

Khi gặp lỗi khớp nhiều lần, model nên dùng chuỗi dài hơn (kèm ngữ cảnh xung quanh) thay vì bật `replace_all` — an toàn hơn.

## bash

Chạy lệnh shell trong thư mục làm việc.

```
command  Lệnh cần chạy
timeout  Timeout tính bằng giây (mặc định 120, tối đa 600)
```

Shell chọn theo nền tảng qua `resolveShell()`: `/bin/sh -c` trên Linux/macOS/Termux, `cmd.exe /d /s /c` trên Windows.

Tiến trình con luôn có `TMPDIR`, `TMP`, `TEMP` trỏ tới `os.tmpdir()` nếu môi trường cha chưa đặt (xem `childEnv()`) — Termux không có `/tmp` mà dùng `$PREFIX/tmp`.

Lệnh thoát khác 0 **không** ném lỗi mà trả `isError: true` kèm stdout/stderr — để model đọc được thông báo lỗi và tự sửa.

Output giới hạn 30.000 ký tự; vượt sẽ cắt và ghi `...[đã cắt bớt]`.

## grep

Tìm nội dung theo regex, trả về `đường_dẫn:số_dòng:nội_dung`.

```
pattern  Regex cần tìm
path     Thư mục hoặc file cần quét (mặc định ".")
glob     Lọc file, ví dụ "*.ts"
```

Dùng `ripgrep` nếu có trong máy; nếu không, tự động chuyển sang bản thuần Node (chậm hơn nhưng không cần cài thêm).

Giới hạn 200 kết quả.

## glob

Liệt kê file khớp pattern.

```
pattern  Glob pattern, ví dụ "**/*.ts"
```

Tự bỏ qua `node_modules`, `.git`, `dist`, `.next`, `target`, `vendor`. Giới hạn 200 kết quả, sắp xếp theo tên.

## Giới hạn chung

| Giới hạn | Giá trị | Lý do |
|---|---|---|
| Output tối đa | 30.000 ký tự | Tránh ngập context của model |
| Kết quả grep/glob | 200 mục | Tránh danh sách quá dài |
| Timeout bash | 600 giây | Chặn lệnh treo vô hạn |

## Thêm tool mới

Khai báo trong `createTools()` ở `src/tools.ts`:

```ts
{
  name: 'tên_tool',
  description: 'Mô tả ngắn cho model biết khi nào dùng.',
  needsApproval: true,          // true nếu tool ghi hoặc thực thi
  parameters: {
    type: 'object',
    properties: {
      tham_so: { type: 'string', description: 'Mô tả tham số' },
    },
    required: ['tham_so'],
  },
  run: (args, signal) => myTool(cwd, args, signal),
}
```

Hàm `run` nhận `args` (đã parse từ JSON) và `signal` (để huỷ khi người dùng bấm Esc). Trả về `{ content, isError? }`.

Nên viết test trong `test/tools.test.ts` — dùng `withTempDir()` để có thư mục tạm sạch.
