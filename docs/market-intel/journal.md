# Nhật ký lệnh và hiệu quả theo loại thị trường (chức năng 1, phần C1)

Phần này ghi lại mọi lệnh đã đóng của bot cùng bối cảnh thị trường lúc vào lệnh, rồi thống kê kết quả.
Đây là nền dữ liệu cho phần C2 (đề xuất thay đổi có duyệt). Phần C1 **không đề xuất và không đổi gì**.

## Bật / tắt

| Biến môi trường (API) | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `ZIQ_MARKET_INTEL_JOURNAL_ENABLED` | tắt | Chỉ giá trị `true` mới bật. Khi tắt, API không đọc lệnh, không đọc nến, không tạo file. |
| `ZIQ_MARKET_INTEL_JOURNAL_PATH` | `.runtime/market-intel/market-intel.sqlite` | Vị trí file nhật ký (đã nằm trong `.gitignore`). Nếu có `PHASE7C_RUNTIME_ROOT` thì mặc định là `<root>/market-intel/market-intel.sqlite`. |

Cần Node 22.5 trở lên (dùng `node:sqlite` có sẵn, không thêm thư viện).

## Dữ liệu lấy từ đâu

- **Lệnh**: tái sử dụng Phase 7C Performance Intelligence hiện có (đọc lịch sử deal MT5 chỉ đọc, chỉ lệnh `SYSTEM`
  TREND/SIDEWAY, kèm regime, loại entry và mức khớp nối với nhật ký quyết định). Không dựng lại PnL.
- **Bối cảnh**: 1000 nến H4 và 1000 nến H1 lấy bằng GET từ MT5 bridge. Mỗi lệnh được gắn trạng thái của thư viện mẫu
  (Uptrend / Downtrend / Sideway / Chuyển tiếp) **chỉ từ các nến đã đóng trước giờ vào lệnh**, và nhãn
  cùng xu hướng / ngược xu hướng. Lệnh cũ hơn dữ liệu nến có trạng thái "Không rõ".

## Đồng bộ

- Nút **Đồng bộ** trên trang `/market-intel` gọi `POST /api/v1/market-intel/journal/sync`.
- Chỉ cho phép từ máy local (loopback) hoặc khi có token vận hành `x-phase7c-token`, giống các thao tác vận hành khác.
- Đồng bộ chỉ ghi vào file nhật ký. Chạy lại nhiều lần không tạo trùng (cập nhật theo mã position).
- Mỗi lần đồng bộ ghi một dòng vào `audit_log`. Bảng này chỉ được thêm, không sửa, không xoá (chặn bằng trigger SQLite).

## Thống kê

`GET /api/v1/market-intel/journal` trả về, cho toàn bộ và theo từng nhóm (loại thị trường, cùng/ngược xu hướng,
regime của bot, chiến lược × loại thị trường, chiều lệnh):

- số lệnh, winrate, PF, kỳ vọng mỗi lệnh, lãi/lỗ ròng;
- **R:R thực tế** = lãi trung bình / lỗ trung bình (lịch sử deal không lưu SL ban đầu nên chưa tính được R theo SL);
- chuỗi thua dài nhất;
- nhãn **"chưa đủ mẫu"** cho nhóm dưới 30 lệnh. Nhóm như vậy không được dùng để đề xuất thay đổi ở C2.

## Bảng trong file SQLite

| Bảng | Nội dung |
| --- | --- |
| `trades` | Bản sao lệnh đã đóng + bối cảnh thư viện mẫu lúc vào lệnh. |
| `mtf_scenarios` | Chỗ lưu kịch bản H4→H1→M15 (C2 sẽ ghi vào để chấm kết quả về sau). |
| `audit_log` | Nhật ký thao tác, chỉ thêm. |

Phiên bản lược đồ lưu ở `PRAGMA user_version` (hiện là 1). Code cũ hơn file sẽ từ chối mở thay vì ghi đè.

## An toàn

- Không gửi, sửa, đóng lệnh; không đổi BOT_MODE, LIVE ARM, tài khoản, cấu hình chiến lược hay runtime.
- Không có đường dẫn nào tới execution engine / mt5-broker (kiểm tra tĩnh trong test).
- Số liệu ở đây là mô tả quá khứ, không phải bằng chứng chiến lược có lãi.
