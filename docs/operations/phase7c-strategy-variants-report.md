# Phase 7C — thử các hướng cải thiện chiến lược (walk-forward, offline)

> Nghiên cứu offline. Không đổi runtime, cấu hình hay lệnh nào. Dữ liệu MT5 gốc không commit.
> Bổ sung cho [báo cáo T3/T4](phase7c-management-sweep-report.md).

## Kết luận

- **Không hướng cải thiện nào đạt ngưỡng của phiếu giao việc.** Đã thử: tắt SIDEWAY, chỉ vào TREND khi BREAKOUT, siết độ tin cậy SIDEWAY, chặn spread cao, chỉ dùng SuperTrend M5 hoặc chỉ M15, nới hoặc tắt FastMove, bỏ chốt 1/3.
- Cách đánh giá duy nhất được dùng là walk-forward. Ở mỗi fold, biến thể được chọn trên dữ liệu train rồi chấm trên block kế tiếp chưa thấy. Gộp 6 fold test được PF 0,86, −1.155 USD, 3/6 fold dương. Ngưỡng của phiếu là PF > 1,20 và ít nhất 4/6 fold dương.
- Mọi biến thể cùng một khuôn: lỗ từ tháng 1 tới tháng 8/2026 (fold 1–4), có lãi ở hai block cuối (fold 5–6).
  - Vậy kết quả xấu không nằm ở phần quản lý lệnh hay ở một bộ lọc riêng lẻ nào. Nó nằm ở **lợi thế của tín hiệu vào lệnh**, và lợi thế đó thay đổi theo giai đoạn thị trường.
  - "Chỉ TREND BREAKOUT" trông tốt ở 4 tháng cuối (T4), nhưng qua walk-forward thì không ổn định. Đây là ví dụ của việc chỉnh tham số theo dữ liệu đã thấy.
- Chẩn đoán (cấu hình hiện tại, 12 tháng):
  - Lệnh thắng trung bình +1,25 R, lệnh thua trung bình −0,69 R, tỉ lệ thắng 32%.
  - 298/625 lệnh dính SL đầy đủ (trung bình −0,97 R).
  - Phần còn lại (sau khi chốt 1/3 ở +10) hầu như kết thúc bằng SL đã dời (BE, FastMove hoặc trail M5); rất ít lệnh thoát theo MA50 hay FVG.

## Biến thể chiến lược (quản lý lệnh giữ nguyên BE 6/0, SL 6–10, TP tắt)

| Biến thể | 12 tháng: lệnh / PF / USD / Max DD USD | Fold 1 USD | Fold 2 USD | Fold 3 USD | Fold 4 USD | Fold 5 USD | Fold 6 USD | Fold dương |
|---|---|---|---|---|---|---|---|---|
| V0_BASELINE — Hiện tại: TREND + SIDEWAY | 625 / 0.83 / -1189 / 1595 | -19 (PF 0.97) | -215 (PF 0.81) | -332 (PF 0.75) | -665 (PF 0.54) | 50 (PF 1.06) | 173 (PF 1.19) | 2/6 |
| V1_TREND_ONLY — Tắt SIDEWAY | 566 / 0.85 / -959 / 1461 | -59 (PF 0.92) | -201 (PF 0.81) | -354 (PF 0.73) | -521 (PF 0.59) | 64 (PF 1.08) | 280 (PF 1.37) | 2/6 |
| V2_TREND_BREAKOUT_ONLY — Chỉ TREND khi BREAKOUT | 520 / 0.84 / -1006 / 1452 | 53 (PF 1.09) | -137 (PF 0.85) | -375 (PF 0.70) | -599 (PF 0.52) | -52 (PF 0.93) | 312 (PF 1.45) | 2/6 |
| V3_SIDEWAY_CONF_75 — SIDEWAY cần độ tin cậy ≥75 | 580 / 0.84 / -1107 / 1533 | -72 (PF 0.90) | -201 (PF 0.81) | -377 (PF 0.71) | -544 (PF 0.58) | 54 (PF 1.07) | 202 (PF 1.24) | 2/6 |
| V4_TREND_ONLY_SPREAD_050 — Tắt SIDEWAY + spread vào lệnh ≤0,50 | 561 / 0.85 / -962 / 1461 | -28 (PF 0.96) | -173 (PF 0.83) | -412 (PF 0.68) | -521 (PF 0.59) | 64 (PF 1.08) | 276 (PF 1.37) | 2/6 |
| V6_ST_M5_ONLY — Chỉ SuperTrend M5 (tắt M15) | 790 / 0.80 / -1833 / 2139 | 43 (PF 1.05) | -367 (PF 0.75) | -466 (PF 0.72) | -573 (PF 0.65) | -66 (PF 0.95) | -77 (PF 0.94) | 1/6 |
| V7_ST_M15_ONLY — Chỉ SuperTrend M15 (tắt M5) | 775 / 0.87 / -1153 / 1619 | 27 (PF 1.03) | -377 (PF 0.75) | -372 (PF 0.77) | -624 (PF 0.63) | 105 (PF 1.09) | 86 (PF 1.08) | 3/6 |
| V5_BREAKOUT_SPREAD_050 — Chỉ TREND BREAKOUT + spread ≤0,50 | 515 / 0.84 / -1009 / 1468 | 84 (PF 1.14) | -109 (PF 0.88) | -433 (PF 0.65) | -599 (PF 0.52) | -52 (PF 0.93) | 308 (PF 1.45) | 2/6 |

Walk-forward chọn biến thể trên train, chấm trên block kế tiếp:
- Fold 1: chọn V7_ST_M15_ONLY (train PF 1.00) → test 80 lệnh, PF 1.03, 27 USD
- Fold 2: chọn V7_ST_M15_ONLY (train PF 1.02) → test 113 lệnh, PF 0.75, -377 USD
- Fold 3: chọn V7_ST_M15_ONLY (train PF 0.90) → test 136 lệnh, PF 0.77, -372 USD
- Fold 4: chọn V7_ST_M15_ONLY (train PF 0.85) → test 138 lệnh, PF 0.63, -624 USD
- Fold 5: chọn V7_ST_M15_ONLY (train PF 0.80) → test 123 lệnh, PF 1.09, 105 USD
- Fold 6: chọn V7_ST_M15_ONLY (train PF 0.84) → test 104 lệnh, PF 1.08, 86 USD

Gộp các fold test: {"trades":694,"netUsd":-1154.77,"profitFactor":0.857,"expectancyUsd":-1.664,"avgR":-0.064,"winRate":0.321,"maxDrawdownUsd":1618.66,"maxDrawdownR":66.87} | fold dương 3/6 | ngưỡng: {"tradesAtLeast30":true,"profitFactorAbove1_20":false,"expectancyPositive":false,"avgRPositive":false,"positiveFoldsAtLeast4of6":false}

**SuperTrend một khung (câu hỏi của chủ dự án):**
- Chỉ giữ M5 (tắt M15): 790 lệnh, PF 0,80, −1.833 USD, max DD 2.139 USD, 1/6 fold dương. Kém hơn rõ rệt.
- Chỉ giữ M15 (tắt M5): 775 lệnh, PF 0,87, −1.153 USD, max DD 1.619 USD, 3/6 fold dương. Gần như ngang cấu hình hiện tại (PF 0,83, −1.189 USD) nhưng nhiều lệnh hơn. Vẫn không đạt ngưỡng.

## Biến thể thoát lệnh (ngoài lưới T3)

| Biến thể | 12 tháng: lệnh / PF / USD / Max DD USD |
|---|---|
| FastMove 10/10 (hiện tại) | 625 / 0,83 / −1.189 / 1.595 |
| FastMove 15/15 | 615 / 0,86 / −1.001 / 1.312 |
| FastMove 20/20 | 612 / 0,85 / −1.058 / 1.339 |
| Không chốt 1/3 | 608 / 0,86 / −975 / 1.442 |
| Chốt 1/3 ở +15 + FastMove 20/20 | 596 / 0,84 / −1.127 / 1.456 |

Walk-forward trên 5 biến thể này: gộp các fold test được PF 0,82, −1.122 USD, 3/6 fold dương. **Không đạt.**

## Việc nên làm tiếp

1. **Chạy DEMO với cấu hình hiện tại theo [kế hoạch T6](phase7c-demo-test-plan.md)**, để đối chiếu mô phỏng với lệnh thật trước khi tin vào các con số trên.
2. Nếu muốn cải thiện thật sự, cần **nghiên cứu lại tín hiệu vào lệnh** (pattern M15 + SuperTrend). Đó là thay đổi chiến lược: cần phiếu và PR riêng, test đỏ trước, và đánh giá trên dữ liệu **mới** chưa dùng ở đây.

## Chạy lại

```bash
node scripts/backtest/phase7c-strategy-variants.mjs --m5 <M5.csv> --m15 <M15.csv> --cache .runtime/backtest/phase7c-replay-cache.json
```
