# Changelog

Mọi thay đổi đáng chú ý của PillAgents được ghi ở đây. Định dạng theo
[Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo [SemVer](https://semver.org/lang/vi/).

Bản mới nhất ở trên cùng. Mỗi mục nói **người dùng thấy gì đổi**, không phải file nào bị sửa.

## Chưa phát hành

### Thêm

- System prompt viết lại theo mục, tham khảo cách Claude Code và OpenCode tổ chức: nhóm hướng dẫn theo giai đoạn công việc (**Chọn tool**, **Đọc và sửa file**, **Kiểm chứng**) thay vì trộn lẫn, và thêm quy tắc rõ cho việc bám phạm vi yêu cầu, báo cáo trung thực, hỏi trước thao tác khó hoàn tác
- Prompt tự nhận biết ngữ cảnh phiên: nền tảng (Linux/macOS/Windows), shell tương ứng, thư mục tạm thật của máy, và thư mục làm việc có phải git repo hay không — trước đây model phải đoán nên hay dùng `/tmp` trên Termux hoặc chạy `git status` trong thư mục không có git
- `CHANGELOG.md` (file này)

## 1.1.0

### Thêm

- Chế độ tự duyệt mọi tool: `Alt+M` bật/tắt bất kỳ lúc nào, kể cả khi agent đang chạy. `Write`, `Edit` và `bash` chạy ngay không hỏi; lệnh nguy hiểm như `rm`, `sudo`, force push vẫn luôn mở hộp duyệt. Header hiện badge `BUILD AUTO`, footer hiện `tự duyệt mọi tool`
- Lệnh `/auto on|off` thay cho `/trust` (giữ `/trust` làm bí danh)
- Tool đổi tên và tham số theo quy ước Claude Code: `Read`, `Write`, `Edit`, `Glob` dùng `file_path`; `bash` và `grep` giữ nguyên
- Đường dẫn tuyệt đối bắt buộc cho `Read`, `Write`, `Edit` và `path` của `Glob`. Đường dẫn tương đối bị từ chối kèm thông báo rõ
- Luật **phải Read trước khi Write/Edit**: file đang có mà chưa đọc trong phiên sẽ bị từ chối, chặn ghi đè mù. `/clear` xoá danh sách đã đọc
- `Read` cắt dòng dài hơn 2000 ký tự để file minified không chiếm hết context
- `Glob` nhận `path` để đổi thư mục gốc, sắp kết quả theo thời gian sửa mới nhất, trả đường dẫn tuyệt đối
- `Edit` từ chối khi `new_string` trùng `old_string`

### Sửa

- `Esc` dừng được tool đang chạy dở. Trước đây chỉ `bash` nhận tín hiệu huỷ, nên `Glob`/`grep` đang quét thư mục lớn thì `Esc` không có tác dụng và giao diện đứng ở trạng thái "đang xử lý"
- `Glob` quét từ thư mục lớn không còn treo: bỏ qua `node_modules`, `.git`, `dist` ngay từ đầu thay vì duyệt hết rồi lọc, và bỏ qua cả thư mục hệ thống (`proc`, `sys`, `dev`, `run`, `snap`). `**/CLAUDE.md` từ `/root` giảm từ hơn 20 giây xuống còn 2,2 giây
- `Glob` và `grep` có trần 10 giây: hết giờ trả kết quả đã tìm được kèm ghi chú `chưa quét hết` thay vì treo im lặng
- `Edit` giữ nguyên `new_string` chứa `$&`, `$1`, `` $` `` hay `$'` — trước đây bị `String.replace` diễn giải thành mẫu
- `grep` fallback trả lỗi thay vì ném khi regex hợp lệ với ripgrep nhưng không hợp lệ với JS

### Thay đổi

- Phiên bản đọc từ `package.json` qua `src/version.ts` thay vì hardcode
- Tài liệu, system prompt, icon thẻ tool và hộp duyệt cập nhật theo tên tool mới

## 1.0.0

Bản đầu tiên dùng được.

### Thêm

- Giao diện terminal dựng bằng Ink: header capsule, transcript markdown, thẻ tool có diff, footer trạng thái
- Agent loop gọi endpoint tương thích OpenAI qua SDK chính thức, hỗ trợ stream và `reasoning_content`
- 6 tool: đọc/ghi/sửa file, `bash`, `grep`, `glob`
- Hộp duyệt tool: `y` chạy, `n`/`Esc` từ chối, `d` xem đầy đủ, `a` tự duyệt `bash` cả phiên; lệnh nguy hiểm luôn hỏi
- Hai chế độ `build` và `plan`, đổi bằng `Tab`; `plan` chỉ cấp tool đọc
- Nạp `PILL.md` global và theo cây thư mục vào system prompt
- Hàng đợi tin nhắn: gõ trong lúc agent chạy thì xếp hàng và tự chạy tiếp
- Lệnh gạch chéo: `/plan`, `/build`, `/mode`, `/clear`, `/trust`, `/model`, `/effort`, `/help`, `/exit`
- `statusLine` tự cấu hình bằng lệnh shell, nhận JSON phiên qua stdin
- Render markdown: tiêu đề, danh sách, quote lồng, khối code, bảng box-drawing, đậm/nghiêng/gạch ngang
- Cuộn bằng lăn chuột, `PageUp`/`PageDown`, `Shift+↑`/`Shift+↓`; click tiêu đề để mở/đóng khối
- Lưu phiên vào `~/.pill/sessions/`
- Cấu hình từ `~/.pill/settings.json` và biến môi trường
