# Đánh giá tổng thể dự án XAUUSD AI Master — 25/11/2026

> Rà soát chỉ đọc trên `main` @ `da13eba` (PR #231). Không đổi runtime, cấu hình, BOT_MODE, LIVE ARM hay lệnh nào.
> Những gì đã tự kiểm chứng ghi rõ "đã chạy"; phần còn lại là đọc mã nguồn và báo cáo có sẵn trong repo.

## Tóm tắt cho chủ dự án

1. **Chưa sẵn sàng chạy LIVE vì chiến lược chưa có lợi thế.** Backtest 12 tháng (0,03 lot, đã tính spread, phí, trượt giá) cho PF 0,83, −1.189 USD, sụt vốn tối đa 1.595 USD (63 R). Vào lệnh theo hướng ngẫu nhiên với cùng cách quản lý lệnh cho PF 0,80. Nghĩa là tín hiệu hiện tại gần như ngẫu nhiên. 108 cấu hình quản lý lệnh, 13 biến thể chiến lược và 11 tín hiệu vào lệnh thay thế đều không đạt ngưỡng của phiếu giao việc.
2. **Phần kỹ thuật an toàn được làm kỹ:** SL bắt buộc và chỉ siết, không martingale, lot bội số 0,03, cổng spread ở bridge, khóa REVERSAL, LIVE ARM cần preflight token và xác nhận, API chỉ nghe 127.0.0.1. Build 27/27 và test 25/25 gói đều xanh (đã chạy).
3. **Có ba lỗ hổng cần xử lý trước khi nghĩ tới LIVE:**
   - **Repo đang PUBLIC** và nhánh `main` **không có branch protection**, trong khi 61 job CI chạy trên runner tự host Windows. Người ngoài có thể mở PR và chạy mã trên máy runner.
   - **Runtime không có giới hạn lỗ ngày/tuần tự động.** Gói `risk-engine` có `DailyLossRule`, nhưng hai controller TREND và SIDEWAY đang chạy không dùng nó. Số "3%" trên dashboard là hằng số hiển thị.
   - **Lot cấu hình được tới 1,20.** Baseline 23/08 ghi TREND 0,12 lot. Ở 0,12 lot, backtest 12 tháng tương đương khoảng −4.750 USD và sụt vốn khoảng 6.400 USD.
4. **Việc nên làm tiếp:** chạy DEMO theo kế hoạch T6 ở 0,03 lot; song song nghiên cứu lại tín hiệu vào lệnh trên dữ liệu mới. Chi tiết ở mục 9.

## 1. Bảng vấn đề theo mức độ

| # | Mức | Vấn đề | Bằng chứng | Khuyến nghị |
|---|---|---|---|---|
| 1 | **Nghiêm trọng** | Chiến lược không có lợi thế đã chứng minh | PF 0,83 (12 tháng), walk-forward 2/6 fold dương; đối chứng ngẫu nhiên PF 0,80 (PR #228) | Không bật LIVE. Chạy DEMO để đối chiếu. Nghiên cứu tín hiệu mới bằng phiếu riêng |
| 2 | **Nghiêm trọng** | Repo public, `main` không được bảo vệ, runner tự host nhận job từ `pull_request` | `visibility=public`; API branch protection trả 404; 52 workflow dùng `[self-hosted, …, xauusd-core-ci]`; `docs/private/SELF-HOSTED-CI.md` ghi runner dành cho repo **private** | Chuyển repo về private, hoặc bật "Require approval for all outside collaborators". Bật branch protection cho `main` (cần PR và check xanh) |
| 3 | **Cao** | Không có giới hạn lỗ ngày/tuần hay số lệnh thua liên tiếp trong runtime | `scripts/run-phase7b-demo-controller.ts` và `scripts/run-phase7c-sideway-controller.mjs` không có kiểm tra daily loss; `dashboard.service.ts:233` gán cứng `maxDailyLossPercent: 3` | Thêm cổng "đã lỗ ≥ X R hôm nay → PAUSE lệnh mới", có test đỏ trước, mặc định bật |
| 4 | **Cao** | Biên lot rộng so với bằng chứng | `MAX_TREND_FIXED_VOLUME = 1.2`; baseline 0,12 lot; mỗi lệnh SL 10 giá ở 0,12 lot ≈ 120 USD, ở 1,20 lot ≈ 1.200 USD | Giữ 0,03 lot cho tới khi DEMO đạt ngưỡng. Cân nhắc trần cứng theo % vốn |
| 5 | **Cao** | 20 lỗ hổng thư viện (1 critical, 11 high) | Đã chạy `pnpm audit --prod`: `proxy-addr`, `body-parser`, `qs` qua `express` (API); `axios`, `follow-redirects` (Web) | Nâng `express` và `axios` (≥ 1.20.0), chạy lại build và test. API chỉ nghe localhost nên rủi ro thực tế thấp hơn mức chấm |
| 6 | Trung bình | API điều khiển không xác thực, chỉ dựa vào kiểm tra localhost | `/api/v1/phase7b-ops/bot/start` chỉ kiểm tra localhost; `/api/v1/control/mode` không kiểm tra gì (chỉ nhận SHADOW/DEMO); CORS mặc định `origin: true` nếu thiếu `WEB_ORIGIN` | Thêm token cục bộ cho các route có thay đổi trạng thái; bắt buộc `WEB_ORIGIN` |
| 7 | Trung bình | Logic TREND bị chép nguyên văn sang mô phỏng | Báo cáo T3: `detectEntryPattern`, `hasRelevantFvg`… "chép nguyên văn vì controller không export" | Tách thành module dùng chung để backtest và runtime không lệch nhau |
| 8 | Trung bình | Workflow giám sát LIVE liên tục bị huỷ | `AUTO LIVE Read-Only Event Monitor` chạy 10 phút/lần trên runner tự host; mọi lần chạy gần đây đều `cancelled` | Kiểm tra runner có online không; nếu không dùng thì tắt lịch chạy |
| 9 | Trung bình | Test UI đỏ sẵn nhưng không nằm trong CI | Đã chạy `scripts/test-phase7c-account-risk-v2-ui-source.mjs`: thiếu chuỗi "AN TOÀN ĐỂ ĐỔI TÀI KHOẢN"; không workflow nào gọi file này | Sửa test hoặc UI, rồi đưa vào CI |
| 10 | Trung bình | Dữ liệu backtest hẹp | 12 tháng, một broker (`XAUUSD.G`), file CSV không commit, không có dữ liệu tick | Bổ sung ≥ 3 năm dữ liệu; lưu hash dữ liệu trong báo cáo |
| 11 | Thấp | Repo phình to, khó bảo trì | 36 file `PHASE*.md` ở gốc; 640 script, trong đó 50 file `apply-*` vá một lần; 157 workflow | Dọn các script vá cũ vào thư mục lưu trữ; gộp workflow |
| 12 | Thấp | `turbo test` không phụ thuộc `build` | `turbo.json`: `"test": {}`; từ checkout sạch 11 gói customer-* test fail vì chưa build, sau build thì 25/25 xanh (đã chạy) | Thêm `"dependsOn": ["^build"]` cho `test` |
| 13 | Thấp | 5 PR mở lâu | #215, #218, #219, #220 (tháng 11 đầu), #228 | Đóng hoặc merge để tránh lệch nhánh |

## 2. Chiến lược và bằng chứng

- Bot gồm TREND (pattern M15 THREE→TWO→ENGULFING, SuperTrend M15 và M5 cùng chiều) và SIDEWAY (biên range + xác nhận M5), do regime chọn; REVERSAL thì PAUSE.
- Kết quả 12 tháng, cấu hình hiện tại: 625 lệnh, tỉ lệ thắng 32%, thắng TB +1,25 R, thua TB −0,69 R, PF 0,83.
  - 298/625 lệnh dính SL đầy đủ.
  - SIDEWAY là phần yếu nhất (out-of-sample PF 0,45; SIDEWAY/SELL PF 0,21).
  - Ngay cả khi bỏ phí và trượt giá, out-of-sample chỉ đạt PF 1,07. Lợi thế trước chi phí rất mỏng.
- Mọi biến thể đều lỗ ở tháng 1–8/2026 và có lãi ở tháng 9–11. Kết quả phụ thuộc giai đoạn thị trường, không phải tham số.
- Ứng viên duy nhất đáng theo dõi (PR #228): phá vỡ Donchian M15 cùng hướng SuperTrend H1. Đạt PF 1,25 nhưng chỉ 3/6 fold dương và được chọn sau khi đã xem dữ liệu, nên **không** được tính là bằng chứng.
- Lịch sử: Phase 4C thắng 61,35% nhưng PF 0,90. Tỉ lệ thắng không nói lên lợi nhuận.

**Kết luận:** phiếu giao việc yêu cầu PF > 1,20, expectancy > 0 và ≥ 4/6 fold dương trên dữ liệu ngoài mẫu. Hiện chưa có cấu hình nào đạt. Chưa có tín hiệu nào đủ điều kiện để đề xuất cho chủ dự án phê duyệt.

## 3. Quản trị rủi ro

| Hạng mục | Trạng thái |
|---|---|
| SL bắt buộc, 6–10 giá, >10 thì chờ hồi | Có (`MIN/MAX_INITIAL_SL_PRICE`) |
| SL chỉ siết | Có, có test monotonicity |
| BE +6 → entry, cấu hình được, snapshot theo lệnh | Có (PR #222, #231) |
| Không martingale, không tăng lot để gỡ | Có; Daily Recovery tắt cho lệnh mới (PR #211), `LOT_ESCALATION=OFF` |
| Lot bội số 0,03 | Có, kiểm tra trong `phase7c-auto-lot.service.ts` |
| Cổng spread | Có ở bridge (`MT5_MAX_SPREAD_POINTS_JSON`, mặc định 50 point = 0,50 giá) |
| Độ tươi dữ liệu, khóa REVERSAL, khóa thực thi | Có |
| Giới hạn số lệnh mở | Có (`MAX_MANAGED_POSITIONS`, một lệnh mỗi lúc) |
| **Giới hạn lỗ ngày/tuần, số lệnh thua liên tiếp** | **Không có trong runtime** |
| Lọc tin mạnh (NFP, CPI, FOMC) | Không thấy trong runtime |
| Kill switch | Thủ công: PAUSE trên Control Center, `disarm-phase7c-live-local.ps1`, panel MT5 `ORDER PERMISSION = NONE`, điều khiển Telegram |

## 4. Chất lượng mã nguồn

- Khoảng 250.000 dòng TypeScript trong `apps/` và `packages/`, cộng 118.000 dòng trong `scripts/`.
- Controller TREND là một file 2.856 dòng (`run-phase7b-demo-controller.ts`); controller SIDEWAY 1.769 dòng. Logic vào lệnh không được export nên phải chép sang mô phỏng.
- Nhiều gói nghiên cứu cũ (Phase 4–6) vẫn nằm trong `risk-engine/src/services` cạnh mã runtime.
- Điểm tốt: hằng số quản lý lệnh đã được kiểm kê và có CI chống lệch (PR #221); mỗi thay đổi đều có test đỏ trước.

## 5. Test và CI

- Đã chạy: `pnpm turbo run build` → 27/27; `pnpm turbo run test` → 25/25 sau khi build; `node --test scripts/backtest/*.test.mjs` → 14/14.
- Có 157 workflow, 312 job; 61 job cần runner tự host `xauusd-core-ci`. Nếu runner offline thì các check này không chạy được.
- Các commit gần nhất trên `main` (`da13eba`, `80626cc`) có check xanh. Nhiều lần chạy `Canonical PR Gate` bị huỷ do push chồng nhau (concurrency), không phải lỗi test.
- Chưa kiểm chứng: test Python của bridge MT5 và các job Windows (môi trường này không có Windows/MT5).

## 6. Bảo mật

- **Quét secret:** đã quét toàn bộ 3.173 commit bằng mẫu regex cho token Telegram, GitHub PAT, AWS key, private key, `MT5_PASSWORD=`. Không thấy secret thật; chỉ có giá trị mẫu (`REPLACE_WITH_BOTFATHER_TOKEN`) và fixture test. `security/credential-remediation.json` ghi các phát hiện gitleaks trước đây là false positive đã duyệt. Chưa chạy được gitleaks/trufflehog trong môi trường này, nên nên chạy lại trên máy chủ dự án.
- `.gitignore` đã chặn `.env`, `.runtime`, file lot settings và SQLite trạng thái.
- Repo public + runner tự host + không branch protection: xem vấn đề #2.
- Dependabot alerts đang tắt; nên bật.
- Checklist LIVE đã nhắc đổi mật khẩu MT5 (đã làm) và đổi token Telegram nếu từng nằm trong repo.

## 7. Vận hành và triển khai

- Chạy trên Windows bằng Scheduled Task. PR #225/#229 thêm script `-ManualStartOnly` (dry run mặc định, có sao lưu và khôi phục) và biểu tượng Desktop để khởi động một chạm.
- Có preflight chỉ đọc, smoke test, script ARM/DISARM LIVE, runbook DEMO T6 và checklist LIVE.
- Rủi ro: nhiều script PowerShell `apply-*-local` vá trực tiếp trên máy, khó tái lập trạng thái máy bot từ repo. Chưa có cách rollback một lệnh duy nhất.

## 8. Giao diện

- PR #230: màn hình Vận hành còn 3 khối, menu 4 mục (Vận hành, Tài khoản & LIVE, Hiệu quả, Kỹ thuật). Intelligence chuyển sang trang Hiệu quả. Không đổi API.
- PR #231: BE hiển thị theo snapshot của từng lệnh.
- Còn một test UI đỏ không nằm trong CI (vấn đề #9).
- Chưa kiểm chứng: chưa mở giao diện thật trên máy bot.

## 9. Mức sẵn sàng LIVE và việc nên làm

| Điều kiện | Trạng thái |
|---|---|
| Backtest ngoài mẫu đạt ngưỡng | ❌ |
| DEMO ≥ 30 lệnh, khớp mô phỏng ≥ 70% | ❌ chưa có số liệu trong repo |
| Giới hạn lỗ ngày/tuần tự động | ❌ |
| Repo private / branch protection | ❌ |
| Thư viện không còn lỗ hổng high/critical | ❌ |
| Cổng an toàn, SL, lot, ARM LIVE | ✅ |
| Build và test | ✅ |

**Thứ tự đề xuất:**

1. Chuyển repo về private (hoặc yêu cầu duyệt PR từ người ngoài) và bật branch protection cho `main`. Chủ dự án làm trong Settings.
2. Thêm cổng lỗ ngày/tuần tự PAUSE, có test. Nâng `express` và `axios`. Mỗi việc một PR.
3. Chạy DEMO ở 0,03 lot theo kế hoạch T6, ít nhất 30 lệnh, ghi báo cáo tuần.
4. Nghiên cứu tín hiệu mới với tham số khoá trước, chấm trên dữ liệu chưa dùng (cần chủ dự án xuất thêm dữ liệu MT5 cũ hơn 12 tháng).
5. Chỉ cân nhắc LIVE khi các mục ❌ ở trên đã đạt.

## 10. Chưa kiểm chứng được

- Hành vi runtime thật trên máy bot, giao diện thật, test Python và job Windows.
- Kết quả DEMO thật (chưa có trong repo).
- Quét secret bằng gitleaks/trufflehog (chỉ quét bằng regex).
- Trạng thái runner tự host và cài đặt Actions của repo (proxy không cho đọc).
