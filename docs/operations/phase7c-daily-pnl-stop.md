# Phase 7C — Giới hạn lỗ / lãi trong ngày

Chủ dự án tự đặt mức lỗ tối đa và mức lãi mục tiêu cho mỗi ngày. Khi P/L trong ngày chạm một trong hai mức, bot **không mở lệnh mới** cho tới hết ngày giao dịch, rồi tự chạy lại sang ngày mới.

## Mặc định

- **TẮT.** Không có file cấu hình, hoặc `enabled=false`, thì bot chạy đúng như trước.
- Không đổi BOT_MODE, LIVE ARM, lot, SL/BE/TP hay bất kỳ cổng an toàn nào.
- **Không đóng lệnh đang mở.** Lệnh đang mở vẫn được quản lý bình thường (SL, BE, chốt 1/3, FastMove, trailing).

## Cách đặt

Màn hình **Vận hành** → thẻ **Giới hạn lỗ / lãi trong ngày**:

| Ô | Ý nghĩa |
|---|---|
| Bật giới hạn ngày | Bật/tắt cả hai mức |
| Đơn vị | `USD`, hoặc `%` số dư đầu ngày |
| Lỗ tối đa trong ngày | Ví dụ 100 USD hoặc 3 %. Để trống = không dùng |
| Lãi mục tiêu trong ngày | Ví dụ 150 USD hoặc 5 %. Để trống = không dùng |

- Bật thì phải có ít nhất một mức. Giới hạn: USD tối đa 1.000.000; % tối đa 50.
- Lưu được bất cứ lúc nào, áp dụng ngay cho lệnh mới, không cần khởi động lại bot.
- Chỉ lưu được từ localhost (hoặc có `PHASE7C_BOT_MODE_TOKEN`), giống các thao tác điều khiển khác.

API: `GET /api/v1/phase7c/daily-pnl-stop` (cấu hình + trạng thái hôm nay), `POST /api/v1/phase7c/daily-pnl-stop` với `{ expectedVersion, source: "web-control-center", enabled, unit, dailyLossLimit, dailyProfitTarget }`.

File cấu hình: `PHASE7C_DAILY_PNL_STOP_FILE`, nếu không đặt thì `PHASE7C_RUNTIME_ROOT/phase7c-daily-pnl-stop.json`, rồi `PHASE7B_DEMO_WORK_DIR/../phase7c-daily-pnl-stop.json`, cuối cùng `<thư mục chạy>/.runtime/phase7c-daily-pnl-stop.json`. File nằm trong `.runtime`, không commit.

## Cách tính

- **Ngày giao dịch:** nến D1 hiện tại của XAUUSD trên MT5, tức nửa đêm theo **giờ server broker** (không phải giờ Việt Nam). Cùng nguồn với Daily Recovery: `/v1/session/day-boundary/XAUUSD`.
- **P/L trong ngày** = lãi/lỗ đã chốt của mọi deal XAUUSD từ đầu ngày (đã trừ phí, commission, swap; tính cả lệnh tay/SEMI, không chỉ lệnh bot) **+** lãi/lỗ đang chạy của các vị thế XAUUSD đang mở.
- Lãi/lỗ đã chốt lấy từ **canonical deal ledger** của API (cùng nguồn với Daily Recovery và trang Hiệu quả).
- **Đơn vị %:** số dư đầu ngày = số dư hiện tại − lãi/lỗ đã chốt XAUUSD hôm nay. Nếu trong ngày có nạp/rút tiền hoặc giao dịch mã khác, con số này lệch tương ứng.
- **Chạm lỗ:** P/L ≤ −mức lỗ. **Chạm lãi:** P/L ≥ mức lãi.

## Bot làm gì khi chạm mức

- TREND và SIDEWAY kiểm tra ngay trước khi gửi lệnh mới. Nếu bị chặn: ghi journal `ENTRY_DAILY_PNL_STOP_BLOCK` (lý do, P/L, ngưỡng) và bỏ tín hiệu đó.
- Thẻ trên giao diện hiện **CHẠM LỖ NGÀY · BOT NGHỈ** hoặc **ĐẠT LÃI NGÀY · BOT NGHỈ**.
- Sang nến D1 mới, P/L về 0 và bot tự vào lệnh lại nếu có tín hiệu.
- **SEMI:** người vận hành tự vào lệnh nên bot không chặn được lệnh tay. Lệnh tay vẫn được tính vào P/L ngày, và bot vẫn quản lý lệnh được nhận như bình thường. Thẻ trạng thái để người vận hành tự quyết.

## An toàn khi lỗi (fail closed)

| Tình huống | Khi TẮT | Khi BẬT |
|---|---|---|
| File cấu hình hỏng | Chặn lệnh mới (`CONFIG_INVALID`); lưu lại trên giao diện để sửa | Chặn lệnh mới |
| Không đọc được MT5/ledger/ranh giới ngày | Chạy như cũ | Chặn lệnh mới (`DATA_UNAVAILABLE`) |
| Controller không gọi được API | Chạy như cũ | Chặn lệnh mới |
| Controller thấy BẬT nhưng API báo TẮT (đọc khác file) | — | Chặn lệnh mới, báo lệch đường dẫn |

## Chưa kiểm chứng

- Chưa chạy trên MT5 thật hay DEMO; chỉ có unit test, test hợp đồng nguồn và build.
- Chưa có cảnh báo Telegram riêng khi chạm mức (hiện chỉ có journal và thẻ trên giao diện).
- Chưa có giới hạn tuần.
