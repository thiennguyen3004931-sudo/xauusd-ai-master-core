# Phase 7C — khởi động 1 chạm, không tự chạy khi mở máy

Mục tiêu: khi Windows khởi động hoặc khi bạn đăng nhập, **không có gì của bot tự chạy**. Bạn bấm một biểu tượng trên màn hình để mở hệ thống. Bot chỉ chạy khi bạn bấm **BẬT BOT**.

## Những gì đã có sẵn trong repo

- `scripts/install-phase7c-desktop-control-local.ps1` tạo biểu tượng **XAUUSD AI MASTER** trên Desktop.
- Biểu tượng này chạy `scripts/open-phase7c-control-center-local.ps1`:
  - khởi động task Bridge và Web nếu chúng chưa chạy;
  - chờ Control Center sẵn sàng rồi mở trình duyệt.
- Bot **không** tự chạy (`PHASE7C_DESKTOP_BOT_AUTOSTART=FALSE`). Bot chỉ chạy khi bạn bấm nút BẬT BOT trên Control Center, qua đầy đủ các cổng an toàn hiện có.

Điểm còn thiếu: các task Bridge, Web, Account Bridge và Forward Dashboard vẫn có trigger **AtLogOn** hoặc **AtStartup**, nên vẫn tự chạy khi mở máy.

**Ngoại lệ bắt buộc: `XAUUSD-Phase7C-Executors` (lifecycle broker SYSTEM) giữ nguyên trigger AtStartup.** Đây là dịch vụ an toàn chạy ngầm và tự nó không vào lệnh. Nút BẬT BOT cần broker này ở trạng thái READY. Biểu tượng Desktop không khởi động được task SYSTEM, và mọi kiểm tra ownership/readiness đều coi việc thiếu trigger khởi động là lỗi `TRIGGER`. Nếu gỡ trigger này thì sau khi khởi động lại máy, BẬT BOT sẽ bị từ chối và bot giữ PAUSE.

## Mới: `scripts/set-phase7c-manual-start-only-local.ps1`

Script này gỡ trigger AtStartup và AtLogOn khỏi các task XAUUSD của bot:

- `XAUUSD-Phase7B-Bridge`, `XAUUSD-Phase7B-Web`
- `XAUUSD-Phase7C-Bridge`, `XAUUSD-Phase7C-Forward-Dashboard`
- không gồm `XAUUSD-Phase7C-Executors`: script in `KEEP_BOOT_TRIGGER_REQUIRED` và bỏ qua task này
- các task cũ `XAUUSD-Phase7B-Bot`, `XAUUSD-Phase7B-Core`, `XAUUSD-Phase7B-Telegram`, nếu máy còn

Các task này **vẫn được giữ và vẫn bật**, chỉ không còn tự chạy. Biểu tượng trên Desktop vẫn khởi động được chúng khi bạn bấm.

Script an toàn ở các điểm sau:

- **Mặc định chỉ chạy thử (dry run):** in ra những gì sẽ đổi, không đổi gì.
- **Sao lưu trước khi đổi:** xuất XML của từng task vào `.runtime\task-trigger-backups\<thời điểm>\` trước khi sửa, nên khôi phục được.
- **Không sửa task đang chạy:** nếu một task đang chạy thì bỏ qua task đó và báo `TASK_RUNNING`.
- **Không dừng, xoá hay tắt task nào.** Không đụng tới BOT_MODE, LIVE ARM, tài khoản, lệnh hay vị thế.
- Phải mở PowerShell bằng quyền Administrator.

## Cách dùng (chủ dự án tự chạy trên máy bot)

1. Trên Control Center: chuyển sang **PAUSE**, kiểm tra không còn lệnh XAUUSD nào đang mở, rồi tắt bot. Đóng Control Center.
2. Mở PowerShell bằng quyền **Administrator** trong thư mục repo.
3. Chạy thử:
   ```powershell
   .\scripts\set-phase7c-manual-start-only-local.ps1
   ```
   Xem các dòng `PHASE7C_MANUAL_START_TASK=...|REMOVE=Logon` hoặc `REMOVE=Boot`.
4. Nếu đúng như mong đợi, áp dụng:
   ```powershell
   .\scripts\set-phase7c-manual-start-only-local.ps1 -Apply
   ```
   - Kết quả mong đợi: `PHASE7C_MANUAL_START_MODE=APPLIED|CHANGED=<n>|BLOCKED=0`.
   - Nếu `BLOCKED` lớn hơn 0 thì còn task đang chạy. Tắt task đó (bước 1) rồi chạy lại.
5. Nếu thấy dòng `PHASE7C_MANUAL_START_DESKTOP_SHORTCUT=MISSING_...`, chạy thêm:
   ```powershell
   .\scripts\install-phase7c-desktop-control-local.ps1 -KeepExecutorStartup
   ```
   Luôn kèm `-KeepExecutorStartup`. Máy cài bằng bộ cài máy mới thì thêm `-BridgeTask XAUUSD-Phase7C-Bridge -SkipMt5Panel` ([chi tiết](../phase7c-desktop-control.md)).
6. Khởi động lại máy để kiểm tra. Sau khi đăng nhập, **không có** cửa sổ hay task XAUUSD nào tự chạy. Bấm biểu tượng **XAUUSD AI MASTER**: Control Center mở ra, và bot vẫn đứng yên cho tới khi bạn bấm BẬT BOT.

## Nếu đã chạy `-Apply` bằng bản script cũ

Bản đầu tiên của script (PR #225) có gỡ cả trigger AtStartup của `XAUUSD-Phase7C-Executors`. Nếu bạn đã chạy `-Apply` bằng bản đó, hãy trả lại trigger cho riêng task này. Chạy PowerShell Administrator khi bot đang tắt và ở PAUSE:

```powershell
.\scripts\set-phase7c-manual-start-only-local.ps1 -Restore -BackupDir <thư mục backup tạm chỉ chứa XAUUSD-Phase7C-Executors.xml>
```

Cách làm: tạo một thư mục mới, rồi chép riêng file `XAUUSD-Phase7C-Executors.xml` từ `.runtime\task-trigger-backups\<thời điểm>\` vào thư mục đó. Sau đó chạy lệnh trên với thư mục mới, để các task khác vẫn giữ chế độ chạy tay. Kiểm tra lại bằng `.\scripts\verify-phase7c-executor-startup-task-local.ps1`.

## Cài máy mới: tùy chọn `-ManualStartOnly`

`install-phase7c-new-machine-local.ps1 ... -ManualStartOnly` đăng ký task Web (`XAUUSD-Phase7B-Web`) và Account Bridge (`XAUUSD-Phase7C-Bridge`) **không có trigger AtLogOn**. Installer vẫn khởi động hai task này một lần trong lúc cài để chạy kiểm tra chấp nhận. Sau khi khởi động lại máy, chúng chỉ chạy khi bạn bấm biểu tượng Desktop. Lifecycle broker vẫn giữ AtStartup như trên. Cuối cùng installer in ra `PHASE7C_NEW_MACHINE_START_MODE=MANUAL_ONLY_DESKTOP_SHORTCUT`. Khi không có `-ManualStartOnly`, installer giữ đúng hành vi cũ (`AT_LOGON`).

## Khôi phục như cũ

```powershell
.\scripts\set-phase7c-manual-start-only-local.ps1 -Restore -BackupDir .runtime\task-trigger-backups\<thời điểm>
```

## Giới hạn

- Script chỉ đổi các task đã được cài trên máy. Khi cài máy mới bằng `install-phase7c-new-machine-local.ps1`, hãy dùng `-ManualStartOnly`. Các installer cũ khác vẫn đăng ký trigger như trước, nên sau khi cài bằng chúng, chạy lại script này với `-Apply`.
- Bản thân MT5 terminal có tự mở khi đăng nhập hay không là do cài đặt của Windows và MT5, không thuộc repo.
- Nếu task dùng kiểu đăng nhập có mật khẩu, Windows có thể đòi mật khẩu khi khôi phục bằng `-Restore`.
