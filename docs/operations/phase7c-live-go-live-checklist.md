# Phase 7C — checklist bật LIVE (chủ dự án tự làm)

> Claude **không** bật LIVE, không ARM, không gửi lệnh và không đổi runtime. Mọi bước dưới đây do chủ dự án tự làm trên máy bot.

## ⚠️ Cảnh báo trước khi bật LIVE

- **Backtest đang lỗ.** Mô phỏng 12 tháng dữ liệu MT5 với cấu hình hiện tại (0,03 lot, đã tính spread, phí và trượt giá):
  - PF 0,83, lỗ khoảng 1.189 USD, sụt vốn tối đa 1.595 USD (63 R);
  - 4 tháng cuối: PF 0,99.
  - Đã thử 108 cấu hình quản lý lệnh và 13 biến thể chiến lược; không cái nào đạt ngưỡng của phiếu.
  - Xem [báo cáo T3/T4](phase7c-management-sweep-report.md) và [báo cáo biến thể](phase7c-strategy-variants-report.md).
- **Phiếu giao việc yêu cầu chạy DEMO trước**, tối thiểu 30 lệnh đã đóng hoặc 4 tuần, theo [kế hoạch T6](phase7c-demo-test-plan.md). Chỉ bật LIVE sau khi DEMO đạt cả hai điều kiện:
  - PF > 1,20, kỳ vọng > 0, R trung bình > 0;
  - mô phỏng khớp ≥ 70% số lệnh thật, chênh lệch ≤ 0,15 R.
- Nếu vẫn bật LIVE khi chưa đạt các điều kiện trên, đó là quyết định của chủ dự án. Hãy bắt đầu với lot nhỏ nhất (0,03) và đặt sẵn giới hạn lỗ.

## A. Code và CI

- [ ] Merge theo thứ tự: #221 → #222 → #223 → #224 (→ #226 nếu muốn giữ công cụ nghiên cứu). #225 có thể merge bất kỳ lúc nào.
- [ ] CI xanh trên `main`, gồm cả các job chạy trên runner tự host `xauusd-core-ci`. Runner phải online.
- [ ] Repo public: bật **Settings → Actions → General → "Require approval for all outside collaborators"**, hoặc chuyển repo về private.
- [ ] Cập nhật mã nguồn trên máy bot bằng quy trình deploy hiện có, khi bot đang PAUSE và không có lệnh mở.

## B. Cấu hình (giữ mặc định)

- [ ] **Không** đặt `ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE` / `ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE`, để giữ BE +6 → entry.
- [ ] Lot cố định 0,03 (bội số 0,03). Không martingale, không tăng lot để gỡ.
- [ ] TP cố định: tắt (mặc định).
- [ ] Không nới các cổng an toàn: spread, độ tươi dữ liệu, khoá REVERSAL khi LIVE, khoá thực thi, kiểm tra cuối trước khi đặt lệnh.
- [ ] Sau khi khởi động, log có dòng `PHASE7C_TREND_BREAK_EVEN=TRIGGER_6|OFFSET_0|SOURCE=DEFAULT|APPLY=NEW_POSITIONS_ONLY` (và dòng tương ứng cho SIDEWAY).

## C. Máy bot

- [ ] Đã đổi mật khẩu MT5 (đã làm). Đổi luôn token Telegram và API key nếu chúng từng nằm trong repo.
- [ ] Tắt tự khởi động khi mở máy bằng `scripts/set-phase7c-manual-start-only-local.ps1`: chạy thử trước, rồi `-Apply` ([hướng dẫn](phase7c-one-click-start.md)).
- [ ] Có biểu tượng Desktop **XAUUSD AI MASTER**. Bấm vào thì Control Center mở ra và bot vẫn đứng yên.

## D. Bật LIVE (theo các script đã có trong repo)

1. [ ] Trên Control Center: chế độ **PAUSE**, không có lệnh XAUUSD nào đang mở.
2. [ ] Chuyển tài khoản sang LIVE bằng luồng chuyển tài khoản hiện có. Kiểm tra `preflight-phase7c-live-switch-local.ps1`.
3. [ ] Chạy kiểm tra chỉ đọc: `.\scripts\preflight-phase7c-live-activation-local.ps1`. Mọi mục phải đạt.
4. [ ] ARM LIVE bằng PowerShell Administrator: `.\scripts\arm-phase7c-live-local.ps1`. Kiểm tra lại bằng `.\scripts\get-phase7c-live-arm-local.ps1`.
5. [ ] Bật lệnh trong panel MT5, rồi bấm **BẬT BOT** trên Control Center. Chế độ AUTO hoặc TREND, theo quyết định của chủ dự án.
6. [ ] Theo dõi lệnh đầu tiên:
   - BE khi đạt +6;
   - chốt 1/3 khi đạt +10;
   - SL chỉ siết;
   - không có lệnh thứ hai.

## E. Dừng khẩn cấp / tắt LIVE

- [ ] Chuyển **PAUSE** trên Control Center. Bot không vào lệnh mới; lệnh đang mở vẫn được quản lý.
- [ ] Tắt ARM: `.\scripts\disarm-phase7c-live-local.ps1 -Reason "<lý do>"`.
- [ ] Panel MT5 về `ORDER PERMISSION = NONE`.
- [ ] Dừng ngay nếu gặp một trong các trường hợp:
  - SL bị nới;
  - lot sai;
  - có lệnh thứ hai;
  - cổng an toàn bị vượt;
  - sụt vốn vượt giới hạn đã đặt (gợi ý 15 R, gần mức sụt vốn ở 4 tháng cuối của backtest).

## F. Sau khi bật

- [ ] Mỗi tuần ghi: số lệnh, PF, kỳ vọng, R trung bình, sụt vốn tối đa (USD và R). Tách BUY/SELL và TREND/SIDEWAY.
- [ ] So sánh với backtest (cùng mẫu báo cáo tuần trong T6).
