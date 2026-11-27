# Phase 7C — Kiểm kê hằng số quản lý lệnh (T1)

Ngày: 2026-11-25 · Nguồn: `main` @ `4fd8f15` · Loại thay đổi: tài liệu + test nguồn, **không đổi hành vi**.

## Đường chạy thật (runtime) đã xác minh từ source

| Bot | Chuỗi khởi chạy | File chứa logic quản lý lệnh |
|---|---|---|
| TREND | `run-phase7c-executors-local.ps1` → `run-phase7c-trend-controller-local.ps1` → `run-phase7c-trend-account-mode.mjs` → `run-phase7c-trend-controller.mjs` (biên dịch TS + adapter M5 / FastMove pre-structure / SEMI / Daily Recovery / LIVE) | `scripts/run-phase7b-demo-controller.ts` (`managePosition`) |
| SIDEWAY | `run-phase7c-sideway-controller-local.ps1` → `run-phase7c-sideway-locked.mjs` → `run-phase7c-sideway-account-mode.mjs` (adapter M5 / FastMove / Daily Recovery / LIVE) | `scripts/run-phase7c-sideway-controller.mjs` + `scripts/phase7c-sideway-logic.mjs` |
| SEMI | Adapter `phase7c-semi-trend-runtime-source-adapter.mjs` chèn vào TREND controller | `scripts/phase7c-semi-trend-adoption-runtime.mjs` (nhận lệnh), sau đó dùng chung `managePosition` của TREND |
| Dùng chung | — | `phase7c-stop-monotonicity.mjs` (đệm +1, chỉ siết), `phase7c-fast-move-profit-lock.mjs` (thuật toán FastMove, nhận tham số) |

Lưu ý: runtime thật **không đọc file trên trực tiếp**; các adapter sửa source dạng chuỗi trước khi chạy, và nhiều adapter/test bám theo chuỗi nguyên văn như `if (!managed.breakEvenApplied && favorable >= 6)`. T2 phải cập nhật các anchor này cùng lúc (xem mục Rủi ro).

## Bảng hằng số

Phân loại: **RUNTIME** = quyết định lệnh thật; **RUNTIME_DISPLAY_ONLY** = trong process bot nhưng chỉ ghi log/hiển thị; **API_REPLAY / API_DISPLAY** = control API chạy cạnh bot, chỉ replay/hiển thị, không gửi lệnh; **API_RESEARCH** = route nghiên cứu Phase 7D/7E; **API_UNWIRED** = code API không được import vào đường chạy; **RESEARCH** = script/package nghiên cứu.

| ID | File:dòng | Giá trị | Phạm vi | Ý nghĩa |
|---|---|---|---|---|
| TR-MIN-SL | `scripts/run-phase7b-demo-controller.ts:285` | 6 | RUNTIME | SL ban đầu tối thiểu (giá) |
| TR-MAX-SL | `scripts/run-phase7b-demo-controller.ts:286` | 10 | RUNTIME | SL tối đa; >10 thì chờ hồi (TOO_WIDE_WAIT) |
| TR-PULLBACK-WAIT | `scripts/run-phase7b-demo-controller.ts:289` | 15 phút | RUNTIME | Thời gian chờ hồi khi SL >10 |
| TR-FM-ACT | `scripts/run-phase7b-demo-controller.ts:287` | +10 | RUNTIME | FastMove kích hoạt |
| TR-FM-GIVEBACK | `scripts/run-phase7b-demo-controller.ts:288` | 10 | RUNTIME | FastMove trả lại từ đỉnh |
| TR-BE-TRIGGER | `scripts/run-phase7b-demo-controller.ts:1951` | +6 mặc định (snapshot lúc vào lệnh) | RUNTIME | BE trigger, đọc từ `managed.breakEven` (T2) |
| TR-BE-OFFSET | `scripts/run-phase7b-demo-controller.ts:1957` | 0 mặc định (snapshot) | RUNTIME | BE = entry ± offset, chỉ siết SL, tôn trọng stop/freeze level (T2) |
| TR-PARTIAL | `scripts/run-phase7b-demo-controller.ts:2136` | +10 (literal) | RUNTIME | Chốt 1/3 |
| TR-FIXED-TP-ON | `scripts/run-phase7b-demo-controller.ts:268` | false | RUNTIME | TP cố định mặc định tắt (env) |
| TR-FIXED-TP-DIST | `scripts/run-phase7b-demo-controller.ts:269` | 0 | RUNTIME | Khoảng TP cố định (env) |
| SHARED-STRUCT-BUFFER | `scripts/phase7c-stop-monotonicity.mjs:3` | 1 | RUNTIME | Đệm cấu trúc dùng chung TREND/SIDEWAY/M15 swing trail |
| SW-MIN-SL | `scripts/phase7c-sideway-logic.mjs:3` | 6 | RUNTIME | SL tối thiểu |
| SW-MAX-SL | `scripts/phase7c-sideway-logic.mjs:4` | 10 | RUNTIME | SL tối đa; >10 bỏ lệnh (WAIT_PULLBACK_STOP_GT_10) |
| SW-RANGE-BUFFER | `scripts/phase7c-sideway-logic.mjs:159` | max(0,25·ATR, stops level, 20 point) | RUNTIME | Đệm biên range trước khi cộng đệm cấu trúc +1 |
| SW-TP1-LEGACY | `scripts/phase7c-sideway-logic.mjs:196` | entry ±10 | RUNTIME_DISPLAY_ONLY | tp1 cũ; partial +10 bị tắt (brokerTpSlTrailOnly), chỉ hiển thị |
| SW-MIN-RR | `scripts/phase7c-sideway-logic.mjs:199` | 1,2 | RUNTIME | RR tối thiểu tới biên đối diện |
| SW-FM-ACT | `scripts/run-phase7c-sideway-controller.mjs:106` | +10 | RUNTIME | FastMove kích hoạt |
| SW-FM-GIVEBACK | `scripts/run-phase7c-sideway-controller.mjs:107` | 10 | RUNTIME | FastMove trả lại |
| SW-BE-TRIGGER | `scripts/run-phase7c-sideway-controller.mjs:1328` | +6 mặc định (snapshot) | RUNTIME | BE trigger, đọc từ `managed.breakEven` (T2) |
| SW-BE-OFFSET | `scripts/run-phase7c-sideway-controller.mjs:1334` | 0 mặc định (snapshot) | RUNTIME | BE = entry ± offset (T2) |
| BE-DEFAULT-TRIGGER | `scripts/phase7c-break-even-config.mjs:19` | 6 | RUNTIME | Nguồn chung TREND/SIDEWAY/SEMI; env `ZIQ_PHASE7C_BREAK_EVEN_TRIGGER_PRICE` (4–15), sai thì không khởi động |
| BE-DEFAULT-OFFSET | `scripts/phase7c-break-even-config.mjs:20` | 0 | RUNTIME | env `ZIQ_PHASE7C_BREAK_EVEN_OFFSET_PRICE` (0–3, < trigger) |
| SEMI-INIT-SL | `scripts/phase7c-semi-trend-adoption-runtime.mjs:19` | 6 | RUNTIME | SL mục tiêu khi nhận lệnh tay; sau đó kế thừa managePosition của TREND |
| API-7C-MIN | `apps/api/src/services/phase7c.service.ts:113` | 6 | API_REPLAY | Replay/shadow Phase 7C trong API |
| API-7C-MAX | `apps/api/src/services/phase7c.service.ts:114` | 10 | API_REPLAY | như trên |
| API-7C-BE | `apps/api/src/services/phase7c.service.ts:115` | 6 | API_REPLAY | như trên |
| API-7C-PARTIAL | `apps/api/src/services/phase7c.service.ts:116` | 10 | API_REPLAY | như trên |
| API-MONITOR-BE | `apps/api/src/services/phase7c-decision-monitor.service.ts:429` | 6 | API_DISPLAY | Giá trị hiển thị trên UI, không điều khiển lệnh |
| AUDIT-BE | `scripts/phase7c-decision-audit.mjs:175` | 6 | RUNTIME_DISPLAY_ONLY | Ghi vào audit quyết định, không điều khiển lệnh |
| API-SEMI-PLAN-BE-R | `apps/api/src/services/phase7c-semi-trend-management-plan.service.ts:6` | 1R | API_UNWIRED | Plan SEMI kiểu execution-engine; trend-management-runtime.service không được import ở đâu |
| API-SEMI-PLAN-PARTIAL | `apps/api/src/services/phase7c-semi-trend-management-plan.service.ts:14` | 10 | API_UNWIRED | như trên |
| API-7D-MIN | `apps/api/src/services/phase7d-management.service.ts:84` | 6 | API_RESEARCH | Phase 7D (route /api/v1/phase7d), nghiên cứu |
| API-7D-SCALE-P2 | `apps/api/src/services/phase7d-daily-scale.service.ts:52` | 20 | API_RESEARCH | Partial thứ 2, chỉ Phase 7D |
| API-7E-BE | `apps/api/src/services/phase7e-realignment.service.ts:30` | 6 | API_RESEARCH | Phase 7E (route /api/v1/phase7e), nghiên cứu |
| API-7E-ST-BE | `apps/api/src/services/phase7e-supertrend.service.ts:19` | 6 | API_RESEARCH | như trên |
| API-CF-GIVEBACK | `apps/api/src/services/phase7c-counterfactual-evaluator.service.ts:15` | 10 | API_RESEARCH | Counterfactual analytics |
| RS-4C-BE-OFFSET | `packages/risk-engine/src/services/Phase4ShadowReplayService.ts:12` | 0,1 | RESEARCH | Replay Phase 4C |
| RS-7B-BE | `packages/risk-engine/src/services/Phase7BDualPatternTrendRiderService.ts:95` | 6 | RESEARCH | Phase 7B rider |
| RS-FVG-AB-BE | `scripts/run-phase7b-fvg-ab-comparison.ts:104` | 6 | RESEARCH | A/B FVG |
| RS-EXEC-ENGINE-BE | `packages/execution-engine/src/config/defaultExecutionEngineConfig.ts:12` | 1 tick | RESEARCH | Package execution-engine (không dùng bởi bot 7C) |
| RS-STRATEGY-ENGINE-BE | `packages/strategy-engine/src/config/defaultStrategyEngineConfig.ts:22` | 1R | RESEARCH | Package strategy-engine (không dùng bởi bot 7C) |

## Phát hiện chính

1. **BE trigger và BE offset không phải hằng số có tên.** Cả TREND (`run-phase7b-demo-controller.ts:1908`) và SIDEWAY (`run-phase7c-sideway-controller.mjs:1304`) hard-code `favorable >= 6` và đặt SL = `roundPrice(entry)`, tức offset 0. Không có env hay snapshot theo lệnh. Đây là chỗ T2 cần sửa.
2. **Partial +10 TREND cũng là literal** (`favorable >= 10`, dòng 2072). SIDEWAY không chốt 1/3 ở runtime (`brokerTpSlTrailOnly`), `tp1 = entry ± 10` chỉ còn để hiển thị.
3. **MIN/MAX SL 6/10 bị định nghĩa trùng ở 3 nơi runtime** (TREND controller, SIDEWAY logic, SEMI `INITIAL_STOP_DISTANCE = 6`) và 6 nơi trong API. Không có nguồn hằng số chung.
4. **FastMove 10/10 trùng ở 2 controller** (TREND, SIDEWAY); thuật toán dùng chung nhận tham số. Test `phase7c-fast-move-canonical-source-contract.test.mjs` khóa giá trị 10/10.
5. **Đệm cấu trúc +1 là nguồn chung duy nhất** (`STRUCTURAL_STOP_BUFFER_PRICE`). SIDEWAY còn cộng thêm đệm range `max(0,25·ATR, stops level, 20 point)` trước đó, nên SL SIDEWAY thực tế rộng hơn TREND với cùng cấu trúc.
6. **Hiển thị BE = 6 ở 2 chỗ ngoài controller** (`phase7c-decision-audit.mjs`, `phase7c-decision-monitor.service.ts`). Nếu T2 cho đổi trigger mà không sửa 2 chỗ này, UI và audit sẽ báo sai.
7. **API `phase7c.service.ts` có sẵn một replay Phase 7C** (BE 6, partial 10, SL 6–10, STOP trước) có thể tái dùng cho T3, nhưng chưa có FastMove 10/10 và M5 handoff.
8. **SEMI plan trong API** (`phase7c-semi-trend-management-plan.service.ts`, BE 1R, trailing 1,5R) không được import vào đường chạy (`trend-management-runtime.service.ts` không ai import). Nó mâu thuẫn với hợp đồng SEMI kế thừa TREND, nên không nên dùng làm tham chiếu.

## Rủi ro cho T2

- Thay literal `favorable >= 6` sẽ làm gãy các anchor chuỗi trong: `phase7c-semi-post-entry-contract.mjs`, `test-phase7c-daily-recovery-contract.mjs`, `test-phase7c-trend-management-path-regression.mjs`, `test-phase7c-sideway-recovery-management-contract.mjs`, `apply-phase7b-daily-recovery-ui-v8-local.mjs`, và có thể các adapter M5 (chèn code ngay sau khối BE). Phải chạy toàn bộ regression TREND/SIDEWAY/SEMI sau khi sửa.
- Lệnh đang mở được khôi phục từ state file khi khởi động lại; snapshot BE mới phải có giá trị mặc định 6/0 khi state cũ không có trường này.

## Kiểm chứng

`node --test scripts/phase7c-management-constants-inventory.test.mjs` kiểm tra mỗi dòng bảng: snippet còn đúng giá trị trong source, dòng được trích dẫn trỏ đúng, và phân loại có mặt. Nếu ai đó đổi một hằng số mà không cập nhật tài liệu này, test đỏ.
