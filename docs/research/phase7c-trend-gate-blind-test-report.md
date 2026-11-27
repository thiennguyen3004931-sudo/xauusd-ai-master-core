# Phase 7C — kiểm mù "cổng xu hướng + chỉ TREND" trên dữ liệu 2021–2023 (kết quả)

> Nghiên cứu offline. Không đổi runtime, cấu hình, BOT_MODE hay lệnh nào. Dữ liệu MT5 gốc không được commit.
> Kế hoạch khóa trước: [phase7c-trend-gate-blind-test-plan.md](phase7c-trend-gate-blind-test-plan.md) (commit `d8efa00`, trước khi chạy). Chỉ chạy một lần.

## Kết luận

- **Không đạt. Bỏ giả thuyết.**
  - Trên dữ liệu chưa ai xem (11/11/2021 → 24/11/2023): 244 lệnh, **PF 0,96**, −346 USD, R TB −0,02.
  - Chỉ **2/6 block dương**.
- Giả thuyết này đạt PF 1,32 trên 2026, nhưng không lặp lại ở 2021–2023. Nhiều khả năng lợi thế đó gắn với giai đoạn vàng tăng mạnh 2024–2026, chứ không phải lợi thế bền.
- Cổng vẫn **giảm lỗ** so với cấu hình hiện tại trên cùng đoạn: −346 USD so với −5.040 USD, max DD 2.276 USD so với 5.905 USD. Nhưng giảm lỗ chưa phải có lãi.
- Theo kế hoạch đã khóa: **không chỉnh lại tham số trên dữ liệu này, không đề xuất cấu hình DEMO từ giả thuyết này.**

## Ngưỡng nghiệm thu

| Tiêu chí | Kết quả | Đạt |
|---|---|---|
| Số lệnh ≥ 30 | 244 | ✅ |
| PF > 1,20 | 0,96 | ❌ |
| Expectancy > 0 và R TB > 0 | −1,42 USD, −0,02 R | ❌ |
| Block dương ≥ 4/6 | 2/6 | ❌ |
| Max DD | 2.276 USD / 31,6 R (cấu hình hiện tại: 5.905 USD / 82,6 R) | báo cáo |

## Theo block

Cột: lệnh / PF / USD.

| Block | Cổng + chỉ TREND | Cấu hình hiện tại |
|---|---|---|
| 11/11/2021 → 15/03/2022 | 44 / 1,36 / +611 | 123 / 0,88 / −548 |
| 15/03 → 16/07/2022 | 41 / 0,88 / −193 | 147 / 0,79 / −1.204 |
| 16/07 → 17/11/2022 | 46 / 0,88 / −200 | 135 / 0,79 / −1.156 |
| 17/11/2022 → 21/03/2023 | 45 / 0,62 / −744 | 153 / 0,91 / −482 |
| 21/03 → 23/07/2023 | 33 / 0,72 / −320 | 125 / 0,77 / −1.037 |
| 23/07 → 24/11/2023 | 35 / 1,43 / +500 | 113 / 0,85 / −612 |
| **Tổng** | **244 / 0,96 / −346** | **796 / 0,83 / −5.040** |

## Tham khảo (không dùng để quyết định)

- **Theo hướng:** BUY 127 lệnh, PF 1,01, +55 USD. SELL 117 lệnh, PF 0,91, −401 USD.
- **Theo regime:** BREAKOUT 213 lệnh, PF 0,93, −546 USD. TRENDING 31 lệnh, PF 1,18, +200 USD.
- **Hai nửa:** nửa đầu PF 1,04 (+219 USD). Nửa sau PF 0,87 (−565 USD).
- **Bỏ 5 lệnh lời nhất:** PF 0,84.
- **Kiểu thoát lệnh:** 121 lệnh dính SL ban đầu, 117 lệnh dừng ở SL sau BE, 6 lệnh thoát do FVG đảo chiều.
- **Chi phí xấu hơn:**

  | Kịch bản | PF | USD |
  |---|---|---|
  | Trượt giá 0,30 | 0,77 | −2.407 |
  | Phí 10 USD/lot | 0,95 | −434 |
  | Spread × 1,5 | 0,87 | −1.283 |
  | Cả ba | 0,75 | −2.593 |

## Dữ liệu

- File MT5 do chủ dự án xuất, từ 25/11/2020 đến 24/11/2023.
- Trước khoảng 10/11/2021, file M5/M15 chỉ chứa nến H1 lặp lại với spread 0. Đoạn này bị bỏ, theo kế hoạch đã khóa. Vì vậy đoạn chấm điểm chỉ dài khoảng 2 năm, không phải 3 năm.
- H1/H4 dùng toàn bộ để thư viện mẫu có lịch sử.

## Ý nghĩa cho dự án

- Qua 5 năm dữ liệu (2021–2026), luật vào lệnh TREND/SIDEWAY hiện tại lỗ trên cả hai bộ dữ liệu: PF 0,83 ở 2021–2023 và 0,89 ở 2023–2026.
- Cả quản lý lệnh (vòng 4) lẫn cổng xu hướng (lần kiểm mù này) đều không đưa PF lên trên 1,20 một cách bền vững.
- Không còn dữ liệu sạch nào trên broker này để thử ý tưởng mới. Ý tưởng tiếp theo phải chấm trên dữ liệu tương lai: shadow hoặc DEMO.

## Chạy lại

```bash
node scripts/backtest/phase7c-trend-gate-blind.mjs --m5 <M5.csv> --m15 <M15.csv> --h1 <H1.csv> --h4 <H4.csv> \
  --cache .runtime/backtest/blind-cache.json --out .runtime/backtest/blind.json
```
