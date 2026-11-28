import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Grid, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { getMarketIntelSnapshot } from "../api";
import type { MarketIntelFrame, MarketIntelLevel, MarketIntelManagementPlan, MarketIntelScenario, MarketIntelSnapshot, MarketIntelState } from "../market-intel-types";
import { ErrorState, LoadingState } from "../ui/PageState";
import { MarketIntelJournalCard } from "./MarketIntelJournalCard";
import { MarketIntelProposalsCard } from "./MarketIntelProposalsCard";

// Read-only page: nothing here sends, modifies or closes orders, or changes BOT_MODE / LIVE ARM.

type Tf = "h4" | "h1" | "m15";
type SampleState = "uptrend" | "downtrend" | "sideway";
const TF_LABEL: Record<Tf, string> = { h4: "H4", h1: "H1", m15: "M15" };
const TF_ROLE: Record<Tf, string> = { h4: "Bối cảnh", h1: "Xác nhận", m15: "Điểm vào" };
const STATE: Record<MarketIntelState, string> = { UPTREND: "Tăng", DOWNTREND: "Giảm", SIDEWAY: "Đi ngang", TRANSITION: "Chuyển tiếp" };
const STATE_COLOR: Record<MarketIntelState, "success" | "error" | "info" | "default"> = { UPTREND: "success", DOWNTREND: "error", SIDEWAY: "info", TRANSITION: "default" };
const SAMPLE_LABEL: Record<SampleState, string> = { uptrend: "Uptrend", downtrend: "Downtrend", sideway: "Sideway" };
const M15_STATUS: Record<string, { label: string; color: "success" | "warning" | "default" }> = {
  TRIGGERED: { label: "M15 đã có tín hiệu", color: "success" },
  TOUCHED_NO_TRIGGER: { label: "M15 đã chạm vùng, chưa có tín hiệu", color: "warning" },
  WAITING: { label: "Chờ giá về vùng vào", color: "default" },
};
const BIAS: Record<string, string> = { BUY: "ưu tiên Mua", SELL: "ưu tiên Bán", RANGE: "đi ngang, vào ở biên", NONE: "chưa có hướng ưu tiên" };
const AGREEMENT: Record<string, string> = { AGREE: "đồng thuận H4", DISAGREE: "ngược H4", NEUTRAL: "trung tính" };
const PHASE: Record<string, string> = { PHA_HOI: "pha hồi", PHA_DAY: "pha đẩy", KHONG_RO: "chưa rõ pha" };

const num = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v: number) => `${v > 0 ? "+" : ""}${num(v)}`;
const serverTime = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const localTime = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const sampleSrc = (state: SampleState, k: 1 | 2, tf: "h1" | "h4") => `${import.meta.env.BASE_URL}market-intel-samples/${state}-${k}-${tf}.svg`;
const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontVariantNumeric: "tabular-nums" } as const;

/** Refetch shortly after the next M15 bar closes (bridge needs a moment to publish it). */
function nextRefetchDelayMs(snapshot: Pick<MarketIntelSnapshot, "generatedAt" | "nextM15CloseAt"> | undefined): number {
  if (!snapshot) return 60_000;
  const delay = snapshot.nextM15CloseAt - snapshot.generatedAt + 20_000;
  return Math.min(16 * 60_000, Math.max(15_000, delay));
}

/** Library state of a timeframe; falls back to the regime / MTF result when the API has no `frames` yet. */
function stateOf(snapshot: MarketIntelSnapshot, tf: Tf): { state: MarketIntelState; confidence: number } | null {
  const f = snapshot.frames?.[tf];
  if (f) return { state: f.state, confidence: f.confidence };
  if (tf !== "m15" && snapshot.regime) return { state: snapshot.regime[tf].state, confidence: snapshot.regime[tf].confidence };
  if (tf !== "m15" && snapshot.mtf) return { state: snapshot.mtf[tf].state, confidence: snapshot.mtf[tf].confidence };
  return null;
}

/** Sample to compare against: the timeframe's own state, or its best-scoring template when it is in transition. */
function sampleFor(snapshot: MarketIntelSnapshot, tf: "h1" | "h4"): SampleState {
  const s = stateOf(snapshot, tf)?.state;
  if (s === "UPTREND") return "uptrend";
  if (s === "DOWNTREND") return "downtrend";
  if (s === "SIDEWAY") return "sideway";
  const scores = snapshot.regime?.[tf].scores ?? {};
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0];
  return best === "DOWNTREND" ? "downtrend" : best === "SIDEWAY" ? "sideway" : "uptrend";
}

function PriceCell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body1" fontWeight={800} sx={{ ...mono, color: tone === "up" ? "success.main" : tone === "down" ? "error.main" : "text.primary" }}>{value}</Typography>
    </Box>
  );
}

function FrameCard({ tf, frame, state }: { tf: Tf; frame: MarketIntelFrame | null | undefined; state: { state: MarketIntelState; confidence: number } | null }) {
  const tone = frame ? (frame.candle === "UP" ? "up" : frame.candle === "DOWN" ? "down" : undefined) : undefined;
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="baseline">
            <Typography variant="h6" fontWeight={900}>{TF_LABEL[tf]}</Typography>
            <Typography variant="caption" color="text.secondary">{TF_ROLE[tf]}</Typography>
          </Stack>
          {state
            ? <Chip size="small" color={STATE_COLOR[state.state]} label={`${STATE[state.state]} · ${state.confidence}%`} />
            : <Chip size="small" variant="outlined" label="Chưa có dữ liệu" />}
        </Stack>
        {frame ? (
          <>
            <Grid container spacing={1} sx={{ mt: 1 }}>
              <Grid size={6}><PriceCell label="Giá mở" value={num(frame.open)} /></Grid>
              <Grid size={6}><PriceCell label="Giá đóng" value={num(frame.close)} tone={tone} /></Grid>
            </Grid>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, ...mono }}>
              <Box component="span" sx={{ color: tone === "up" ? "success.main" : tone === "down" ? "error.main" : "text.secondary", fontWeight: 700 }}>
                {signed(frame.change)} ({signed(frame.changePct)}%)
              </Box>
              {" · "}Cao {num(frame.high)} · Thấp {num(frame.low)}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              Nến {hhmm(frame.openTime)}–{hhmm(frame.closeTime)} (giờ server, nến đã đóng)
            </Typography>
          </>
        ) : (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {tf === "m15" ? "Bật ZIQ_MARKET_INTEL_MTF_ENABLED để xem M15." : "Chưa nhận được nến từ MT5 bridge."}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function TimeframesSection({ snapshot }: { snapshot: MarketIntelSnapshot }) {
  const r = snapshot.regime;
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={900}>Từng khung thời gian</Typography>
        {r && <Chip size="small" variant="outlined" label={r.alignment === "ALIGNED" ? "H4 và H1 đồng thuận" : r.alignment === "CONFLICT" ? "H4 và H1 ngược nhau" : "H4/H1 chưa đồng thuận"} />}
      </Stack>
      <Grid container spacing={1.5}>
        {(["h4", "h1", "m15"] as const).map((tf) => (
          <Grid key={tf} size={{ xs: 12, md: 4 }}>
            <FrameCard tf={tf} frame={snapshot.frames?.[tf]} state={stateOf(snapshot, tf)} />
          </Grid>
        ))}
      </Grid>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        Xu hướng theo thư viện mẫu, chỉ để tham khảo. Bot vẫn dùng bộ phân loại regime hiện tại để chọn TREND / SIDEWAY / PAUSE.
      </Typography>
    </Box>
  );
}

function LevelBox({ label, price, detail, color }: { label: string; price: number; detail: string; color: "text.primary" | "error.main" | "success.main" }) {
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1, height: "100%" }}>
      <Typography variant="caption" fontWeight={800} sx={{ color }}>{label}</Typography>
      <Typography variant="h6" fontWeight={900} sx={{ ...mono, color, lineHeight: 1.2 }}>{num(price)}</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3 }}>{detail}</Typography>
    </Box>
  );
}

/** Reasons for the trade (positive rule points) and the points against it, from the confidence breakdown. */
function reasonsOf(s: MarketIntelScenario): { pro: string[]; con: string[] } {
  const pro: string[] = [];
  const con: string[] = [];
  for (const f of s.confidenceBreakdown) {
    if (f.factor === "Điểm nền") continue;
    if (f.points > 0) pro.push(f.factor);
    else if (f.points < 0) con.push(f.factor);
    else con.push(f.factor); // 0 points: neutral, worth knowing (e.g. "M15 chưa chạm vùng")
  }
  if (!s.botStopRule.withinRule) con.push(s.botStopRule.note);
  return { pro, con };
}

const FRACTION_LABEL = (f: number) => (Math.abs(f - 1 / 3) < 1e-6 ? "1/3" : Math.abs(f - 1 / 2) < 1e-6 ? "1/2" : `${Math.round(f * 100)}%`);

/** "Gồng lệnh": where to move the stop and how much to close at each target. Advisory only. */
function ManagementPlanBox({ plan }: { plan: MarketIntelManagementPlan }) {
  return (
    <Box sx={{ mt: 1.5, p: 1.2, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
      <Typography variant="body2" fontWeight={900}>Gợi ý quản lý lệnh (gồng trend)</Typography>
      <Typography variant="caption" fontWeight={800} color="text.secondary" display="block" sx={{ mt: 0.8 }}>CHỐT VOL</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {plan.partials.map((p) => (
          <Typography key={p.id} component="li" variant="body2">
            <b>{FRACTION_LABEL(p.fraction)}{p.lot !== null ? ` (${p.lot.toFixed(2)} lot)` : ""}</b> ở {p.label} <Box component="span" sx={mono}>{num(p.price)}</Box> · {p.reason}
          </Typography>
        ))}
      </Box>
      <Typography variant="caption" fontWeight={800} color="text.secondary" display="block" sx={{ mt: 0.8 }}>DỜI SL (CHỈ SIẾT)</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {plan.stopSteps.map((st) => (
          <Typography key={st.id} component="li" variant="body2">
            <b>{st.when}</b>
            {st.triggerPrice !== null ? <> (<Box component="span" sx={mono}>{num(st.triggerPrice)}</Box>)</> : null}
            {st.newStop !== null ? <> → SL <Box component="span" sx={{ ...mono, fontWeight: 800 }}>{num(st.newStop)}</Box></> : null}
            {" · "}{st.reason}
            {st.id === "TRAIL_M15_SWING" ? (
              st.currentCandidate != null
                ? <> Hiện tại: {plan.direction === "BUY" ? "đáy" : "đỉnh"} M15 <Box component="span" sx={mono}>{num(st.swingPrice ?? 0)}</Box> → SL gợi ý <Box component="span" sx={{ ...mono, fontWeight: 800 }}>{num(st.currentCandidate)}</Box>.</>
                : <> Hiện chưa có {plan.direction === "BUY" ? "đáy" : "đỉnh"} M15 nào đủ xa entry để dời.</>
            ) : null}
          </Typography>
        ))}
      </Box>
      <Typography variant="body2" sx={{ mt: 0.8 }}><b>Thoát phần còn lại:</b> {plan.exit.text}</Typography>
      {plan.notes.map((n) => <Typography key={n} variant="caption" color="text.secondary" display="block" sx={{ mt: 0.4 }}>{n}</Typography>)}
    </Box>
  );
}

function ScenarioCard({ s, plan }: { s: MarketIntelScenario; plan?: MarketIntelManagementPlan }) {
  const buy = s.direction === "BUY";
  const m15 = M15_STATUS[s.m15.status] ?? { label: s.m15.status, color: "default" as const };
  const { pro, con } = reasonsOf(s);
  const tpDist = (tp: number) => num(Math.abs(tp - s.entry));
  return (
    <Card variant="outlined" sx={{ height: "100%", borderLeft: 4, borderLeftColor: buy ? "success.main" : "error.main" }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" color={buy ? "success" : "error"} label={buy ? "MUA" : "BÁN"} sx={{ fontWeight: 900 }} />
          <Typography variant="subtitle2" fontWeight={900}>{s.role === "PRIMARY" ? "Kịch bản chính" : "Kịch bản thay thế"}</Typography>
          <Chip size="small" variant="outlined" label={`Điểm ${s.confidence}/90`} />
          <Chip size="small" color={m15.color} variant={m15.color === "default" ? "outlined" : "filled"} label={m15.label} />
        </Stack>

        <Grid container spacing={1} sx={{ mt: 1.5 }}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <LevelBox label="ENTRY" price={s.entry} color="text.primary" detail={`Vùng ${num(s.entryZone.low)}–${num(s.entryZone.high)}`} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <LevelBox label="SL" price={s.stopLoss} color="error.main" detail={`Rủi ro ${num(s.botStopRule.stopDistance)} giá`} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <LevelBox label="TP1" price={s.takeProfit1} color="success.main" detail={`+${tpDist(s.takeProfit1)} giá · R:R ${s.rr1}`} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <LevelBox label="TP2" price={s.takeProfit2} color="success.main" detail={`+${tpDist(s.takeProfit2)} giá · R:R ${s.rr2}`} />
          </Grid>
        </Grid>

        <Typography variant="body2" fontWeight={800} sx={{ mt: 1.5 }}>Lý do vào lệnh</Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {!pro.some((p) => p.startsWith("Vùng")) && <Typography component="li" variant="body2">Vùng vào: {s.entryZone.sources.join(" + ")}</Typography>}
          {pro.map((p) => <Typography key={p} component="li" variant="body2">{p}</Typography>)}
          <Typography component="li" variant="body2">Mục tiêu: TP1 theo {s.targetsSource.tp1}, TP2 theo {s.targetsSource.tp2}</Typography>
        </Box>
        {con.length > 0 && (
          <>
            <Typography variant="body2" fontWeight={800} sx={{ mt: 1 }} color="warning.main">Điểm trừ / cần lưu ý</Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {con.map((c) => <Typography key={c} component="li" variant="body2" color="text.secondary">{c}</Typography>)}
            </Box>
          </>
        )}
        <Typography variant="body2" sx={{ mt: 1 }}><b>Huỷ kịch bản:</b> {s.invalidation.text}</Typography>
        {plan ? <ManagementPlanBox plan={plan} /> : null}
        <Divider sx={{ my: 1 }} />
        <Typography variant="caption" color="text.secondary" display="block">
          Tham khảo, không phải lệnh. Điểm là điểm theo luật cố định, không phải xác suất. {s.botStopRule.withinRule ? s.botStopRule.note : ""}
        </Typography>
      </CardContent>
    </Card>
  );
}

function ScenariosSection({ snapshot }: { snapshot: MarketIntelSnapshot }) {
  const mtf = snapshot.mtf;
  if (!mtf) return null;
  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
          <Typography variant="subtitle1" fontWeight={900}>Đề xuất lệnh (tham khảo)</Typography>
          <Typography variant="caption" color="text.secondary">H4 → H1 → M15 · nến M15 đóng {serverTime(mtf.asOf)} (giờ server)</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          H4 {BIAS[mtf.h4.bias] ?? mtf.h4.bias} · H1 {AGREEMENT[mtf.h1.agreement] ?? mtf.h1.agreement}, {PHASE[mtf.h1.phase] ?? mtf.h1.phase} · Giá M15 {num(mtf.m15.close)}
        </Typography>
        {mtf.notes.map((n) => <Typography key={n} variant="caption" color="text.secondary" display="block">{n}</Typography>)}
        {mtf.scenarios.length === 0 ? (
          <Alert severity="info" sx={{ mt: 1 }}>Chưa có đề xuất: thị trường chưa rõ hướng hoặc chưa có vùng vào phù hợp.</Alert>
        ) : (
          <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
            {mtf.scenarios.map((s, i) => <Grid key={s.role} size={{ xs: 12, lg: 6 }}><ScenarioCard s={s} plan={snapshot.managementPlans?.[i]} /></Grid>)}
          </Grid>
        )}
      </CardContent>
    </Card>
  );
}

function LevelsRow({ title, levels, color }: { title: string; levels: MarketIntelLevel[]; color: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="caption" fontWeight={800} sx={{ color, minWidth: 64 }}>{title}</Typography>
      {levels.length === 0
        ? <Typography variant="caption" color="text.secondary">không có vùng gần</Typography>
        : levels.map((l) => (
          <Chip key={`${l.kind}-${l.price}`} size="small" variant="outlined" sx={{ borderColor: color, ...mono }}
            label={`${num(l.price)} · ${l.tf} · ${l.touches} chạm`} title={`Vùng ${num(l.low)}–${num(l.high)}`} />
        ))}
    </Stack>
  );
}

/** Nearest support / resistance (H4 + H1 key levels) around the M15 close: where TP and SL usually sit. */
function LevelsPanel({ snapshot }: { snapshot: MarketIntelSnapshot }) {
  const lv = snapshot.levels;
  if (!lv) return null;
  return (
    <Box sx={{ mt: 1, p: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Stack spacing={0.5}>
        <LevelsRow title="Kháng cự" levels={lv.resistance} color="#e3b341" />
        <LevelsRow title="Hỗ trợ" levels={lv.support} color="#39c5cf" />
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        Vùng gần giá nhất từ đỉnh/đáy H4 và H1 (gần → xa), cũng là các dải màu trên chart. TP thường đặt trước kháng cự (lệnh Mua) hoặc trước hỗ trợ (lệnh Bán); SL đặt phía sau vùng đối diện. Chỉ để tham khảo.
      </Typography>
    </Box>
  );
}

function ChartImage({ src, alt }: { src: string; alt: string }) {
  return (
    <Box
      component="a" href={src} target="_blank" rel="noreferrer" title="Mở ảnh lớn"
      sx={{ display: "block", borderRadius: 1, overflow: "hidden", border: 1, borderColor: "divider" }}
    >
      <Box component="img" alt={alt} src={src} sx={{ width: "100%", height: "auto", display: "block" }} />
    </Box>
  );
}

function ChartsSection({ snapshot }: { snapshot: MarketIntelSnapshot }) {
  const [tf, setTf] = useState<Tf>("m15");
  const [sample, setSample] = useState<SampleState | null>(null);
  const [k, setK] = useState<1 | 2>(1);
  if (!snapshot.charts) return null;
  const charts = snapshot.charts;
  const sampleTf = tf === "m15" ? null : tf;
  const shownSample = sampleTf ? sample ?? sampleFor(snapshot, sampleTf) : null;
  return (
    <Card>
      <CardContent>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={900}>Biểu đồ</Typography>
          <Tabs value={tf} onChange={(_, v: Tf) => { setTf(v); setSample(null); }} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5 } }}>
            <Tab value="m15" label="M15 · điểm vào" />
            <Tab value="h1" label="H1 · so với mẫu" />
            <Tab value="h4" label="H4 · so với mẫu" />
          </Tabs>
        </Stack>
        <LevelsPanel snapshot={snapshot} />
        {sampleTf && shownSample ? (
          <>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">Mẫu so sánh:</Typography>
              <ToggleButtonGroup size="small" exclusive value={shownSample} onChange={(_, v: SampleState | null) => v && setSample(v)}>
                {(["uptrend", "downtrend", "sideway"] as const).map((s) => <ToggleButton key={s} value={s} sx={{ py: 0.25 }}>{SAMPLE_LABEL[s]}</ToggleButton>)}
              </ToggleButtonGroup>
              <ToggleButtonGroup size="small" exclusive value={k} onChange={(_, v: 1 | 2 | null) => v && setK(v)}>
                <ToggleButton value={1} sx={{ py: 0.25 }}>Mẫu 1</ToggleButton>
                <ToggleButton value={2} sx={{ py: 0.25 }}>Mẫu 2</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
              <Grid size={{ xs: 12, lg: 6 }}>
                <Typography variant="caption" fontWeight={800} display="block" sx={{ mb: 0.5 }}>Hiện tại · {TF_LABEL[sampleTf]}</Typography>
                <ChartImage src={svgSrc(charts[sampleTf])} alt={`Chart ${TF_LABEL[sampleTf]} hiện tại`} />
              </Grid>
              <Grid size={{ xs: 12, lg: 6 }}>
                <Typography variant="caption" fontWeight={800} display="block" sx={{ mb: 0.5 }}>Mẫu {SAMPLE_LABEL[shownSample]} {k} · {TF_LABEL[sampleTf]} (thư viện, dữ liệu lịch sử)</Typography>
                <ChartImage src={sampleSrc(shownSample, k, sampleTf)} alt={`Mẫu ${SAMPLE_LABEL[shownSample]} ${k} ${TF_LABEL[sampleTf]}`} />
              </Grid>
            </Grid>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Mẫu mặc định theo trạng thái hiện tại của khung {TF_LABEL[sampleTf]} (khi đang chuyển tiếp: mẫu có điểm khớp cao nhất). So sánh hình dạng đỉnh/đáy, EMA50/EMA200 và BOS/CHoCH.
            </Typography>
          </>
        ) : (
          <Box sx={{ mt: 1 }}><ChartImage src={svgSrc(charts.m15)} alt="Chart M15 hiện tại" /></Box>
        )}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          Các đường vào lệnh, SL và TP là của kịch bản chính. Phần "Dự kiến" trên M15 chỉ minh hoạ đường đi nếu kịch bản đúng, không phải dự báo. Bấm vào chart để mở ảnh lớn.
        </Typography>
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
  if (query.error) {
    // Journal and proposals do not depend on live candles: keep them usable when the bridge is down.
    return (
      <Stack spacing={2}>
        <ErrorState message={query.error instanceof Error ? query.error.message : "Không tải được phân tích."} />
        <MarketIntelJournalCard />
        <MarketIntelProposalsCard />
      </Stack>
    );
  }
  const snapshot = query.data;
  if (!snapshot) return <Stack spacing={2}><MarketIntelJournalCard /><MarketIntelProposalsCard /></Stack>;
  const on = snapshot.enabled.regimeLibrary || snapshot.enabled.mtf;
  return (
    <Stack spacing={2}>
      <Alert severity="info" sx={{ py: 0.25 }}>
        Phân tích thị trường và kịch bản chỉ để tham khảo. Trang này không gửi, sửa hay đóng lệnh, không đổi chế độ bot.
        Độ tin cậy là điểm theo luật, không phải xác suất. Tự chấm 3 năm: TP1 đến trước SL khoảng 32%, PF 0,62 (giai đoạn chưa dùng 0,54),
        tức là kịch bản chưa có lợi thế. Chart "dự kiến" chỉ minh hoạ đường đi nếu kịch bản đúng, không phải dự báo.
      </Alert>
      {on && (
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
      {!on && (
        <Alert severity="warning">
          Chức năng đang tắt. Đặt ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED=true và/hoặc ZIQ_MARKET_INTEL_MTF_ENABLED=true cho API rồi khởi động lại API.
        </Alert>
      )}
      {on && <TimeframesSection snapshot={snapshot} />}
      <ScenariosSection snapshot={snapshot} />
      <ChartsSection snapshot={snapshot} />
      <MarketIntelJournalCard />
      <MarketIntelProposalsCard />
    </Stack>
  );
}
