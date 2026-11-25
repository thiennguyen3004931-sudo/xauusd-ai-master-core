# Repo công khai và self-hosted runner trên máy bot

Ngày rà soát: 25/11/2026. Phạm vi: chỉ source, CI và cấu hình GitHub. Không đụng runtime, BOT_MODE, LIVE ARM, tài khoản hay lệnh.

## Rủi ro

Runner `xauusd-core-ci` (self-hosted, Windows) chạy trên chính máy đang chạy bot, có quyền đọc `F:\Project\XAUUSD_AI_MASTER\xauusd-ai-master`, `.runtime` và API cục bộ `127.0.0.1:3711`.

Khi repo ở chế độ public, bất kỳ ai cũng có thể fork và mở pull request. Trước bản sửa này có 46 job self-hosted chạy theo `pull_request` mà không có điều kiện chặn fork. Một PR từ fork có thể chạy code tùy ý trên máy bot.

## Đã sửa trong code

1. Mọi job self-hosted có trigger `pull_request` giờ mang điều kiện cấp job:
   `github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`.
   PR từ nhánh trong chính repo vẫn chạy như cũ; PR từ fork bị bỏ qua (skipped) trên self-hosted.
2. `scripts/security/check-self-hosted-fork-guard.mjs` (kèm test) chặn mọi workflow mới thiếu điều kiện trên, và cấm `pull_request_target`, `workflow_run`.
3. Workflow `security-public-repo-ci.yml` chạy trên `ubuntu-latest` (không bao giờ chạm máy bot): kiểm tra fork guard, quét secret toàn bộ lịch sử mọi nhánh bằng gitleaks 8.24.2 (có kiểm checksum), đối chiếu với `security/credential-remediation.json`.

## Giới hạn quan trọng

Với `pull_request`, GitHub đọc file workflow từ chính nhánh của PR. Một fork cố ý có thể sửa file workflow để bỏ điều kiện chặn. Vì vậy điều kiện trong YAML chỉ là lớp phòng thủ thứ hai. Lớp chặn thật sự là cài đặt GitHub bên dưới.

## Việc chủ repo cần tự làm trên GitHub

Theo thứ tự ưu tiên:

1. **Chuyển repo về Private** (Settings → General → Danger Zone → Change visibility). `security/repository-boundary.json` của chính repo này khai báo mặc định `PRIVATE_REQUIRED`; repo `-core` được thiết kế là bản private. Đây là cách duy nhất chặn hoàn toàn fork PR và giữ kín logic chiến lược.
2. Nếu vẫn để public: Settings → Actions → General → "Fork pull request workflows from outside collaborators" → chọn **Require approval for all external contributors**.
3. Settings → Actions → General → Workflow permissions → **Read repository contents and packages permissions** (mặc định chỉ đọc cho `GITHUB_TOKEN`).
4. Settings → Branches → bảo vệ `main`: bắt buộc PR, bắt buộc check `security-public-repo` xanh, cấm force-push.
5. Lâu dài: tách runner CI sang một máy/VM riêng không có quyền vào thư mục production và MT5. Máy bot chỉ nên chạy bot.
6. Settings → Code security: bật **Secret scanning** và **Push protection**.
7. Issue #28 (monitor AUTO LIVE) đang công khai trạng thái ACCOUNT_MODE, ARM, số vị thế. Không có số tài khoản hay mật khẩu, nhưng nên khóa hoặc chuyển sang repo private.

## Kết quả quét

- gitleaks 8.24.2 trên 3.173 commit của mọi nhánh: 18 phát hiện, tất cả là giả (khóa giả trong test, chuỗi mô tả `BEGIN PRIVATE KEY` trong tài liệu, SHA commit). Đã ghi vào ledger với trạng thái `FALSE_POSITIVE_REVIEWED`.
- Không thấy mật khẩu MT5, token Telegram hay khóa API thật trong code và lịch sử.
- Một số đăng nhập dạng 7 chữ số (`5201362`) nằm trong test fixture SEMI; đã thay bằng số giả `900001`. Nếu đó là số tài khoản thật, nó vẫn còn trong lịch sử git.
- Log Actions công khai của các workflow đọc production (mẫu gần nhất của 10 workflow) không in số tài khoản, server, balance hay equity.
