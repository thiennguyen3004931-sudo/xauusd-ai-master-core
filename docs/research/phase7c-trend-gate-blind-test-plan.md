# Phase 7C — kiểm mù "cổng xu hướng + chỉ TREND" trên dữ liệu 2020–2023 (kế hoạch khóa trước)

> Nghiên cứu offline. Không đổi runtime, BOT_MODE, cấu hình đang chạy hay lệnh nào.
> File này được commit **trước** khi chạy. Chạy đúng **một lần**. Sau khi chạy, không đổi luật hay tham số.

## Giả thuyết đã khóa (từ vòng 4)

- TREND vào lệnh theo luật Phase 7C hiện tại, thêm cổng `WITH_TREND_ONLY`: chỉ vào khi trạng thái thư viện mẫu (H1, có kiểm xung đột H4, chỉ nến đã đóng) cùng hướng lệnh.
- SIDEWAY tắt.
- Quản lý lệnh giữ mặc định: SL 6–10 (chờ hồi nếu > 10), BE +6 → entry, chốt 1/3 ở +10, FastMove 10/10, M5 handoff, TP cố định tắt.
- Chi phí: STOP_FIRST, spread theo nến M5, trượt giá 0,10, phí 7 USD/lot, 0,12 lot, mỗi lúc một lệnh.

## Dữ liệu

- MT5 XAUUSD.G do chủ dự án xuất: M5, M15, H1, H4 từ 25/11/2020 đến 24/11/2023. Không trùng với dữ liệu 27/11/2023 → 26/11/2026 đã dùng để tìm ý tưởng.
- **Kiểm tra chất lượng (làm trước khi chạy, không nhìn kết quả):**
  - Trước khoảng 10/11/2021, file M5 và M15 chỉ chứa nến H1 lặp lại, mỗi giờ một nến, và spread bằng 0. Broker không có lịch sử M5/M15 thật cho đoạn này.
  - Vì vậy, M5/M15 chỉ dùng từ **11/11/2021 00:00**. Các lệnh được tính sau giai đoạn khởi động regime, khoảng 320 nến M15.
  - H1/H4 dùng toàn bộ, vì thư viện mẫu cần lịch sử dài.
- Đoạn chấm điểm: 11/11/2021 → 24/11/2023, khoảng 2 năm.

## Ngưỡng đạt (phiếu giao việc + đề xuất vòng 4)

| Tiêu chí | Ngưỡng |
|---|---|
| Số lệnh | ≥ 30 |
| Profit factor | > 1,20 |
| Expectancy (USD) và R trung bình | > 0 |
| Block dương | ≥ 4/6, với 6 block bằng nhau theo thời gian |
| Max drawdown | Báo cáo bằng USD và R, so với cấu hình hiện tại trên cùng đoạn |

Cả bốn tiêu chí đầu phải đạt. Nếu trượt bất kỳ tiêu chí nào, kết luận là **không đạt**: bỏ giả thuyết, không chỉnh lại trên dữ liệu này.

Chỉ để tham khảo, không dùng để quyết định:
- cấu hình hiện tại (cổng tắt, TREND + SIDEWAY);
- BUY/SELL và theo regime;
- hai nửa của đoạn chấm điểm;
- bỏ 5 lệnh lời nhất;
- chi phí xấu hơn (trượt 0,30, phí 10, spread × 1,5).
