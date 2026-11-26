import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Stack, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import { getMarketIntelSnapshot } from "../api";
import type { MarketIntelScenario, MarketIntelSnapshot, MarketIntelState } from "../market-intel-types";
import { ErrorState, LoadingState } from "../ui/PageState";

const STATE: Record<MarketIntelState, string> = { UPTREND: "Uptrend", DOWNTREND: "Downtrend", SIDEWAY: "Sideway", TRANSITION: "Chuyển tiếp" };
const STATE_COLOR: Record<MarketIntelState, "success" | "error" | "info" | "default"> = { UPTREND: "success", DOWNTREND: "error", SIDEWAY: "info", TRANSITION: "default" };
const M15: Record<string, string> = { TRIGGERED: "đã có tín hiệu", TOUCHED_NO_TRIGGER: "đã chạm vùng, chưa có tín hiệu", WAITING: "chưa chạm vùng" };
const PHASE: Record<string, string> = { PHA_HOI: "pha hồi", PHA_DAY: "pha đẩy", KHONG_RO: "chưa rõ" };
const time = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const localTime = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Refetch shortly after the next M15 bar closes (bridge needs a moment to publish it). */
function nextRefetchDelayMs(snapshot: Pick<MarketIntelSnapshot, "generatedAt" | "nextM15CloseAt"> | undefined): number {
  if (!snapshot) return 60_000;
  const delay = snapshot.nextM15CloseAt - snapshot.generatedAt + 20_000;
  return Math.min(16 * 60_000, Math.max(15_000, delay));
}
const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function RegimeCard({ snapshot }: { snapshot: MarketIntelSnapshot }) {
  const r = snapshot.regime;
  if (!r) return null;
  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle1" fontWeight={900}>Trạng thái thị trường (thư viện mẫu)</Typography>
          <Chip size="small" color={STATE_COLOR[r.state]} label={`${STATE[r.state]} · ${r.alignment}`} />
          <Typography variant="caption" color="text.secondary">{snapshot.versions.regimeLibrary}</Typography>
        </Stack>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {(["h4", "h1"] as const).map((tf) => (
            <Grid key={tf} size={{ xs: 12, md: 6 }}>
              <Typography variant="body2" fontWeight={800}>{tf.toUpperCase()}: {STATE[r[tf].state]} ({r[tf].confidence}%)</Typography>
              <Typography variant="caption" color="text.secondary">
                Điểm: {Object.entries(r[tf].scores).map(([k, v]) => `${STATE[k as MarketIntelState] ?? k} ${Math.round(v * 100)}%`).join(" · ")}
              </Typography>
            </Grid>
          ))}
        </Grid>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Chỉ để tham khảo. Bot vẫn dùng bộ phân loại regime hiện tại để chọn TREND / SIDEWAY / PAUSE.
        </Typography>
      </CardContent>
    </Card>
  );
}

function ScenarioCard({ s }: { s: MarketIntelScenario }) {
  const rows: [string, string][] = [
    ["Vùng vào", `${s.entryZone.low}–${s.entryZone.high} (${s.entryZone.sources.join(" + ")})`],
    ["Entry tham chiếu", String(s.entry)],
    ["SL", `${s.stopLoss} · cách ${s.botStopRule.stopDistance} giá · ${s.botStopRule.note}`],
    ["TP1", `${s.takeProfit1} (${s.targetsSource.tp1}) · R:R ${s.rr1}`],
    ["TP2", `${s.takeProfit2} (${s.targetsSource.tp2}) · R:R ${s.rr2}`],
    ["Mất hiệu lực", s.invalidation.text],
    ["M15", M15[s.m15.status] ?? s.m15.status],
  ];
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2" fontWeight={900}>{s.role === "PRIMARY" ? "Kịch bản chính" : "Kịch bản thay thế"}</Typography>
          <Chip size="small" color={s.direction === "BUY" ? "success" : "error"} label={s.direction === "BUY" ? "MUA" : "BÁN"} />
          <Chip size="small" variant="outlined" label={`Điểm ${s.confidence}%`} />
        </Stack>
        <Table size="small" sx={{ mt: 1 }}>
          <TableBody>
            {rows.map(([k, v]) => (
              <TableRow key={k}><TableCell sx={{ fontWeight: 700, width: 140 }}>{k}</TableCell><TableCell>{v}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {s.confidenceBreakdown.map((f) => `${f.points >= 0 ? "+" : ""}${f.points} ${f.factor}`).join(" · ")}
        </Typography>
        <Typography variant="caption" color="warning.main" display="block">{s.confidenceNote}</Typography>
      </CardContent>
    </Card>
  );
}

export function MarketIntelPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["market-intel-snapshot"],
    queryFn: () => getMarketIntelSnapshot(false),
    refetchInterval: (q) => nextRefetchDelayMs(q.state.data),
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: () => getMarketIntelSnapshot(true),
    onSuccess: (data) => client.setQueryData(["market-intel-snapshot"], data),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error instanceof Error ? query.error.message : "Không tải được phân tích."} />;
  const snapshot = query.data;
  if (!snapshot) return null;
  const mtf = snapshot.mtf;
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Phân tích thị trường và kịch bản chỉ để tham khảo. Trang này không gửi, sửa hay đóng lệnh, không đổi chế độ bot.
        Độ tin cậy là điểm theo luật, không phải xác suất. Tự chấm 3 năm: TP1 đến trước SL khoảng 32%, PF 0,62 (giai đoạn chưa dùng 0,54),
        tức là kịch bản chưa có lợi thế. Chart "dự kiến" chỉ minh hoạ đường đi nếu kịch bản đúng, không phải dự báo.
      </Alert>
      {(snapshot.enabled.regimeLibrary || snapshot.enabled.mtf) && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Button size="small" variant="contained" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? "Đang cập nhật…" : "Cập nhật"}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Cập nhật lúc {localTime(snapshot.generatedAt)} · tự động sau mỗi nến M15 đóng (lần tới khoảng {localTime(snapshot.nextM15CloseAt + 20_000)})
          </Typography>
          {refresh.error && <Typography variant="caption" color="error">{refresh.error instanceof Error ? refresh.error.message : "Cập nhật thất bại."}</Typography>}
        </Stack>
      )}
      {!snapshot.enabled.regimeLibrary && !snapshot.enabled.mtf && (
        <Alert severity="warning">
          Chức năng đang tắt. Đặt ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED=true và/hoặc ZIQ_MARKET_INTEL_MTF_ENABLED=true cho API rồi khởi động lại API.
        </Alert>
      )}
      <RegimeCard snapshot={snapshot} />
      {mtf && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={900}>Phân tích H4 → H1 → M15 · {time(mtf.asOf)} (giờ server)</Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              H4 {STATE[mtf.h4.state]} ({mtf.h4.confidence}%), hướng ưu tiên {mtf.h4.bias}. H1 {STATE[mtf.h1.state]}, {mtf.h1.agreement}, {PHASE[mtf.h1.phase] ?? mtf.h1.phase}. Giá M15 {mtf.m15.close}.
            </Typography>
            {mtf.notes.map((n) => <Typography key={n} variant="caption" color="text.secondary" display="block">{n}</Typography>)}
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {mtf.scenarios.map((s) => <Grid key={s.role} size={{ xs: 12, lg: 6 }}><ScenarioCard s={s} /></Grid>)}
            </Grid>
          </CardContent>
        </Card>
      )}
      {snapshot.charts && (
        <Stack spacing={2}>
          {(["m15", "h1", "h4"] as const).map((tf) => (
            <Card key={tf}><CardContent>
              <Box component="img" alt={`Chart ${tf.toUpperCase()}`} src={svgSrc(snapshot.charts![tf])} sx={{ width: "100%", height: "auto", display: "block" }} />
            </CardContent></Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
