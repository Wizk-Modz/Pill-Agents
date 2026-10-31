# Tool

Agent tương tác với hệ thống qua 6 tool. Mỗi tool khai báo schema tham số cho model, và cờ `needsApproval` quyết định có hỏi người dùng trước khi chạy.

## Bảng tổng hợp

| Tool | Cần duyệt | Tham số bắt buộc | Tham số tùy chọn |
|---|---|---|---|
| `Read` | Không | `file_path` | `offset`, `limit` |
| `Write` | **Có** | `file_path`, `content` | — |
| `Edit` | **Có** | `file_path`, `old_string`, `new_string` | `replace_all` |
| `bash` | **Có** | `command` | `timeout` |
| `grep` | Không | `pattern` | `path`, `glob` |
| `Glob` | Không | `pattern` | `path` |

Chỉ tool ghi hoặc thực thi mới cần duyệt; tool chỉ đọc chạy thẳng.

Tên `Read`, `Write`, `Edit`, `Glob` và tham số `file_path` theo quy ước của Claude Code, để model đã quen với bộ tool đó không phải học lại cách gọi. `bash` và `grep` giữ nguyên.

## Đường dẫn tuyệt đối

`Read`, `Write`, `Edit` và `path` của `Glob` **bắt buộc** là đường dẫn tuyệt đối; đường dẫn tương đối bị từ chối kèm thông báo rõ. Nhờ vậy model không đoán sai thư mục gốc khi làm việc với nhiều dự án, và kết quả tool luôn nói rõ file nào đã bị đụng tới.

## Phải Read trước khi Write/Edit

Giống Claude Code, agent theo dõi những file đã `Read` trong phiên (`ToolState.readFiles`). `Write` và `Edit` từ chối file đang có mà chưa đọc lần nào:

```
Chưa đọc /du-an/src/a.ts trong phiên này; dùng Read trước khi ghi đè.
```

Đây là chốt chặn ghi đè mù: model không thể xoá nội dung file nó chưa từng thấy. Tạo file mới thì không cần `Read`. `/clear` xoá danh sách đã đọc cùng hội thoại.

## Duyệt tool

Hộp duyệt hiện `y` (chạy một lần), `n`/`Esc` (từ chối), `d` (mở rộng nội dung). Riêng lệnh `bash` thường có thêm `a`: bật tự duyệt mọi lệnh bash còn lại trong phiên, không hỏi lại từng lệnh. Lựa chọn này chỉ áp dụng cho `bash`, không áp dụng cho `Write`/`Edit`.

Các lệnh bị `isDangerousCommand()` đánh dấu — ví dụ `rm`, `sudo`, `git reset --hard`, force push, chạy script từ `curl | sh` — **luôn** mở hộp duyệt và không hiện `[a]`. `/trust on|off` xem hoặc đổi trạng thái tự duyệt; `/clear` cũng tắt. Khi bật, footer hiện `bash tự duyệt`.

Ở chế độ `plan`, model chỉ được cấp `Read`, `grep` và `Glob`. Ba tool còn lại bị khoá; nếu model vẫn gọi, agent trả lỗi thay vì thực thi. Agent lọc tool ở cả danh sách gửi API lẫn lúc chạy, nên không thể vượt giới hạn bằng tool call tự phát.

## Read

Đọc file kèm số dòng theo dạng `cat -n` (số dòng căn phải, tab, rồi nội dung). Dùng `offset`/`limit` để đọc từng phần file dài.

```
file_path  Đường dẫn tuyệt đối tới file
offset     Dòng bắt đầu, tính từ 1 (mặc định 1)
limit      Số dòng tối đa (mặc định 2000)
```

Dòng dài hơn 2000 ký tự bị cắt và đánh dấu `… [dòng bị cắt]` — một file minified không chiếm hết context. Khi còn dòng chưa đọc, kết quả kèm `...[còn N dòng]`. File rỗng trả `(file rỗng)`; đường dẫn là thư mục bị từ chối.

Mỗi lần `Read` thành công ghi đường dẫn vào danh sách đã đọc của phiên, mở khoá `Write`/`Edit` cho file đó.

## Write

Ghi đè **toàn bộ** nội dung file, tự tạo thư mục cha nếu chưa có.

```
file_path  Đường dẫn tuyệt đối tới file
content    Nội dung đầy đủ
```

Dùng cho file mới. Với file đã có, `Edit` an toàn hơn vì không ghi đè phần khác — và `Write` sẽ từ chối nếu file đó chưa được `Read` trong phiên.

## Edit

Thay chuỗi chính xác trong file. Bắt buộc khớp **duy nhất một lần** trừ khi `replace_all` bật.

```
file_path    Đường dẫn tuyệt đối tới file
old_string   Chuỗi cần thay
new_string   Chuỗi thay thế, phải khác old_string
replace_all  Thay mọi lần xuất hiện (mặc định false)
```

Trường hợp lỗi:

| Tình huống | Thông báo |
|---|---|
| File chưa được `Read` trong phiên | `Chưa đọc <đường dẫn> trong phiên này; dùng Read trước khi sửa.` |
| `new_string` trùng `old_string` | `"new_string" phải khác "old_string".` |
| Không tìm thấy `old_string` | `Không tìm thấy "old_string" trong file.` |
| Khớp nhiều lần, chưa bật `replace_all` | `"old_string" xuất hiện N lần; thêm replace_all=true hoặc chuỗi cụ thể hơn.` |

Khi gặp lỗi khớp nhiều lần, model nên dùng chuỗi dài hơn (kèm ngữ cảnh xung quanh) thay vì bật `replace_all` — an toàn hơn.

`new_string` được chèn nguyên văn: các ký tự đặc biệt của `String.replace` như `$&`, `$1`, `` $` `` hay `$'` không bị diễn giải.

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

## Glob

Liệt kê file khớp pattern.

```
pattern  Glob pattern, ví dụ "**/*.ts"
path     Thư mục gốc tuyệt đối (mặc định là thư mục làm việc)
```

Tự bỏ qua `node_modules`, `.git`, `dist`, `.next`, `target`, `vendor`. Giới hạn 200 kết quả, **sắp theo thời gian sửa mới nhất** (file vừa đụng hiện trước) — giống Claude Code. Trả đường dẫn tuyệt đối để dùng lại trực tiếp cho `Read`/`Edit`.

## Giới hạn chung

| Giới hạn | Giá trị | Lý do |
|---|---|---|
| Output tối đa | 30.000 ký tự | Tránh ngập context của model |
| Kết quả grep/Glob | 200 mục | Tránh danh sách quá dài |
| Dòng tối đa mỗi lần Read | 2000 dòng, 2000 ký tự/dòng | Giữ context cho phần còn lại |
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
  run: (args, signal) => myTool(args, state, signal),
}
```

Hàm `run` nhận `args` (đã parse từ JSON) và `signal` (để huỷ khi người dùng bấm Esc). Trả về `{ content, isError? }`.

Nên viết test trong `test/tools.test.ts` — dùng `withTempDir()` để có thư mục tạm sạch.
