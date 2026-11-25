# Phase 7C — khởi động 1 chạm, không tự chạy khi mở máy

Mục tiêu: khi Windows khởi động hoặc khi bạn đăng nhập, **không có gì của bot tự chạy**. Bạn bấm một biểu tượng trên màn hình để mở hệ thống. Bot chỉ chạy khi bạn bấm **BẬT BOT**.

## Những gì đã có sẵn trong repo

- `scripts/install-phase7c-desktop-control-local.ps1` tạo biểu tượng **XAUUSD AI MASTER** trên Desktop.
- Biểu tượng này chạy `scripts/open-phase7c-control-center-local.ps1`:
  - khởi động task Bridge và Web nếu chúng chưa chạy;
  - chờ Control Center sẵn sàng rồi mở trình duyệt.
- Bot **không** tự chạy (`PHASE7C_DESKTOP_BOT_AUTOSTART=FALSE`). Bot chỉ chạy khi bạn bấm nút BẬT BOT trên Control Center, qua đầy đủ các cổng an toàn hiện có.

Điểm còn thiếu: các task Bridge, Web, Executors, Account Bridge và Forward Dashboard vẫn có trigger **AtLogOn** hoặc **AtStartup**, nên vẫn tự chạy khi mở máy.

## Mới: `scripts/set-phase7c-manual-start-only-local.ps1`

Script này gỡ trigger AtStartup và AtLogOn khỏi các task XAUUSD của bot:

- `XAUUSD-Phase7B-Bridge`, `XAUUSD-Phase7B-Web`
- `XAUUSD-Phase7C-Executors`, `XAUUSD-Phase7C-Bridge`, `XAUUSD-Phase7C-Forward-Dashboard`
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
   .\scripts\install-phase7c-desktop-control-local.ps1
   ```
6. Khởi động lại máy để kiểm tra. Sau khi đăng nhập, **không có** cửa sổ hay task XAUUSD nào tự chạy. Bấm biểu tượng **XAUUSD AI MASTER**: Control Center mở ra, và bot vẫn đứng yên cho tới khi bạn bấm BẬT BOT.

## Khôi phục như cũ

```powershell
.\scripts\set-phase7c-manual-start-only-local.ps1 -Restore -BackupDir .runtime\task-trigger-backups\<thời điểm>
```

## Giới hạn

- Script chỉ đổi các task đã được cài trên máy. Nếu cài máy mới bằng `install-phase7c-new-machine-local.ps1` hay các installer khác, các installer này vẫn đăng ký trigger AtLogOn hoặc AtStartup như trước. Sau khi cài, chạy lại script này với `-Apply`.
- Bản thân MT5 terminal có tự mở khi đăng nhập hay không là do cài đặt của Windows và MT5, không thuộc repo.
- Nếu task dùng kiểu đăng nhập có mật khẩu, Windows có thể đòi mật khẩu khi khôi phục bằng `-Restore`.
