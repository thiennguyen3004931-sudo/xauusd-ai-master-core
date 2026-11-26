# Đề xuất cải thiện tín hiệu có duyệt (chức năng 1, phần C2)

Hệ thống phân tích hiệu quả rồi **đề xuất** thay đổi. Không có gì được tự áp dụng. Anh chọn Duyệt, Từ chối hoặc Sửa.

## Duyệt xong thì bot có đổi không?

**Không, duyệt không tự đổi bot.** Một đề xuất đi qua các bước sau:

1. **Đề xuất** được tạo khi phân tích chạy (mỗi tuần, hoặc sau mỗi 30 lệnh đóng, hoặc khi bấm "Chạy phân tích ngay").
2. **Duyệt / Sửa** tạo một **phiên bản cấu hình mới** ở trạng thái **Chờ triển khai**. Bước này ghi audit log và không động vào file cấu hình của bot.
3. **Triển khai** là bước riêng do anh làm qua đường Phase 7C có bảo vệ:
   - bot đang PAUSE và không còn lệnh XAUUSD mở;
   - cấu hình mới chỉ áp dụng cho lệnh mới.

   Sau khi triển khai, anh bấm "Đánh dấu đã triển khai" để nhật ký biết phiên bản nào đang chạy.
4. **Rollback** tạo phiên bản mới mang tham số của một phiên bản cũ. Phiên bản đó cũng phải được triển khai như bước 3.

> Lưu ý: **bot hiện chưa đọc các bộ lọc này.** Muốn bot thật sự dùng một phiên bản đã duyệt, cần một PR riêng
> để nối bộ lọc vào luồng vào lệnh. PR đó phải giữ mặc định OFF = hành vi cũ, chỉ áp dụng cho lệnh mới, chờ CI xanh và chủ dự án duyệt.

## Đề xuất được phép đổi gì

Đề xuất chỉ được đổi các tham số trong danh sách sau. Danh sách này nằm trong code, ở `packages/market-intel/src/proposals.mjs`.

| Tham số | Giá trị | Mặc định |
| --- | --- | --- |
| `trendStrategyLibraryGate`: cổng thư viện mẫu cho lệnh TREND | `OFF`, `BLOCK_AGAINST_TREND` (chặn lệnh ngược xu hướng), `WITH_TREND_ONLY` (chỉ lệnh cùng xu hướng) | `OFF` |
| `sidewayStrategyLibraryGate`: cổng thư viện mẫu cho lệnh SIDEWAY | `OFF`, `BLOCK_IN_TREND` (chặn khi thư viện thấy Uptrend/Downtrend), `SIDEWAY_ONLY` | `OFF` |

Lot, SL, TP, BE, trailing và rủi ro **không** nằm trong danh sách. Các tham số này thuộc nhiệm vụ T2–T5.

## Số liệu trước/sau lấy từ đâu

Dữ liệu được tạo offline trên máy có file MT5:

```bash
# 1. backtest cấu hình hiện tại trên dữ liệu 3 năm
pnpm backtest --m5 XAUUSD_M5.csv --m15 XAUUSD_M15.csv --out .runtime/market-intel/bt3y
# 2. gắn trạng thái thư viện mẫu cho từng lệnh, tạo dataset cho API và in đề xuất
pnpm market-intel:proposal-dataset --trades .runtime/market-intel/bt3y/trades.csv \
  --h1 XAUUSD_H1.csv --h4 XAUUSD_H4.csv
# -> .runtime/market-intel/proposal-dataset.json (API đọc file này; đổi đường dẫn bằng ZIQ_MARKET_INTEL_PROPOSAL_DATASET)
```

Mỗi giá trị chỉ được **chọn** trên giai đoạn đầu (mặc định 2/3 số lệnh tính theo thời gian). Nhãn bằng chứng được quyết định
trên **giai đoạn còn lại, chưa dùng để chọn**, cùng với walk-forward 6 đoạn. Luật gắn nhãn này được viết vào code trước khi xem kết quả:

| Điều kiện "Đủ bằng chứng" | Ngưỡng |
| --- | --- |
| Số lệnh sau thay đổi ở giai đoạn chưa dùng | ≥ 30 |
| PF sau thay đổi ở giai đoạn chưa dùng | > 1,2 |
| Giai đoạn chưa dùng tốt hơn trước thay đổi | PF và lãi ròng đều tăng |
| Walk-forward | ≥ 4/6 đoạn có lãi ròng tăng |

Nếu nhật ký có lệnh thật, đề xuất có thêm dòng "Lệnh thật trong nhật ký (đối chiếu)". Dòng này chỉ để đối chiếu, không dùng để gắn nhãn.

Giới hạn của cách tính:
- Cách tính chỉ **bỏ bớt lệnh** khỏi danh sách lệnh backtest có sẵn. Nó không mô phỏng lệnh khác mà bot có thể mở thay vào.
- Backtest không phải bằng chứng sinh lời.

## Kết quả lần chạy đầu (dữ liệu 30/11/2023 – 26/11/2026)

Backtest cấu hình hiện tại: 1.745 lệnh, winrate 31,7%, PF 0,89, lỗ ròng −7.562 USD.

Theo trạng thái thư viện mẫu lúc vào lệnh:

| Nhóm | Lệnh | PF | Ròng (USD) |
| --- | --- | --- | --- |
| Cùng xu hướng | 541 | 1,14 | +2.950 |
| Ngược xu hướng | 194 | 0,65 | −2.715 |
| Sideway | 206 | 0,92 | −621 |
| Chuyển tiếp | 787 | 0,79 | −7.037 |

Có một đề xuất: **"Chỉ vào lệnh TREND khi cùng xu hướng của thư viện"** (`trendStrategyLibraryGate: OFF → WITH_TREND_ONLY`).
Nhãn hiện tại là **Chưa đủ bằng chứng**:

- Giai đoạn dùng để chọn (đến 31/12/2025): PF 0,93 → 0,99; lãi ròng −3.284 → −170 USD.
- Giai đoạn chưa dùng (từ 31/12/2025): 252 lệnh; PF 0,84 → 1,20; lãi ròng −4.278 → +1.961 USD.
- PF 1,20 chưa vượt ngưỡng > 1,2, nên đề xuất chưa đạt.
- Walk-forward: 5/6 đoạn tốt hơn. Đoạn 02/2025–07/2025 kém đi 1.040 USD.

Không có đề xuất cho lệnh SIDEWAY, vì không giá trị nào cải thiện được cả PF lẫn lãi ròng ở giai đoạn dùng để chọn.

## Bật / tắt

| Biến môi trường (API) | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `ZIQ_MARKET_INTEL_PROPOSALS_ENABLED` | tắt | Bật đề xuất, lịch chạy (kiểm tra mỗi giờ) và các nút Duyệt/Từ chối/Sửa/Rollback. |
| `ZIQ_MARKET_INTEL_PROPOSAL_DATASET` | `.runtime/market-intel/proposal-dataset.json` | Dataset backtest. |
| `ZIQ_MARKET_INTEL_TELEGRAM_NOTIFY` | tắt | Gửi tin **chỉ để báo**, không có nút bấm, với hai trường hợp: (1) có đề xuất mới; (2) kịch bản H4→H1→M15 có điểm ≥ 60%, tối đa một tin mỗi nến H1 (cần bật MTF). Dùng `ZIQ_TELEGRAM_BOT_TOKEN` và `ZIQ_TELEGRAM_CHAT_ID` sẵn có. |

API:
- Các route GET:
  - `GET /api/v1/market-intel/proposals`
  - `GET /api/v1/market-intel/proposals/config/:version/export`
- Các route ghi, chỉ chạy từ loopback hoặc khi có token vận hành `x-phase7c-token`, và chỉ ghi vào file nhật ký:
  - `POST /run`
  - `POST /:id/decision` với `APPROVE`, `REJECT` hoặc `EDIT` + `editedValue`
  - `POST /config/rollback`
  - `POST /config/:version/deployed`

## Lưu trữ và audit

Mọi thứ được lưu trong `.runtime/market-intel/market-intel.sqlite` (lược đồ v2, tự nâng cấp từ v1). File này không được commit.

Các bảng `analysis_runs`, `proposals`, `proposal_decisions`, `config_versions`, `config_deployments` và `audit_log` đều
**chỉ được thêm**: trigger SQLite chặn UPDATE/DELETE. Phiên bản 1 là baseline (mọi bộ lọc tắt, đúng hành vi hiện tại) và đang chạy.

Gói cấu hình (`/export`) gồm:
- tham số và `sha256`;
- `applyTo: NEW_POSITIONS_ONLY`;
- điều kiện triển khai: PAUSE, không còn lệnh XAUUSD mở, đường Phase 7C có bảo vệ, chủ dự án duyệt.
