# Phase 7C — Chế độ backtest lịch sử (người vận hành tự chạy)

> Chạy offline trên file CSV xuất từ MT5. **Không** kết nối MT5, **không** gửi/sửa/đóng lệnh,
> **không** đọc hay ghi trạng thái runtime của bot, không đổi BOT_MODE / LIVE ARM.
> Có thể chạy trên máy cá nhân; không cần chạy trên máy đang chạy bot.

## 1. Xuất dữ liệu từ MT5

1. MT5 → `View` → `Symbols` → chọn `XAUUSD` (đúng tên symbol của broker) → tab `Bars`.
2. Chọn `M5`, khoảng ngày cần kiểm tra → `Request` → `Export Bars` → lưu `XAUUSD_M5.csv`.
3. Lặp lại với `M15`, **cùng khoảng ngày** → `XAUUSD_M15.csv`.
4. Nên lấy ít nhất 3 tháng. Regime cần 320 nến M15 khởi động (≈ 3,3 ngày giao dịch) nên phần đầu dữ liệu không có lệnh.

Không commit file CSV vào git. Thư mục `.runtime/backtest/` và `backtest-data/` đã nằm trong `.gitignore`.

## 2. Chuẩn bị một lần

```
pnpm install
pnpm build
```

## 3. Chạy

Cấu hình hiện tại (BE +6 → entry, SL 6–10, TP cố định tắt, lot 0,12 như TREND thật):

```
pnpm backtest --m5 D:\data\XAUUSD_M5.csv --m15 D:\data\XAUUSD_M15.csv
```

Thử cấu hình khác, giới hạn khoảng ngày, chỉ TREND:

```
pnpm backtest --m5 XAUUSD_M5.csv --m15 XAUUSD_M15.csv --be 8 --be-offset 1 --tp 30 --from 2026-06-01 --to 2026-11-01 --strategies TREND
```

Khi cấu hình khác baseline, báo cáo tự chạy thêm baseline trên cùng dữ liệu để so sánh.

| Tham số | Ý nghĩa | Mặc định | Cho phép |
|---|---|---|---|
| `--be` | Ngưỡng hoà vốn (giá) | 6 | 4–15 |
| `--be-offset` | SL về entry + offset | 0 | 0–3, nhỏ hơn `--be` |
| `--sl-cap` | SL ban đầu tối đa | 10 | 6–20 |
| `--tp` | TP cố định | off | off hoặc 5–100 |
| `--lot` | Khối lượng cố định | 0,12 | 0,01–1, bội số 0,01 |
| `--strategies` | Chiến lược | TREND,SIDEWAY | TREND và/hoặc SIDEWAY |
| `--from` / `--to` | Chỉ tính lệnh vào trong khoảng ngày (giờ server MT5) | toàn bộ | YYYY-MM-DD |
| `--commission` | Phí USD/lot khứ hồi | 7 | 0–100 |
| `--slippage` | Trượt giá mỗi lần khớp thị trường / SL | 0,10 | 0–5 |
| `--min-spread-points` | Spread tối thiểu mỗi nến (point) | 0 (dùng spread MT5) | 0–500 |
| `--out` | Thư mục báo cáo | `.runtime/backtest/backtest-<thời gian>` | |

Lần chạy đầu tính regime cho toàn bộ dữ liệu (≈ 3 ms/nến M15, 1 năm ≈ 1–2 phút) và lưu cache.
Các lần sau với cùng file CSV chỉ mất vài giây.

## 4. Đọc báo cáo

Thư mục `--out` có:

- `report.html`: mở bằng trình duyệt. Ô tổng quan, đường vốn, bảng BUY/SELL, theo chiến lược, regime, tháng, lý do đóng lệnh.
- `report.md`: cùng nội dung dạng Markdown.
- `report.json`: số liệu đầy đủ.
- `trades.csv`: từng lệnh mô phỏng (mở bằng Excel).

Chỉ số: số lệnh, tỷ lệ thắng, profit factor (PF), lãi/lỗ ròng USD, kỳ vọng USD/lệnh và R trung bình,
max drawdown bằng USD và R. R = rủi ro ban đầu của lệnh tính bằng USD (kể cả phí).

## 5. Giả định mô phỏng (thận trọng)

- STOP_FIRST: trong một nến, SL đang có hiệu lực được kiểm tra trước TP và mọi hành động phía lãi.
- Vào lệnh ở giá mở nến M5 kế tiếp (ASK cho BUY, BID cho SELL) cộng trượt giá.
- Spread theo từng nến MT5; phí theo lot; trượt giá khi vào lệnh, dính SL và đóng theo thị trường.
- Luật quản lý: BE, chốt 1/3 ở +10 (TREND), FastMove 10/10, trail M5, thoát FVG ngược / MA50 — dùng chung
  bộ mô phỏng `phase7c-management-sim.mjs` của sweep T3/T4.

Không mô phỏng: daily recovery / RECOVERY_TP, lệnh REVERSAL, cổng spread / độ tươi dữ liệu của runtime,
stop/freeze level của broker, lot SIDEWAY theo rủi ro 1% (backtest dùng lot cố định cho cả hai chiến lược).

## 6. Giới hạn khi đọc kết quả

- Một lần backtest trên toàn bộ dữ liệu là **trong mẫu**. Muốn chọn tham số, dùng sweep có out-of-sample và
  walk-forward: `node scripts/backtest/phase7c-management-sweep.mjs` (xem `phase7c-management-sweep-report.md`).
- Backtest không phải bằng chứng sinh lời và không đủ để bật LIVE. Theo phiếu giao việc: DEMO ≥ 30 lệnh trước.
- Báo cáo không bao giờ tự đổi cấu hình bot. Muốn đổi, mở PR riêng và chờ chủ dự án duyệt.

## 7. Chạy trên web (trang Backtest, dùng được trên điện thoại)

Trang `/backtest` (menu **Kỹ thuật → Backtest kiểm chứng**) chạy cùng bộ mô phỏng này với các công tắc:

| Nhóm | Công tắc / tham số | Mặc định (= bot đang chạy) |
|---|---|---|
| SL ban đầu | SL tối đa 6–20 | 10 |
| Hoà vốn | bật/tắt, khi đạt +4..15, SL = entry + 0..3 | bật, +6, +0 |
| TP cố định | bật/tắt, 5–100 | tắt |
| Chốt một phần (TREND) | bật/tắt, mốc +4..30, tỷ lệ 1/4 · 1/3 · 1/2 | bật, +10, 1/3 |
| FastMove | bật/tắt, kích hoạt A, lùi B | bật, 10/10 |
| Dời SL theo cấu trúc M5 | bật/tắt | bật |
| Thoát phần còn lại theo FVG ngược / MA50 | bật/tắt | bật |
| Chi phí | phí/lot, trượt giá, spread tối thiểu | 7 · 0,10 · 0 |

Khi tắt chốt một phần, mốc +10 vẫn được dùng để bắt đầu dời SL M5 và xét thoát runner, chỉ là không đóng khối lượng.
Khi cấu hình khác bot đang chạy, trang tự chạy thêm cấu hình đang chạy trên cùng dữ liệu để so sánh.

Chuẩn bị một lần trên máy chạy API:

1. Đặt `XAUUSD_M5.csv` và `XAUUSD_M15.csv` (xuất từ MT5) vào `backtest-data/` ở thư mục repo
   (hoặc đặt biến `PHASE7C_BACKTEST_DATA_DIR`). Tên kiểu `XAUUSD.G_M5_....csv` cũng được nhận.
2. Chạy `pnpm backtest --m5 backtest-data/XAUUSD_M5.csv --m15 backtest-data/XAUUSD_M15.csv` một lần để tạo cache regime
   (3 năm dữ liệu ≈ 1,5 phút CPU; nên chạy khi bot PAUSE hoặc trên máy khác rồi chép cache sang).

An toàn: API chỉ đọc CSV và cache, chạy trong worker thread (một lần chạy mỗi lúc, tối đa 90 giây), không import broker,
không ghi file, không đổi BOT_MODE / LIVE ARM / lot. API chỉ có `GET /api/v1/phase7c/offline-backtest/status` và
`POST /api/v1/phase7c/offline-backtest/run`; yêu cầu có tham số lạ bị từ chối.

Không mô phỏng thêm: dời SL theo swing M15 (chỉ có cấu trúc M5).
