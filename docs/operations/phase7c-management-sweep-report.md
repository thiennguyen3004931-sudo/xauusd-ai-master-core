# Phase 7C — T3/T4: quét tham số quản lý lệnh, out-of-sample và walk-forward

> Báo cáo nghiên cứu, chạy offline. Không gửi, sửa hay đóng lệnh nào. Không đổi runtime.
> Dữ liệu MT5 gốc (`XAUUSD.G` M5 + M15, 12 tháng) **không** commit. Chạy lại bằng lệnh ở cuối báo cáo.

## Kết luận

- **Không cấu hình nào trong 108 cấu hình đạt ngưỡng của phiếu giao việc.** Vì vậy T5 **không đề xuất đổi cấu hình DEMO**: giữ BE +6 → entry, SL 6–10, TP cố định tắt.
- Cấu hình hiện tại lỗ trên 12 tháng: PF 0,83, −1.189 USD ở 0,03 lot, max DD 1.595 USD (63 R).
  - In-sample (8 tháng đầu): PF 0,77.
  - Out-of-sample (4 tháng cuối): PF 0,99, gần hoà vốn.
- Đổi BE, offset, SL tối đa hay TP cố định **không cứu được kết quả**.
  - Ứng viên ổn định nhất chọn trên in-sample là BE10/OFF0/SL10/TPoff. Trên out-of-sample nó còn kém hơn cấu hình hiện tại (PF 0,95), và chỉ 1/6 fold walk-forward có lãi.
  - Nới SL tối đa lên 12 hay 15 làm kết quả xấu đi ở mọi tổ hợp.
- Ngay cả khi bỏ phí và trượt giá (chỉ giữ spread), cấu hình hiện tại vẫn chỉ đạt PF 1,07 trên out-of-sample. Ứng viên cũng không đạt. Lợi thế gộp (trước chi phí) rất mỏng.
- Điểm yếu tập trung ở **SIDEWAY** (out-of-sample PF 0,45, nhất là SIDEWAY/SELL PF 0,21) và **TREND/SELL trong in-sample** (PF 0,64).
  - TREND trong regime BREAKOUT là phần duy nhất dương trên out-of-sample (PF 1,08).
  - Đây là quan sát, **không** phải đề xuất: tách theo regime sau khi đã thấy dữ liệu test là chỉnh tham số trên dữ liệu test.
- Lưu ý: số liệu này chỉ là mô phỏng. Không được dùng để tuyên bố chiến lược có lãi hay lỗ thật trước khi đối chiếu với lệnh DEMO thật (xem T6).

## Phương pháp

### Logic tái dùng từ production (không viết lại)

- **Regime và range:** `AnalysisPipeline` + `IndicatorPipeline` + `MarketRegimeClassifier` + `RangeBoundaryUtils` trên 320 nến M15. Giống hệt `phase7c-live-regime.service.ts`, với RANGING→SIDEWAY và TRENDING/BREAKOUT→TREND.
- **SuperTrend(10,3):** `phase7BSupertrend`.
- **SIDEWAY:** `chooseRangeSide`, `detectM5ConfirmationWithinBars` (carry 1) và `buildSidewayPlan` lấy từ `phase7c-sideway-logic.mjs`.
- **TREND:** `detectEntryPattern`, `hasRelevantFvg` và `opposingFvgRejectionAt` được chép nguyên văn vì controller không export.

### Quy tắc mô phỏng

- **TREND vào lệnh:**
  - Pattern M15 THREE→TWO→ENGULFING.
  - SuperTrend M15 và M5 phải cùng chiều.
  - SL = cực trị ±1, khoảng 6..cap. Nếu rộng hơn cap thì chờ hồi tối đa 15 phút.
- **TREND quản lý lệnh:**
  - BE ở +trigger, SL về entry ± offset.
  - Tới +10 thì chốt 1/3.
  - FastMove 10/10 sau BE.
  - Sau khi chốt 1/3 thì trail theo cấu trúc M5 (handoff); FastMove bật lại khi giá đi thêm +10 từ anchor.
  - Phần còn lại thoát khi có FVG ngược hoặc giá đóng cửa vượt MA50.
- **SIDEWAY:**
  - Điều kiện: RANGING, độ tin cậy ≥ 60, có range, ở mép range, có xác nhận M5.
  - TP ở biên đối diện; nếu bật TP cố định thì lấy mức gần hơn.
  - BE, FastMove và trail M5 tính từ lúc vào lệnh. Không chốt 1/3 (`brokerTpSlTrailOnly`).
- **Một lệnh tại một thời điểm** cho cả hai chiến lược.

### Giả định thận trọng

- **STOP_FIRST:** trong một nến, SL đang có hiệu lực được kiểm tra trước TP và trước mọi hành động phía lãi. SL dời trong nến chỉ có hiệu lực từ nến sau.
- Vào lệnh ở giá mở nến M5 kế tiếp: ASK cho BUY, BID cho SELL.
- **Spread** lấy theo từng nến (`<SPREAD>` × 0,01).
- **Trượt giá** 0,10 khi vào lệnh, khi dính SL và khi đóng theo thị trường. TP khớp đúng giá.
- **Phí** 7 USD/lot khứ hồi. Mức phí thật tuỳ broker; có chạy thêm độ nhạy với phí 0.
- **Lot** 0,03 và R = rủi ro ban đầu tính bằng USD (kể cả phí).

### Không mô phỏng

- Daily recovery / RECOVERY_TP.
- Lệnh REVERSAL (bị khoá khi LIVE).
- Cổng spread và độ tươi dữ liệu.
- Stop/freeze level của broker (giả định 0).

### Chia dữ liệu

- In-sample là 2/3 đầu, out-of-sample là 1/3 cuối.
- **Chọn ứng viên chỉ trên in-sample**, theo PF trung vị của chính cấu hình đó và các cấu hình lân cận trên lưới (chọn vùng ổn định, không chọn một điểm tối ưu). Cấu hình phải có ít nhất 20 lệnh trong in-sample.
- Walk-forward 6 fold: chia dữ liệu thành 7 khối bằng nhau. Fold f train trên khối 0..f−1, test trên khối f.

## Kết quả chi tiết

Dữ liệu: 71008 nến M5, 23671 nến M15, 2025-11-25 01:00 → 2026-11-25 10:50 (giờ server MT5).
In-sample: 2025-11-25 01:00 → 2026-07-26 15:33 · Out-of-sample: 2026-07-26 15:33 → 2026-11-25 10:50.

### Cấu hình hiện tại (BE 6 / offset 0 / SL tối đa 10 / TP cố định tắt)
| | Lệnh | PF | Lãi/lỗ USD | Kỳ vọng USD/lệnh | R TB | Thắng | Max DD USD | Max DD R |
|---|---|---|---|---|---|---|---|---|
| Cả 12 tháng | 625 | 0.83 | -1189 | -1.90 | -0.076 | 32% | 1595 | 63.1 |
| In-sample | 408 | 0.77 | -1168 | -2.86 | -0.114 | 30% | 1252 | 49.2 |
| Out-of-sample | 217 | 0.99 | -21 | -0.10 | -0.004 | 35% | 343 | 13.9 |

Lý do đóng lệnh (12 tháng): STOP_AFTER_BE 321, STOP_LOSS 298, RUNNER_TREND_MA50 2, REVERSAL_FVG_REJECTION 3, TAKE_PROFIT 1.

### Out-of-sample tách theo chiều, chiến lược, regime — cấu hình hiện tại
| | Lệnh | PF | Lãi/lỗ USD | Kỳ vọng USD/lệnh | R TB | Thắng | Max DD USD | Max DD R |
|---|---|---|---|---|---|---|---|---|
| regime:BREAKOUT | 170 | 1.08 | +145 | 0.85 | 0.042 | 36% | 254 | 10.3 |
| regime:RANGING | 28 | 0.45 | -152 | -5.44 | -0.236 | 29% | 193 | 8.2 |
| regime:TRENDING | 19 | 0.92 | -14 | -0.75 | -0.076 | 37% | 86 | 4.2 |
| side:BUY | 91 | 0.96 | -37 | -0.40 | -0.009 | 35% | 232 | 10.0 |
| side:SELL | 126 | 1.01 | +16 | 0.12 | -0.001 | 35% | 309 | 13.6 |
| strategy+side:SIDEWAY/BUY | 11 | 0.91 | -8 | -0.72 | -0.047 | 27% | 65 | 2.5 |
| strategy+side:SIDEWAY/SELL | 17 | 0.21 | -144 | -8.48 | -0.358 | 29% | 144 | 6.1 |
| strategy+side:TREND/BUY | 80 | 0.97 | -29 | -0.36 | -0.004 | 36% | 172 | 7.9 |
| strategy+side:TREND/SELL | 109 | 1.16 | +160 | 1.47 | 0.054 | 36% | 215 | 10.1 |
| strategy:SIDEWAY | 28 | 0.45 | -152 | -5.44 | -0.236 | 29% | 193 | 8.2 |
| strategy:TREND | 189 | 1.07 | +131 | 0.69 | 0.030 | 36% | 288 | 12.4 |

### Ứng viên chọn trên in-sample: BE10/OFF0/SL10/TPoff (PF trung vị vùng lân cận 0.797)
| | Lệnh | PF | Lãi/lỗ USD | Kỳ vọng USD/lệnh | R TB | Thắng | Max DD USD | Max DD R |
|---|---|---|---|---|---|---|---|---|
| In-sample | 372 | 0.80 | -1134 | -3.05 | -0.113 | 39% | 1300 | 48.5 |
| Out-of-sample | 203 | 0.95 | -135 | -0.66 | -0.027 | 42% | 477 | 19.8 |
| OOS regime:BREAKOUT | 157 | 1.01 | +33 | 0.21 | 0.017 | 44% | 325 | 13.4 |
| OOS regime:RANGING | 28 | 0.42 | -166 | -5.94 | -0.262 | 29% | 206 | 8.8 |
| OOS regime:TRENDING | 18 | 0.99 | -2 | -0.11 | -0.041 | 44% | 85 | 4.1 |
| OOS side:BUY | 86 | 0.86 | -165 | -1.92 | -0.052 | 38% | 306 | 12.3 |
| OOS side:SELL | 117 | 1.02 | +30 | 0.26 | -0.008 | 44% | 330 | 14.2 |
| OOS strategy+side:SIDEWAY/BUY | 11 | 0.79 | -22 | -2.01 | -0.112 | 27% | 73 | 2.9 |
| OOS strategy+side:SIDEWAY/SELL | 17 | 0.21 | -144 | -8.48 | -0.358 | 29% | 144 | 6.1 |
| OOS strategy+side:TREND/BUY | 75 | 0.87 | -143 | -1.90 | -0.044 | 40% | 242 | 10.2 |
| OOS strategy+side:TREND/SELL | 100 | 1.14 | +174 | 1.74 | 0.052 | 47% | 279 | 13.2 |
| OOS strategy:SIDEWAY | 28 | 0.42 | -166 | -5.94 | -0.262 | 29% | 206 | 8.8 |
| OOS strategy:TREND | 175 | 1.01 | +31 | 0.18 | 0.011 | 44% | 362 | 15.1 |

### Walk-forward 6 fold (anchored: train từ đầu dữ liệu tới hết block trước, test block kế tiếp)
| Fold | Test | Chọn trên train | WF test: lệnh / PF / USD | Hiện tại: PF / USD | Ứng viên: PF / USD |
|---|---|---|---|---|---|
| 1 | 2026-01-16 05:50 → 2026-03-09 10:40 | BE10/OFF1/SL15/TP20 | 76 / 0.61 / -627 | 0.97 / -19 | 0.83 / -159 |
| 2 | 2026-03-09 10:40 → 2026-04-30 15:30 | BE6/OFF1/SL12/TPoff | 98 / 0.62 / -526 | 0.81 / -215 | 0.76 / -322 |
| 3 | 2026-04-30 15:30 → 2026-06-21 20:20 | BE6/OFF0/SL10/TP20 | 113 / 0.76 / -325 | 0.75 / -332 | 0.98 / -26 |
| 4 | 2026-06-21 20:20 → 2026-08-13 01:10 | BE10/OFF0/SL10/TPoff | 102 / 0.56 / -706 | 0.54 / -665 | 0.56 / -706 |
| 5 | 2026-08-13 01:10 → 2026-10-04 06:00 | BE10/OFF0/SL10/TPoff | 90 / 0.95 / -61 | 1.06 / +50 | 0.95 / -61 |
| 6 | 2026-10-04 06:00 → 2026-11-25 10:50 | BE8/OFF2/SL10/TP20 | 86 / 0.98 / -18 | 1.19 / +173 | 1.15 / +152 |

### Toàn bộ 108 cấu hình (sắp theo PF out-of-sample)
| Cấu hình | IS lệnh | IS PF | IS USD | OOS lệnh | OOS PF | OOS USD | OOS kỳ vọng | OOS Max DD USD |
|---|---|---|---|---|---|---|---|---|
| BE6/OFF0/SL10/TP40 | 408 | 0.74 | -1298 | 217 | 1.03 | +57 | 0.26 | 331 |
| BE6/OFF2/SL10/TP40 | 413 | 0.73 | -1336 | 224 | 1.02 | +46 | 0.21 | 338 |
| BE6/OFF0/SL10/TP30 | 411 | 0.74 | -1303 | 217 | 1.02 | +44 | 0.20 | 318 |
| BE6/OFF1/SL10/TP40 | 411 | 0.74 | -1298 | 221 | 1.01 | +28 | 0.13 | 334 |
| BE6/OFF1/SL10/TP30 | 412 | 0.74 | -1278 | 221 | 1.01 | +15 | 0.07 | 319 |
| BE6/OFF2/SL10/TP30 | 414 | 0.74 | -1296 | 224 | 1.01 | +15 | 0.07 | 324 |
| BE6/OFF0/SL10/TP20 | 414 | 0.75 | -1234 | 218 | 1.00 | -7 | -0.03 | 356 |
| BE6/OFF2/SL10/TP20 | 418 | 0.74 | -1285 | 225 | 1.00 | -9 | -0.04 | 328 |
| BE6/OFF0/SL10/TPoff | 408 | 0.77 | -1168 | 217 | 0.99 | -21 | -0.10 | 343 |
| BE6/OFF1/SL10/TP20 | 416 | 0.75 | -1249 | 222 | 0.99 | -27 | -0.12 | 324 |
| BE6/OFF2/SL10/TPoff | 413 | 0.76 | -1207 | 224 | 0.98 | -38 | -0.17 | 338 |
| BE8/OFF0/SL10/TP40 | 386 | 0.80 | -1083 | 210 | 0.98 | -45 | -0.22 | 431 |
| BE8/OFF0/SL10/TP30 | 389 | 0.79 | -1109 | 210 | 0.98 | -47 | -0.23 | 423 |
| BE6/OFF1/SL10/TPoff | 411 | 0.77 | -1168 | 221 | 0.98 | -53 | -0.24 | 334 |
| BE10/OFF2/SL10/TP40 | 374 | 0.77 | -1285 | 203 | 0.98 | -65 | -0.32 | 465 |
| BE10/OFF1/SL10/TP40 | 373 | 0.78 | -1220 | 203 | 0.97 | -70 | -0.34 | 466 |
| BE10/OFF0/SL10/TP40 | 372 | 0.78 | -1229 | 203 | 0.97 | -73 | -0.36 | 466 |
| BE8/OFF0/SL10/TP20 | 393 | 0.81 | -1033 | 211 | 0.97 | -68 | -0.32 | 471 |
| BE8/OFF1/SL10/TP40 | 388 | 0.78 | -1171 | 212 | 0.96 | -86 | -0.41 | 433 |
| BE8/OFF1/SL10/TP30 | 389 | 0.78 | -1172 | 212 | 0.96 | -89 | -0.42 | 425 |
| BE10/OFF2/SL10/TP30 | 376 | 0.77 | -1276 | 203 | 0.96 | -96 | -0.47 | 468 |
| BE10/OFF1/SL10/TP30 | 375 | 0.78 | -1231 | 203 | 0.96 | -100 | -0.49 | 468 |
| BE8/OFF2/SL10/TP40 | 390 | 0.78 | -1178 | 213 | 0.96 | -94 | -0.44 | 446 |
| BE10/OFF0/SL10/TP30 | 375 | 0.78 | -1255 | 203 | 0.96 | -103 | -0.51 | 468 |
| BE8/OFF0/SL10/TPoff | 386 | 0.81 | -999 | 210 | 0.96 | -93 | -0.44 | 425 |
| BE8/OFF1/SL10/TP20 | 394 | 0.79 | -1137 | 213 | 0.96 | -100 | -0.47 | 457 |
| BE8/OFF2/SL10/TP20 | 396 | 0.79 | -1108 | 214 | 0.96 | -105 | -0.49 | 468 |
| BE8/OFF2/SL10/TP30 | 391 | 0.78 | -1158 | 213 | 0.95 | -114 | -0.54 | 455 |
| BE10/OFF2/SL10/TPoff | 374 | 0.79 | -1190 | 203 | 0.95 | -127 | -0.63 | 475 |
| BE10/OFF1/SL10/TPoff | 373 | 0.80 | -1124 | 203 | 0.95 | -132 | -0.65 | 477 |
| BE10/OFF0/SL10/TPoff | 372 | 0.80 | -1134 | 203 | 0.95 | -135 | -0.66 | 477 |
| BE6/OFF2/SL12/TP20 | 468 | 0.76 | -1436 | 238 | 0.95 | -138 | -0.58 | 466 |
| BE8/OFF1/SL10/TPoff | 388 | 0.79 | -1087 | 212 | 0.94 | -134 | -0.63 | 426 |
| BE8/OFF2/SL10/TPoff | 390 | 0.79 | -1095 | 213 | 0.94 | -142 | -0.67 | 440 |
| BE10/OFF2/SL10/TP20 | 382 | 0.79 | -1208 | 204 | 0.94 | -171 | -0.84 | 510 |
| BE10/OFF1/SL10/TP20 | 381 | 0.79 | -1183 | 204 | 0.94 | -176 | -0.86 | 512 |
| BE10/OFF0/SL10/TP20 | 380 | 0.79 | -1169 | 204 | 0.93 | -179 | -0.88 | 512 |
| BE6/OFF2/SL12/TP40 | 462 | 0.72 | -1622 | 236 | 0.93 | -170 | -0.72 | 474 |
| BE6/OFF2/SL12/TP30 | 464 | 0.75 | -1474 | 237 | 0.93 | -172 | -0.72 | 462 |
| BE6/OFF0/SL12/TP30 | 455 | 0.74 | -1525 | 229 | 0.93 | -182 | -0.79 | 481 |
| BE6/OFF1/SL12/TP20 | 462 | 0.77 | -1353 | 232 | 0.93 | -192 | -0.83 | 432 |
| BE6/OFF1/SL12/TP30 | 457 | 0.75 | -1452 | 231 | 0.92 | -199 | -0.86 | 426 |
| BE6/OFF2/SL12/TPoff | 462 | 0.74 | -1512 | 236 | 0.92 | -211 | -0.89 | 474 |
| BE6/OFF0/SL12/TP40 | 452 | 0.72 | -1627 | 228 | 0.92 | -212 | -0.93 | 511 |
| BE6/OFF1/SL12/TP40 | 455 | 0.73 | -1569 | 230 | 0.92 | -214 | -0.93 | 460 |
| BE6/OFF0/SL12/TP20 | 459 | 0.77 | -1365 | 230 | 0.92 | -217 | -0.94 | 517 |
| BE6/OFF0/SL15/TP20 | 509 | 0.73 | -1875 | 253 | 0.90 | -284 | -1.12 | 592 |
| BE6/OFF0/SL12/TPoff | 452 | 0.74 | -1527 | 228 | 0.90 | -253 | -1.11 | 541 |
| BE6/OFF1/SL15/TP20 | 510 | 0.74 | -1778 | 256 | 0.90 | -297 | -1.16 | 527 |
| BE6/OFF1/SL12/TPoff | 455 | 0.75 | -1470 | 230 | 0.90 | -255 | -1.11 | 490 |
| BE6/OFF2/SL15/TP20 | 514 | 0.75 | -1688 | 261 | 0.90 | -312 | -1.20 | 563 |
| BE8/OFF0/SL15/TP20 | 487 | 0.76 | -1801 | 241 | 0.89 | -355 | -1.47 | 631 |
| BE6/OFF0/SL15/TP30 | 504 | 0.70 | -2052 | 252 | 0.88 | -343 | -1.36 | 628 |
| BE6/OFF1/SL15/TP30 | 506 | 0.72 | -1907 | 255 | 0.88 | -364 | -1.43 | 574 |
| BE6/OFF0/SL15/TPoff | 501 | 0.71 | -1969 | 251 | 0.87 | -381 | -1.52 | 670 |
| BE6/OFF2/SL15/TP30 | 510 | 0.73 | -1833 | 260 | 0.87 | -387 | -1.49 | 623 |
| BE6/OFF0/SL15/TP40 | 501 | 0.69 | -2129 | 251 | 0.87 | -390 | -1.55 | 690 |
| BE10/OFF2/SL15/TP20 | 465 | 0.78 | -1747 | 237 | 0.86 | -472 | -1.99 | 790 |
| BE6/OFF1/SL15/TPoff | 503 | 0.73 | -1830 | 254 | 0.86 | -402 | -1.58 | 620 |
| BE8/OFF0/SL12/TP20 | 437 | 0.77 | -1485 | 220 | 0.86 | -398 | -1.81 | 672 |
| BE10/OFF1/SL15/TP20 | 465 | 0.78 | -1753 | 237 | 0.86 | -478 | -2.02 | 791 |
| BE8/OFF2/SL12/TP20 | 442 | 0.75 | -1617 | 225 | 0.86 | -406 | -1.81 | 606 |
| BE10/OFF0/SL15/TP20 | 465 | 0.77 | -1767 | 237 | 0.86 | -482 | -2.03 | 791 |
| BE6/OFF1/SL15/TP40 | 503 | 0.70 | -2003 | 254 | 0.86 | -411 | -1.62 | 640 |
| BE6/OFF2/SL15/TPoff | 507 | 0.74 | -1767 | 259 | 0.86 | -408 | -1.57 | 647 |
| BE6/OFF2/SL15/TP40 | 507 | 0.71 | -1940 | 259 | 0.86 | -416 | -1.61 | 667 |
| BE8/OFF1/SL15/TP20 | 487 | 0.76 | -1802 | 244 | 0.86 | -467 | -1.91 | 661 |
| BE8/OFF2/SL15/TP20 | 488 | 0.77 | -1712 | 246 | 0.86 | -470 | -1.91 | 679 |
| BE8/OFF0/SL12/TP30 | 432 | 0.74 | -1641 | 219 | 0.86 | -418 | -1.91 | 665 |
| BE8/OFF1/SL12/TP20 | 438 | 0.77 | -1493 | 222 | 0.85 | -437 | -1.97 | 635 |
| BE8/OFF0/SL12/TP40 | 429 | 0.73 | -1723 | 218 | 0.84 | -460 | -2.11 | 727 |
| BE8/OFF2/SL12/TP30 | 437 | 0.74 | -1671 | 224 | 0.84 | -467 | -2.08 | 661 |
| BE8/OFF1/SL12/TP30 | 432 | 0.75 | -1588 | 221 | 0.84 | -467 | -2.11 | 664 |
| BE8/OFF0/SL15/TP30 | 482 | 0.73 | -1949 | 240 | 0.84 | -530 | -2.21 | 766 |
| BE8/OFF2/SL12/TP40 | 435 | 0.72 | -1788 | 223 | 0.83 | -491 | -2.20 | 705 |
| BE10/OFF2/SL15/TP30 | 458 | 0.76 | -1870 | 235 | 0.83 | -587 | -2.50 | 865 |
| BE10/OFF1/SL15/TP30 | 458 | 0.76 | -1856 | 235 | 0.83 | -592 | -2.52 | 864 |
| BE10/OFF2/SL12/TP30 | 414 | 0.77 | -1550 | 215 | 0.83 | -534 | -2.48 | 803 |
| BE10/OFF0/SL15/TP30 | 458 | 0.76 | -1869 | 235 | 0.83 | -595 | -2.53 | 864 |
| BE10/OFF1/SL12/TP30 | 413 | 0.77 | -1570 | 215 | 0.83 | -538 | -2.50 | 803 |
| BE10/OFF0/SL12/TP30 | 413 | 0.76 | -1588 | 215 | 0.83 | -542 | -2.52 | 803 |
| BE10/OFF2/SL12/TP20 | 420 | 0.78 | -1487 | 216 | 0.83 | -545 | -2.52 | 817 |
| BE10/OFF2/SL12/TP40 | 412 | 0.76 | -1617 | 214 | 0.83 | -543 | -2.54 | 836 |
| BE8/OFF0/SL12/TPoff | 429 | 0.74 | -1630 | 218 | 0.83 | -501 | -2.30 | 757 |
| BE8/OFF1/SL12/TP40 | 430 | 0.73 | -1685 | 220 | 0.83 | -508 | -2.31 | 726 |
| BE10/OFF0/SL12/TP40 | 410 | 0.76 | -1620 | 214 | 0.83 | -551 | -2.57 | 837 |
| BE10/OFF1/SL12/TP20 | 420 | 0.78 | -1488 | 216 | 0.83 | -551 | -2.55 | 822 |
| BE10/OFF1/SL12/TP40 | 411 | 0.76 | -1617 | 214 | 0.83 | -548 | -2.56 | 837 |
| BE10/OFF0/SL12/TP20 | 419 | 0.78 | -1501 | 216 | 0.82 | -554 | -2.56 | 825 |
| BE10/OFF2/SL15/TP40 | 455 | 0.75 | -1901 | 234 | 0.82 | -611 | -2.61 | 928 |
| BE10/OFF1/SL15/TP40 | 455 | 0.75 | -1899 | 234 | 0.82 | -616 | -2.63 | 928 |
| BE8/OFF0/SL15/TPoff | 479 | 0.74 | -1907 | 239 | 0.82 | -578 | -2.42 | 822 |
| BE10/OFF0/SL15/TP40 | 455 | 0.75 | -1912 | 234 | 0.82 | -619 | -2.65 | 928 |
| BE10/OFF2/SL15/TPoff | 455 | 0.77 | -1799 | 234 | 0.82 | -617 | -2.63 | 908 |
| BE10/OFF1/SL15/TPoff | 455 | 0.77 | -1797 | 234 | 0.82 | -621 | -2.65 | 908 |
| BE8/OFF0/SL15/TP40 | 479 | 0.73 | -2000 | 239 | 0.82 | -587 | -2.45 | 842 |
| BE10/OFF0/SL15/TPoff | 455 | 0.77 | -1810 | 234 | 0.82 | -624 | -2.67 | 908 |
| BE8/OFF2/SL12/TPoff | 435 | 0.74 | -1685 | 223 | 0.82 | -532 | -2.39 | 735 |
| BE8/OFF1/SL12/TPoff | 430 | 0.75 | -1592 | 220 | 0.81 | -549 | -2.50 | 755 |
| BE8/OFF1/SL15/TP30 | 483 | 0.74 | -1902 | 243 | 0.81 | -626 | -2.58 | 794 |
| BE10/OFF2/SL12/TPoff | 412 | 0.77 | -1559 | 214 | 0.81 | -599 | -2.80 | 866 |
| BE10/OFF0/SL12/TPoff | 410 | 0.77 | -1572 | 214 | 0.81 | -606 | -2.83 | 867 |
| BE10/OFF1/SL12/TPoff | 411 | 0.77 | -1569 | 214 | 0.81 | -603 | -2.82 | 867 |
| BE8/OFF2/SL15/TP30 | 484 | 0.75 | -1831 | 245 | 0.80 | -660 | -2.69 | 832 |
| BE8/OFF1/SL15/TPoff | 480 | 0.74 | -1866 | 242 | 0.80 | -673 | -2.78 | 850 |
| BE8/OFF1/SL15/TP40 | 480 | 0.73 | -1973 | 242 | 0.80 | -682 | -2.82 | 870 |
| BE8/OFF2/SL15/TPoff | 481 | 0.75 | -1784 | 244 | 0.79 | -690 | -2.83 | 871 |
| BE8/OFF2/SL15/TP40 | 481 | 0.74 | -1890 | 244 | 0.79 | -699 | -2.86 | 891 |

### Ngưỡng chấp nhận của phiếu giao việc (ứng viên)
- ĐẠT: oosTradesAtLeast30
- KHÔNG ĐẠT: oosProfitFactorAbove1_20
- KHÔNG ĐẠT: oosExpectancyPositive
- KHÔNG ĐẠT: oosAvgRPositive
- KHÔNG ĐẠT: walkForwardPositiveFoldsAtLeast4of6
- Fold walk-forward dương: 1/6
- **Kết luận: KHÔNG ĐẠT — không đề xuất đổi cấu hình**

## Độ nhạy chi phí (cấu hình hiện tại, out-of-sample)

| Giả định | Lệnh | PF | Lãi/lỗ USD | Max DD USD |
|---|---|---|---|---|
| Phí 7 USD/lot + trượt 0,10 + spread | 217 | 0,99 | −21 | 343 |
| Phí 0 + trượt 0 + spread | 217 | 1,07 | +159 | 293 |

Với phí 0 và trượt 0, ứng viên chọn trên in-sample (BE8/OFF2/SL10/TPoff) vẫn không đạt: PF out-of-sample 0,995 và 3/6 fold dương.

## Rủi ro và giới hạn

- Mô phỏng trên nến M5, không có tick. Thứ tự giá trong nến được giả định theo hướng bất lợi (STOP_FIRST), nên kết quả có thể kém hơn thực tế một chút.
- Regime được tính trên nến M15 **đã đóng**. Live API có thể dùng cả nến đang chạy.
- Giờ nến là giờ server MT5.
- Mô phỏng chưa được đối chiếu với lệnh DEMO thật. Việc đối chiếu nằm trong kế hoạch T6.

## Chạy lại

```bash
node scripts/backtest/phase7c-management-sweep.mjs \
  --m5 <XAUUSD_M5.csv> --m15 <XAUUSD_M15.csv> \
  --cache .runtime/backtest/phase7c-replay-cache.json \
  --out .runtime/backtest/phase7c-sweep.json          # thêm --commission 0 --slippage 0 để xem độ nhạy
node scripts/backtest/phase7c-sweep-report.mjs .runtime/backtest/phase7c-sweep.json
node --test scripts/backtest/*.test.mjs
```
