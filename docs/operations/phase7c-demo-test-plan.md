# Phase 7C — T6: kế hoạch test DEMO

> Chủ dự án tự chạy kế hoạch này. Claude không gửi, sửa hay đóng lệnh nào, và không đổi BOT_MODE, LIVE ARM, tài khoản, scheduled task hay runtime.
> Chỉ dùng tài khoản **DEMO**. Panel MT5 giữ `ORDER PERMISSION = NONE` ngoài các phiên test.

## Mục tiêu

T3/T4 ([báo cáo](phase7c-management-sweep-report.md)) **không** tìm được cấu hình nào đạt ngưỡng, nên T5 **không đề xuất đổi tham số**. DEMO chạy với cấu hình hiện tại để làm ba việc:

1. **Kiểm tra T2:** BE cấu hình được phải chạy đúng như cũ khi để mặc định (6/0), và phải từ chối khởi động khi cấu hình sai.
2. **Đối chiếu mô phỏng với lệnh thật:** so lệnh DEMO thật với lệnh mà bộ mô phỏng T3 tạo ra trên cùng khoảng thời gian. Nếu hai bên lệch lớn, kết luận T3/T4 phải xem lại trước khi dùng.
3. **Ghi số liệu thật theo phiếu giao việc** (PF, kỳ vọng, R trung bình, max DD tính bằng USD và R), tách BUY/SELL và TREND/SIDEWAY.

## Điều kiện trước khi chạy

- PR #221 (T1), #222 (T2) và #223 (T3/T4) đã merge. CI xanh trên `main`, kể cả các job đang bị chặn vì billing GitHub.
- Tài khoản MT5 là DEMO và nằm trong `MT5_ALLOWED_LOGINS`. Lot cố định 0,03.
- **Không** đặt `ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE` / `ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE`, để dùng mặc định 6/0. Chỉ đặt hai biến này trong các kịch bản S2–S3 bên dưới.
- Giữ nguyên mọi cổng an toàn: spread, độ tươi dữ liệu, khoá REVERSAL khi LIVE, khoá thực thi, kiểm tra cuối trước khi đặt lệnh.

## Kịch bản

### Khởi động và cấu hình (không cần chờ tín hiệu)

| # | Kịch bản | Cách làm | Kết quả mong đợi |
|---|---|---|---|
| S1 | Mặc định giữ hành vi cũ | Khởi động TREND và SIDEWAY mà không đặt biến BE | Log có `PHASE7C_TREND_BREAK_EVEN=TRIGGER_6|OFFSET_0|SOURCE=DEFAULT|APPLY=NEW_POSITIONS_ONLY`, và dòng tương tự cho `PHASE7C_SIDEWAY_BREAK_EVEN` |
| S2 | Cấu hình hợp lệ | Đặt trigger 8, offset 1, rồi khởi động lại | Log ghi `TRIGGER_8|OFFSET_1|SOURCE=ENV`. Sau test, bỏ hai biến và khởi động lại về 6/0 |
| S3 | Cấu hình sai thì không khởi động | Lần lượt thử trigger 3, trigger 16, offset 4, offset ≥ trigger, giá trị `abc` | Controller dừng với "…refusing to start" và không gửi lệnh nào |
| S4 | Lệnh đang mở giữ quy tắc cũ | Có lệnh đang mở, đổi env, khởi động lại | Lệnh đó vẫn dời BE theo snapshot lúc vào lệnh (6/0). Chỉ lệnh mới dùng giá trị mới |

### Quản lý lệnh (chờ tín hiệu tự nhiên; không tạo lệnh tay để "ép" kịch bản)

| # | Kịch bản | Bằng chứng cần lưu | Kết quả mong đợi |
|---|---|---|---|
| M1 | BE +6 | Sự kiện `PLUS6_*` trong journal và SL trên MT5 | SL về đúng entry (offset 0). SL chỉ siết, không bao giờ nới |
| M2 | Sát stop/freeze level của broker | `PLUS6_SL_WAIT` | Bot chờ, không gửi lệnh sửa SL không hợp lệ |
| M3 | Chốt 1/3 ở +10 (TREND) | Lệnh đóng một phần 0,01 lot | Còn lại 0,02 lot. Không chốt một phần ở SIDEWAY |
| M4 | FastMove 10/10 | Sự kiện fast-lock | SL bằng đỉnh trừ 10, chỉ siết |
| M5 | Trail cấu trúc M5 | `M5_STRUCTURAL_SL_TIGHTEN`, `FAST_MOVE_HANDOFF_M5_STRUCTURE` | SL theo đáy/đỉnh M5 ±1, chỉ siết |
| M6 | Thoát phần còn lại (TREND) | `REVERSAL_FVG_REJECTION` hoặc `RUNNER_TREND_MA50` | Đóng toàn bộ phần còn lại ở nến M15 đóng |
| M7 | SIDEWAY | TP ở biên đối diện, BE/FastMove/trail M5 | Không đóng vì hết thời gian hay vì regime đổi |
| M8 | Chỉ một lệnh tại một thời điểm | `UNEXPECTED_ADDITIONAL_POSITION` / `UNMANAGED_POSITION_PRESENT` nếu có | Không mở lệnh thứ hai |

## Đối chiếu mô phỏng với lệnh thật

1. Sau mỗi tuần, xuất M5 và M15 của tuần đó từ MT5. Dùng cùng symbol và cùng cách xuất như dữ liệu T3.
2. Chạy bộ mô phỏng trên dữ liệu đó (đầu ra nằm trong `.runtime/backtest/`, không commit):
   ```bash
   node scripts/backtest/phase7c-management-sweep.mjs --m5 <M5.csv> --m15 <M15.csv> --out .runtime/backtest/week.json
   ```
3. So danh sách lệnh của cấu hình `BE6/OFF0/SL10/TPoff` với journal thật (`phase7b-demo-events.jsonl`, `phase7c-sideway-events.jsonl`) và lịch sử deal MT5. Ghi lại:
   - tỉ lệ lệnh khớp (cùng chiều, giờ vào lệnh lệch ≤ 1 nến M15);
   - lệnh chỉ có ở mô phỏng và lệnh chỉ có ở DEMO, kèm lý do (cổng spread hay độ tươi dữ liệu, regime tính trên nến đang chạy, REVERSAL, daily recovery);
   - chênh lệch kết quả trung bình trên mỗi lệnh khớp (USD và R).
4. **Ngưỡng tin cậy của mô phỏng:** ít nhất 70% lệnh khớp và chênh lệch R trung bình ≤ 0,15 R. Nếu không đạt, ghi rõ trong báo cáo tuần, và **không** dùng kết luận T3/T4 cho tới khi sửa xong mô phỏng.

## Thời lượng và tiêu chí dừng

- **Thời lượng:** tối thiểu 4 tuần, hoặc 30 lệnh đã đóng nếu tới trước. Đây là cỡ mẫu tối thiểu theo phiếu giao việc.
- **Dừng ngay và giữ `ORDER PERMISSION = NONE`** nếu có một trong các trường hợp:
  - SL bị nới;
  - lot khác bội số 0,03;
  - có lệnh thứ hai mở cùng lúc;
  - có lệnh gửi khi cổng an toàn đang chặn;
  - controller vẫn chạy với cấu hình BE sai.
- **Dừng để xem lại chiến lược** nếu sụt vốn DEMO vượt 15 R. Mức này gần max DD out-of-sample 13,9 R của cấu hình hiện tại trong T4.

## Báo cáo mỗi tuần

| Mục | Nội dung |
|---|---|
| Lệnh | Số lệnh, tách TREND/SIDEWAY × BUY/SELL |
| Hiệu quả | PF, kỳ vọng USD/lệnh, R trung bình, tỉ lệ thắng |
| Rủi ro | Max DD tính bằng USD và R, so với mô phỏng cùng tuần |
| Kịch bản | S1–S4 và M1–M8: đạt / chưa gặp / lỗi, kèm dòng journal |
| Đối chiếu | Tỉ lệ khớp, các lệnh lệch, chênh lệch R |
| Rủi ro còn lại | Những điểm cần chủ dự án quyết định |

## Sau DEMO

- Nếu mô phỏng đạt ngưỡng tin cậy và DEMO xác nhận SIDEWAY yếu như T4 cho thấy, việc tiếp theo là thiết kế một **thay đổi chiến lược** riêng, ví dụ siết điều kiện vào lệnh SIDEWAY. Thay đổi đó phải có phiếu và PR riêng, test đỏ trước, rồi kiểm tra lại out-of-sample trên dữ liệu **mới** (không dùng lại 12 tháng đã dùng cho T3/T4).
- Không bật AUTO_RISK cho TREND trong giai đoạn này, vì T4 không đạt ngưỡng.
