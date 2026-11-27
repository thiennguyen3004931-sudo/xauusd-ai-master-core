# Phase 7C vòng 4 — cổng xu hướng thư viện + quản lý lệnh (kế hoạch đăng ký trước)

> Nghiên cứu offline. Không đổi runtime, BOT_MODE, cấu hình đang chạy hay lệnh nào.
> File này được commit **trước** khi chạy sweep. Sau khi chạy, không đổi luật dưới đây.

## Câu hỏi

Cổng `trendStrategyLibraryGate = WITH_TREND_ONLY` (chỉ vào lệnh TREND khi trạng thái thư viện mẫu H4/H1 cùng hướng lệnh)
đạt PF 1,20 ngoài mẫu khi giữ nguyên quản lý lệnh. Kết hợp cổng này với lưới SL/BE/TP của T3 có vượt ngưỡng phiếu giao việc không?

## Luật cố định

- Dữ liệu: MT5 XAUUSD.G M5/M15/H1/H4, 27/11/2023 → 26/11/2026, giờ broker.
- Cổng: áp dụng **trong mô phỏng** lúc có tín hiệu TREND (không chỉ bỏ lệnh khỏi danh sách có sẵn), nên mô phỏng được lệnh khác mở thay vào.
  Trạng thái thư viện lấy từ nến H1/H4 đã đóng tại thời điểm tín hiệu (`enrichTradesWithContext`, nhân quả). SIDEWAY không có cổng.
- Lưới quản lý (T3): BE trigger 6/8/10 × BE offset 0/1/2 × trần SL 10/12/15 × TP cố định tắt/20/30/40 = 108 cấu hình, tất cả với cổng BẬT.
- Chi phí: STOP_FIRST, spread theo nến M5, trượt giá 0,10 mỗi lần khớp, phí 7 USD/lot, 0,12 lot, mỗi lúc một lệnh.
- Tách mẫu: trong mẫu 27/11/2023 → 31/12/2025 (cùng mốc đã dùng để chọn cổng), ngoài mẫu 31/12/2025 → 26/11/2026.
- Chọn: `selectStable` có sẵn — trung vị PF của cấu hình và các láng giềng trong lưới trên đoạn trong mẫu, tối thiểu 20 lệnh.
- Walk-forward: 7 block bằng nhau theo thời gian, fold f chọn trên block [0, f) và chấm trên block f (6 fold), cổng BẬT.
- So sánh: cấu hình hiện tại (cổng TẮT, BE6/OFF0/SL10/TPoff) và cổng BẬT với quản lý mặc định.
- Ngưỡng (phiếu giao việc): ngoài mẫu ≥ 30 lệnh, PF > 1,20, expectancy > 0, R TB > 0, ≥ 4/6 fold walk-forward dương; báo max DD USD và R.
- Báo cáo thêm: BUY/SELL, theo regime, độ nhạy chi phí (trượt 0,30; phí 10; spread × 1,5).

## Giới hạn biết trước

- Cổng được chọn sau khi đã xem dữ liệu 3 năm này (đoạn trong mẫu). Đoạn ngoài mẫu chưa dùng để chọn cổng,
  nhưng đã được nhìn ở báo cáo đề xuất (PF 1,20). Vì vậy kết quả ngoài mẫu ở vòng này **không sạch hoàn toàn**.
- Không phải bằng chứng sinh lời. Bước kế tiếp nếu đạt vẫn là shadow/DEMO theo T6.
