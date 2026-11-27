# Phase 7C Desktop Control

Desktop Control giữ Bridge và Web tách khỏi executor giao dịch:

- Mở shortcut `XAUUSD AI MASTER` sẽ khởi động Scheduled Task Bridge/Web khi cần và mở `/phase7c-control-center`.
- Bot không tự ARM khi chỉ mở giao diện.
- Nút `BẬT BOT` kiểm tra MT5 (DEMO, hoặc LIVE đã được cấp quyền trước), Algo Trading, zero XAUUSD position và lot đã lưu; khởi động ở `PAUSE`, chờ Trend/Sideway/Telegram/lot active cùng READY rồi mới chuyển `AUTO`.
- Telegram gửi panel khởi động ở `PAUSE`, sau đó gửi thông báo khi Web/API chuyển sang `AUTO`.
- Nút `DỪNG BOT` chuyển `PAUSE` trước; bị khóa khi còn vị thế XAUUSD để không bỏ lệnh đang được quản lý.
- Panel EA MT5 luôn read-only và giữ `ORDER PERMISSION = NONE`.

## Cài đặt trên Windows

Giữ Bot ở `PAUSE`, bảo đảm không có vị thế XAUUSD. Mở PowerShell **Administrator** trong đúng thư mục bot đã cài (thư mục mà task `XAUUSD-Phase7B-Web` dùng `.runtime`).

### Máy đang chạy bot (cài theo luồng cũ, có task `XAUUSD-Phase7B-Bridge`)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-phase7c-desktop-control-local.ps1 `
  -KeepExecutorStartup
```

### Máy mới cài bằng `install-phase7c-new-machine-local.ps1`

Bộ cài máy mới chỉ đăng ký task Bridge tên `XAUUSD-Phase7C-Bridge` và đã cài panel MT5 bằng file env LIVE, nên phải truyền tên task Bridge và bỏ qua bước cài lại panel:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-phase7c-desktop-control-local.ps1 `
  -KeepExecutorStartup `
  -BridgeTask XAUUSD-Phase7C-Bridge `
  -SkipMt5Panel
```

Shortcut Desktop sẽ mở đúng task Bridge/Web đã truyền ở trên.

**Luôn dùng `-KeepExecutorStartup`.** Nếu thiếu cờ này, script sẽ **tắt** task `XAUUSD-Phase7C-Executors` (lifecycle broker SYSTEM). Khi đó, sau khi khởi động lại máy, nút `BẬT BOT` bị từ chối vì broker không READY và bot giữ `PAUSE`. Xem [khởi động 1 chạm](operations/phase7c-one-click-start.md).

Kết quả đúng: `PHASE7C_DESKTOP_EXECUTOR_AUTOSTART=PRESERVED_BY_OPERATOR` và `PHASE7C_DESKTOP_INSTALL=PASS`. Sau đó mở shortcut và bấm `BẬT BOT` trên Control Center.

## Safety contract

Desktop/Web lifecycle chỉ hoạt động qua localhost Windows. API từ chối tài khoản LIVE chưa được cấp quyền trước, tài khoản contest, MT5 offline, Algo Trading tắt, Telegram chưa cấu hình hoặc có vị thế XAUUSD khi clean-start. Nếu startup không đạt READY trong thời hạn, hệ thống giữ `PAUSE` và dừng executor.
