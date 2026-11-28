import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import RestartAltRounded from "@mui/icons-material/RestartAltRounded";
import { getPhase7COfflineBacktestStatus, runPhase7COfflineBacktest } from "../api";
import type {
  BacktestMetrics,
  BacktestStrategy,
  EquityPoint,
  OfflineBacktestRequest,
  OfflineBacktestResult,
  PartialFraction,
} from "../phase7c-offline-backtest-types";
import { ErrorState, LoadingState } from "../ui/PageState";

// Offline replay only: this page reads MT5 CSV history through the API worker. It cannot send, modify or
// close orders, and cannot change BOT_MODE, LIVE ARM, lot settings or the running bot's configuration.

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontVariantNumeric: "tabular-nums" } as const;
const usd = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pf = (v: number | null) => (v === null ? "∞" : v.toFixed(2));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const r3 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}`;
const dt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const tableSx = { "& td, & th": { px: { xs: 0.6, md: 1 }, py: 0.6, whiteSpace: "nowrap", fontSize: { xs: 12, md: 14 } } } as const;
const pfTone = (v: number | null) => (v === null || v > 1.2 ? "success.main" : v > 1 ? "warning.main" : "error.main");

const EXIT_LABEL: Record<string, string> = {
  STOP_LOSS: "SL ban đầu",
  STOP_AFTER_BE: "SL sau hoà vốn / dời SL",
  TAKE_PROFIT: "TP",
  REVERSAL_FVG_REJECTION: "FVG ngược",
  RUNNER_TREND_MA50: "Đóng dưới/trên MA50",
  END_OF_DATA: "Hết dữ liệu",
};

/** Number input that keeps what the user types ("8," on a phone keyboard) and commits valid numbers only. */
function NumField({ label, value, onChange, disabled, min, max, step = 0.5, helper }: {
  label: string; value: number; onChange: (v: number) => void; disabled?: boolean; min: number; max: number; step?: number; helper?: string;
}) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  const parsed = Number(text.replace(",", "."));
  if (seen !== value) {
    // value changed from outside (reset button): show it unless the typed text already means it
    setSeen(value);
    if (parsed !== value) setText(String(value));
  }
  const invalid = text.trim() === "" || !Number.isFinite(parsed) || parsed < min || parsed > max;
  return (
    <TextField
      label={label}
      size="small"
      value={text}
      disabled={disabled}
      error={!disabled && invalid}
      helperText={!disabled && invalid ? `${min}–${max}` : helper}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value.replace(",", "."));
        if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
      inputProps={{ inputMode: "decimal", step, "aria-label": label }}
      sx={{ minWidth: 0 }}
      fullWidth
    />
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Box>
      <FormControlLabel
        control={<Switch checked={checked} onChange={(e) => onChange(e.target.checked)} />}
        label={<Typography variant="body2" fontWeight={800}>{label}</Typography>}
      />
      {hint ? <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: -0.5, ml: 6 }}>{hint}</Typography> : null}
    </Box>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 2, border: "1px solid rgba(148,163,184,.14)", bgcolor: "rgba(255,255,255,.015)" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={900}>{title}</Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

/** Differences from the running configuration, in words. */
function differences(req: OfflineBacktestRequest, d: OfflineBacktestRequest): string[] {
  const out: string[] = [];
  if (req.maxInitialStopPrice !== d.maxInitialStopPrice) out.push(`SL tối đa ${req.maxInitialStopPrice}`);
  if (!req.breakEven.enabled) out.push("Tắt hoà vốn");
  else if (req.breakEven.triggerPrice !== d.breakEven.triggerPrice || req.breakEven.offsetPrice !== d.breakEven.offsetPrice) {
    out.push(`BE +${req.breakEven.triggerPrice} → entry ${req.breakEven.offsetPrice ? `+${req.breakEven.offsetPrice}` : ""}`.trim());
  }
  if (req.fixedTp.enabled) out.push(`TP cố định ${req.fixedTp.price}`);
  if (!req.partial.enabled) out.push("Tắt chốt một phần");
  else if (req.partial.triggerPrice !== d.partial.triggerPrice || req.partial.fraction !== d.partial.fraction) out.push(`Chốt ${req.partial.fraction} ở +${req.partial.triggerPrice}`);
  if (!req.fastMove.enabled) out.push("Tắt FastMove");
  else if (req.fastMove.activationPrice !== d.fastMove.activationPrice || req.fastMove.givebackPrice !== d.fastMove.givebackPrice) out.push(`FastMove ${req.fastMove.activationPrice}/${req.fastMove.givebackPrice}`);
  if (!req.m5Trail.enabled) out.push("Tắt dời SL theo M5");
  if (!req.runnerExits.enabled) out.push("Tắt thoát FVG/MA50");
  return out;
}

function EquityChart({ test, baseline }: { test: EquityPoint[]; baseline: EquityPoint[] | null }) {
  const width = 900;
  const height = 260;
  const pad = 28;
  const all = [...test, ...(baseline ?? [])];
  if (test.length < 2) return <Typography variant="body2" color="text.secondary">Chưa đủ lệnh để vẽ đường vốn.</Typography>;
  const t0 = Math.min(...all.map((p) => p.time));
  const t1 = Math.max(...all.map((p) => p.time));
  const vals = [0, ...all.map((p) => p.equityUsd)];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (width - pad * 2);
  const y = (v: number) => pad + ((hi - v) / Math.max(1e-6, hi - lo)) * (height - pad * 2);
  const path = (pts: EquityPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(1)} ${y(p.equityUsd).toFixed(1)}`).join(" ");
  const last = test.at(-1)!;
  return (
    <Box sx={{ maxWidth: 980 }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Đường vốn">
        <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke="rgba(148,163,184,.35)" strokeDasharray="4 6" />
        <text x={pad} y={y(0) - 4} fill="#94a3b8" fontSize="18">0</text>
        {baseline && baseline.length > 1 ? <path d={path(baseline)} fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="7 5" /> : null}
        <path d={path(test)} fill="none" stroke={last.equityUsd >= 0 ? "#32d583" : "#f97066"} strokeWidth="3.5" strokeLinejoin="round" />
        <text x={width - pad} y={pad - 6} textAnchor="end" fill="#94a3b8" fontSize="18">{usd(hi)}</text>
        <text x={width - pad} y={height - 6} textAnchor="end" fill="#94a3b8" fontSize="18">{usd(lo)}</text>
      </svg>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <Typography variant="caption" sx={{ color: last.equityUsd >= 0 ? "#32d583" : "#f97066", fontWeight: 800 }}>━ Cấu hình đang thử</Typography>
        {baseline ? <Typography variant="caption" color="text.secondary" fontWeight={800}>┅ Cấu hình đang chạy</Typography> : null}
        <Typography variant="caption" color="text.secondary">USD lũy kế theo thời điểm đóng lệnh</Typography>
      </Stack>
    </Box>
  );
}

function MetricsTable({ rows, first = "Nhóm" }: { rows: [string, BacktestMetrics][]; first?: string }) {
  if (!rows.length) return <Typography variant="body2" color="text.secondary">Không có lệnh.</Typography>;
  return (
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table size="small" sx={tableSx}>
        <TableHead>
          <TableRow>
            <TableCell>{first}</TableCell><TableCell align="right">Lệnh</TableCell><TableCell align="right">Thắng</TableCell>
            <TableCell align="right">PF</TableCell><TableCell align="right">USD</TableCell><TableCell align="right">R TB</TableCell>
            <TableCell align="right">Max DD</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(([k, m]) => (
            <TableRow key={k}>
              <TableCell sx={{ fontWeight: 800 }}>{k}</TableCell>
              <TableCell align="right" sx={mono}>{m.trades}</TableCell>
              <TableCell align="right" sx={mono}>{pct(m.winRate)}</TableCell>
              <TableCell align="right" sx={{ ...mono, color: pfTone(m.profitFactor), fontWeight: 800 }}>{pf(m.profitFactor)}</TableCell>
              <TableCell align="right" sx={{ ...mono, color: m.netUsd >= 0 ? "success.main" : "error.main" }}>{usd(m.netUsd)}</TableCell>
              <TableCell align="right" sx={mono}>{r3(m.avgR)}</TableCell>
              <TableCell align="right" sx={mono}>{m.maxDrawdownUsd.toFixed(0)} / {m.maxDrawdownR.toFixed(1)}R</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function Compare({ test, base }: { test: BacktestMetrics; base: BacktestMetrics }) {
  const rows: [string, string, string, string, boolean | null][] = [
    ["Số lệnh", String(test.trades), String(base.trades), `${test.trades - base.trades >= 0 ? "+" : ""}${test.trades - base.trades}`, null],
    ["Hệ số PF", pf(test.profitFactor), pf(base.profitFactor),
      test.profitFactor !== null && base.profitFactor !== null ? `${test.profitFactor - base.profitFactor >= 0 ? "+" : ""}${(test.profitFactor - base.profitFactor).toFixed(2)}` : "—",
      test.profitFactor === null || (base.profitFactor !== null && test.profitFactor >= base.profitFactor)],
    ["Lãi/lỗ ròng USD", usd(test.netUsd), usd(base.netUsd), usd(test.netUsd - base.netUsd), test.netUsd >= base.netUsd],
    ["Kỳ vọng USD/lệnh", usd(test.expectancyUsd), usd(base.expectancyUsd), usd(test.expectancyUsd - base.expectancyUsd), test.expectancyUsd >= base.expectancyUsd],
    ["R trung bình", r3(test.avgR), r3(base.avgR), r3(test.avgR - base.avgR), test.avgR >= base.avgR],
    ["Tỷ lệ thắng", pct(test.winRate), pct(base.winRate), `${((test.winRate - base.winRate) * 100).toFixed(1)} điểm`, null],
    ["Max DD USD", test.maxDrawdownUsd.toFixed(0), base.maxDrawdownUsd.toFixed(0), usd(test.maxDrawdownUsd - base.maxDrawdownUsd), test.maxDrawdownUsd <= base.maxDrawdownUsd],
    ["Max DD R", test.maxDrawdownR.toFixed(1), base.maxDrawdownR.toFixed(1), (test.maxDrawdownR - base.maxDrawdownR).toFixed(1), test.maxDrawdownR <= base.maxDrawdownR],
  ];
  return (
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table size="small" sx={tableSx}>
        <TableHead>
          <TableRow><TableCell>Chỉ số</TableCell><TableCell align="right">Đang thử</TableCell><TableCell align="right">Đang chạy</TableCell><TableCell align="right">Chênh</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {rows.map(([k, a, b, d, better]) => (
            <TableRow key={k}>
              <TableCell sx={{ fontWeight: 800 }}>{k}</TableCell>
              <TableCell align="right" sx={{ ...mono, fontWeight: 800 }}>{a}</TableCell>
              <TableCell align="right" sx={{ ...mono, color: "text.secondary" }}>{b}</TableCell>
              <TableCell align="right" sx={{ ...mono, color: better === null ? "text.secondary" : better ? "success.main" : "error.main" }}>{d}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: string }) {
  return (
    <Box sx={{ p: 1.25, borderRadius: 2, border: "1px solid rgba(148,163,184,.14)", height: "100%" }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ ...mono, fontWeight: 900, color: tone ?? "text.primary", lineHeight: 1.3 }}>{value}</Typography>
      {detail ? <Typography variant="caption" color="text.secondary" sx={mono}>{detail}</Typography> : null}
    </Box>
  );
}

function Results({ result }: { result: OfflineBacktestResult }) {
  const [showMonths, setShowMonths] = useState(false);
  const [tradeCount, setTradeCount] = useState(30);
  const s = result.summary;
  const sides = Object.entries(result.bySide);
  const exits = Object.entries(result.exitReasons).sort((a, b) => b[1] - a[1]);
  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" useFlexGap gap={1}>
            <Typography variant="subtitle1" fontWeight={900}>Kết quả {result.isBaseline ? "· cấu hình đang chạy" : "· cấu hình đang thử"}</Typography>
            <Typography variant="caption" color="text.secondary" sx={mono}>
              {result.data.window?.from ?? result.data.from} → {result.data.window?.to ?? result.data.to} · {result.elapsedMs} ms
            </Typography>
          </Stack>
          <Grid container spacing={1} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, md: 2 }}><Stat label="Số lệnh" value={String(s.trades)} detail={`thắng ${pct(s.winRate)}`} /></Grid>
            <Grid size={{ xs: 6, md: 2 }}><Stat label="Hệ số PF" value={pf(s.profitFactor)} tone={pfTone(s.profitFactor)} detail="ngưỡng > 1,20" /></Grid>
            <Grid size={{ xs: 6, md: 2 }}><Stat label="Lãi/lỗ ròng" value={usd(s.netUsd)} tone={s.netUsd >= 0 ? "success.main" : "error.main"} detail={`lot ${result.request.lot}`} /></Grid>
            <Grid size={{ xs: 6, md: 2 }}><Stat label="Kỳ vọng / lệnh" value={usd(s.expectancyUsd)} detail={`R TB ${r3(s.avgR)}`} tone={s.expectancyUsd > 0 ? "success.main" : "error.main"} /></Grid>
            <Grid size={{ xs: 6, md: 2 }}><Stat label="Max drawdown" value={`${s.maxDrawdownUsd.toFixed(0)} USD`} detail={`${s.maxDrawdownR.toFixed(1)} R`} /></Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <Stat label="Hai nửa (theo lệnh)" value={result.halves ? `${pf(result.halves.first.profitFactor)} | ${pf(result.halves.second.profitFactor)}` : "—"} detail={result.halves ? `PF trước | sau ${result.halves.splitAt}` : undefined} />
            </Grid>
          </Grid>
          <Stack spacing={0.75} sx={{ mt: 1.5 }}>
            {result.verdict.map((v) => (
              <Alert key={v} severity={v.includes("> 1,20") ? "info" : "warning"} sx={{ py: 0 }}>{v}</Alert>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {result.baseline ? (
        <Card><CardContent>
          <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1 }}>So với cấu hình đang chạy (cùng dữ liệu, cùng chi phí)</Typography>
          <Compare test={s} base={result.baseline.summary} />
        </CardContent></Card>
      ) : null}

      <Card><CardContent>
        <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1 }}>Đường vốn</Typography>
        <EquityChart test={result.equity} baseline={result.baselineEquity} />
      </CardContent></Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: "100%" }}><CardContent>
            <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1 }}>BUY / SELL</Typography>
            <MetricsTable rows={sides} first="Hướng" />
            {result.baseline ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                Đang chạy: {Object.entries(result.baseline.bySide).map(([k, m]) => `${k} PF ${pf(m.profitFactor)} (${usd(m.netUsd)})`).join(" · ")}
              </Typography>
            ) : null}
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: "100%" }}><CardContent>
            <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1 }}>TREND / SIDEWAY</Typography>
            <MetricsTable rows={Object.entries(result.byStrategySide)} first="Chiến lược" />
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: "100%" }}><CardContent>
            <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1 }}>Theo regime</Typography>
            <MetricsTable rows={Object.entries(result.byRegime)} first="Regime" />
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: "100%" }}><CardContent>
            <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1 }}>Cách đóng lệnh</Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75}>
              {exits.map(([k, n]) => <Chip key={k} label={`${EXIT_LABEL[k] ?? k}: ${n}`} size="small" variant="outlined" />)}
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Button size="small" onClick={() => setShowMonths((v) => !v)}>{showMonths ? "Ẩn" : "Xem"} theo tháng</Button>
            <Collapse in={showMonths}><MetricsTable rows={Object.entries(result.byMonth)} first="Tháng" /></Collapse>
          </CardContent></Card>
        </Grid>
      </Grid>

      <Card><CardContent>
        <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1 }}>Lệnh mô phỏng gần nhất ({Math.min(tradeCount, result.trades.length)} / {result.tradesTotal})</Typography>
        <Stack divider={<Divider flexItem />} spacing={0.75}>
          {result.trades.slice(0, tradeCount).map((t) => (
            <Stack key={`${t.entryTime}-${t.side}`} direction="row" justifyContent="space-between" alignItems="center" gap={1}>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Chip size="small" label={t.side} color={t.side === "BUY" ? "success" : "error"} variant="outlined" />
                  <Typography variant="caption" fontWeight={800}>{t.strategy}</Typography>
                  <Typography variant="caption" color="text.secondary">{t.regime ?? ""}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ ...mono, display: "block" }}>
                  {dt(t.entryTime)} · {t.entry} · SL {t.initialStop} · {EXIT_LABEL[t.exitReason] ?? t.exitReason}{t.partialApplied ? " · đã chốt 1 phần" : ""}
                </Typography>
              </Box>
              <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                <Typography variant="body2" sx={{ ...mono, fontWeight: 900, color: t.pnlUsd >= 0 ? "success.main" : "error.main" }}>{usd(t.pnlUsd)}</Typography>
                <Typography variant="caption" color="text.secondary" sx={mono}>{r3(t.r)} R</Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
        {tradeCount < result.trades.length ? <Button size="small" sx={{ mt: 1 }} onClick={() => setTradeCount((n) => n + 50)}>Xem thêm</Button> : null}
      </CardContent></Card>

      <Card><CardContent>
        <Typography variant="subtitle2" fontWeight={900}>Giả định và giới hạn</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {result.costs.execution}. {result.costs.spread}. Phí {result.costs.commissionPerLotRoundTurn} USD/lot khứ hồi, trượt giá {result.costs.slippagePrice}.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>Không mô phỏng: {result.notModelled.join("; ")}.</Typography>
      </CardContent></Card>
    </Stack>
  );
}

export function Phase7COfflineBacktestPage() {
  const status = useQuery({ queryKey: ["phase7c-offline-backtest-status"], queryFn: getPhase7COfflineBacktestStatus, staleTime: 60_000 });
  const [edited, setReq] = useState<OfflineBacktestRequest | null>(null);
  const run = useMutation({ mutationFn: runPhase7COfflineBacktest });
  const defaults = status.data?.defaults;
  const req = edited ?? defaults ?? null;
  const diff = useMemo(() => (req && defaults ? differences(req, defaults) : []), [req, defaults]);

  if (status.isLoading) return <LoadingState />;
  if (status.error || !status.data) return <ErrorState message={status.error instanceof Error ? status.error.message : "Không đọc được trạng thái backtest."} />;
  if (!req || !defaults) return <LoadingState />;

  const st = status.data;
  const L = (k: string, fallback: [number, number]) => st.limits[k] ?? fallback;
  const set = (patch: Partial<OfflineBacktestRequest>) => setReq({ ...req, ...patch });
  const ready = Boolean(st.dataset?.cacheReady);
  const toggleStrategy = (s: BacktestStrategy) => {
    const has = req.strategies.includes(s);
    const next = has ? req.strategies.filter((x) => x !== s) : [...req.strategies, s];
    if (next.length) set({ strategies: (["TREND", "SIDEWAY"] as const).filter((x) => next.includes(x)) });
  };

  return (
    <Stack spacing={2} sx={{ pb: { xs: 10, md: 2 } }}>
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap gap={1}>
            <Typography variant="subtitle1" fontWeight={900}>Backtest kiểm chứng quản lý lệnh</Typography>
            <Stack direction="row" spacing={0.75}>
              <Chip size="small" color="success" variant="outlined" label="Offline" />
              <Chip size="small" variant="outlined" label="Không gửi lệnh" />
            </Stack>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Chạy lại luật TREND + SIDEWAY Phase 7C trên dữ liệu MT5 lịch sử với các tuỳ chọn bên dưới. Trang này không đổi cấu hình bot đang chạy, BOT_MODE hay LIVE ARM.
          </Typography>
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            <Typography variant="body2" fontWeight={800}>{st.research.overfitWarning}</Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.25 }}>
              {st.research.knownOutOfSample.map((s) => <li key={s}><Typography variant="caption">{s}</Typography></li>)}
              <li><Typography variant="caption">{st.research.acceptance}</Typography></li>
            </Box>
          </Alert>
          {st.dataset ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, ...mono }}>
              Dữ liệu: {st.files.m5} + {st.files.m15} · {st.dataset.from} → {st.dataset.to} · {st.dataset.m15Bars.toLocaleString("en-US")} nến M15
            </Typography>
          ) : null}
          {!ready ? (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              <Typography variant="body2" fontWeight={800}>{st.problem?.error ?? "Chưa có cache regime khớp với file CSV."}</Typography>
              <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
                Đặt file CSV M5 và M15 xuất từ MT5 vào <b>{st.files.dataDir}</b>, rồi chạy một lần trong thư mục repo (tốn vài phút CPU, nên chạy khi bot PAUSE hoặc trên máy khác):
              </Typography>
              <Box component="code" sx={{ display: "block", mt: 0.5, p: 1, borderRadius: 1, bgcolor: "rgba(0,0,0,.25)", fontSize: 12, wordBreak: "break-all" }}>{st.prepareCommand}</Box>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap gap={1}>
            <Typography variant="subtitle2" fontWeight={900}>Điều kiện kiểm chứng</Typography>
            <Button size="small" startIcon={<RestartAltRounded />} onClick={() => setReq(structuredClone(defaults))}>Về cấu hình đang chạy</Button>
          </Stack>
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75} sx={{ mb: 1.5 }}>
            {diff.length ? diff.map((d) => <Chip key={d} size="small" color="warning" label={d} />) : <Chip size="small" label="Giống cấu hình đang chạy" />}
          </Stack>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <Section title="Chiến lược và khoảng ngày">
                <Stack spacing={1.25}>
                  <ToggleButtonGroup size="small" fullWidth value={req.strategies}>
                    {(["TREND", "SIDEWAY"] as const).map((s) => <ToggleButton key={s} value={s} selected={req.strategies.includes(s)} onClick={() => toggleStrategy(s)}>{s}</ToggleButton>)}
                  </ToggleButtonGroup>
                  <Stack direction="row" spacing={1}>
                    <TextField size="small" type="date" label="Từ ngày" value={req.from ?? ""} onChange={(e) => set({ from: e.target.value || null })} InputLabelProps={{ shrink: true }} fullWidth />
                    <TextField size="small" type="date" label="Đến ngày" value={req.to ?? ""} onChange={(e) => set({ to: e.target.value || null })} InputLabelProps={{ shrink: true }} fullWidth />
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <NumField label="Lot cố định" value={req.lot} onChange={(v) => set({ lot: Math.round(v * 100) / 100 })} min={L("lot", [0.01, 1])[0]} max={L("lot", [0.01, 1])[1]} step={0.01} helper="USD đổi theo lot, R thì không" />
                    <NumField label="SL ban đầu tối đa" value={req.maxInitialStopPrice} onChange={(v) => set({ maxInitialStopPrice: v })} min={L("maxInitialStopPrice", [6, 20])[0]} max={L("maxInitialStopPrice", [6, 20])[1]} helper="giá; tối thiểu 6" />
                  </Stack>
                </Stack>
              </Section>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <Section title="Dời SL về hoà vốn (BE)">
                <Toggle label="Bật hoà vốn" checked={req.breakEven.enabled} onChange={(v) => set({ breakEven: { ...req.breakEven, enabled: v } })} hint="Khi giá đi được +X, SL về entry + offset" />
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <NumField label="Khi đạt + (giá)" value={req.breakEven.triggerPrice} disabled={!req.breakEven.enabled} onChange={(v) => set({ breakEven: { ...req.breakEven, triggerPrice: v } })} min={L("breakEvenTriggerPrice", [4, 15])[0]} max={L("breakEvenTriggerPrice", [4, 15])[1]} />
                  <NumField label="SL = entry +" value={req.breakEven.offsetPrice} disabled={!req.breakEven.enabled} onChange={(v) => set({ breakEven: { ...req.breakEven, offsetPrice: v } })} min={L("breakEvenOffsetPrice", [0, 3])[0]} max={L("breakEvenOffsetPrice", [0, 3])[1]} helper="nhỏ hơn ngưỡng" />
                </Stack>
              </Section>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <Section title="Chốt lời">
                <Toggle label="TP cố định" checked={req.fixedTp.enabled} onChange={(v) => set({ fixedTp: { ...req.fixedTp, enabled: v } })} hint="Đóng toàn bộ ở entry ± TP (SIDEWAY lấy mức gần hơn biên range)" />
                <Box sx={{ mt: 1 }}>
                  <NumField label="TP (giá)" value={req.fixedTp.price} disabled={!req.fixedTp.enabled} onChange={(v) => set({ fixedTp: { ...req.fixedTp, price: v } })} min={L("fixedTpPrice", [5, 100])[0]} max={L("fixedTpPrice", [5, 100])[1]} step={1} />
                </Box>
                <Divider sx={{ my: 1.25 }} />
                <Toggle label="Chốt một phần (TREND)" checked={req.partial.enabled} onChange={(v) => set({ partial: { ...req.partial, enabled: v } })} hint="Tắt: không đóng phần nào, nhưng mốc này vẫn bắt đầu dời SL M5" />
                <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mt: 1 }}>
                  <NumField label="Khi đạt + (giá)" value={req.partial.triggerPrice} onChange={(v) => set({ partial: { ...req.partial, triggerPrice: v } })} min={L("partialTriggerPrice", [4, 30])[0]} max={L("partialTriggerPrice", [4, 30])[1]} />
                  <ToggleButtonGroup size="small" exclusive disabled={!req.partial.enabled} value={req.partial.fraction} onChange={(_, v: PartialFraction | null) => v && set({ partial: { ...req.partial, fraction: v } })} sx={{ flexShrink: 0 }}>
                    {(["1/4", "1/3", "1/2"] as const).map((f) => <ToggleButton key={f} value={f}>{f}</ToggleButton>)}
                  </ToggleButtonGroup>
                </Stack>
              </Section>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <Section title="Cách dời stop loss">
                <Toggle label="FastMove" checked={req.fastMove.enabled} onChange={(v) => set({ fastMove: { ...req.fastMove, enabled: v } })} hint="Sau BE: giá đi +A thì SL theo đỉnh − B" />
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <NumField label="Kích hoạt A" value={req.fastMove.activationPrice} disabled={!req.fastMove.enabled} onChange={(v) => set({ fastMove: { ...req.fastMove, activationPrice: v } })} min={L("fastMoveActivationPrice", [4, 30])[0]} max={L("fastMoveActivationPrice", [4, 30])[1]} />
                  <NumField label="Lùi B" value={req.fastMove.givebackPrice} disabled={!req.fastMove.enabled} onChange={(v) => set({ fastMove: { ...req.fastMove, givebackPrice: v } })} min={L("fastMoveGivebackPrice", [2, 30])[0]} max={L("fastMoveGivebackPrice", [2, 30])[1]} />
                </Stack>
                <Divider sx={{ my: 1.25 }} />
                <Toggle label="Dời SL theo cấu trúc M5" checked={req.m5Trail.enabled} onChange={(v) => set({ m5Trail: { enabled: v } })} hint="Đáy/đỉnh M5 ± 1, chỉ siết. TREND sau mốc chốt, SIDEWAY từ lúc vào" />
                <Toggle label="Thoát phần còn lại theo FVG ngược / MA50" checked={req.runnerExits.enabled} onChange={(v) => set({ runnerExits: { enabled: v } })} hint="TREND, xét ở mỗi nến M15 đóng" />
              </Section>
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <Section title="Chi phí (giả định thận trọng)">
                <Stack direction="row" spacing={1}>
                  <NumField label="Phí USD/lot" value={req.costs.commissionPerLot} onChange={(v) => set({ costs: { ...req.costs, commissionPerLot: v } })} min={L("commissionPerLot", [0, 100])[0]} max={L("commissionPerLot", [0, 100])[1]} step={1} />
                  <NumField label="Trượt giá" value={req.costs.slippagePrice} onChange={(v) => set({ costs: { ...req.costs, slippagePrice: v } })} min={L("slippagePrice", [0, 5])[0]} max={L("slippagePrice", [0, 5])[1]} step={0.05} />
                  <NumField label="Spread tối thiểu" value={req.costs.minSpreadPoints} onChange={(v) => set({ costs: { ...req.costs, minSpreadPoints: v } })} min={L("minSpreadPoints", [0, 500])[0]} max={L("minSpreadPoints", [0, 500])[1]} step={5} helper="point" />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>STOP_FIRST trong cùng nến, spread từng nến MT5, vào lệnh ở nến M5 kế tiếp.</Typography>
              </Section>
            </Grid>
          </Grid>
          <Box sx={{
            position: { xs: "fixed", md: "static" }, left: 0, right: 0, bottom: 0, zIndex: 10, mt: { md: 2 },
            p: { xs: 1.25, md: 0 }, bgcolor: { xs: "rgba(6,11,20,.95)", md: "transparent" }, borderTop: { xs: "1px solid rgba(148,163,184,.15)", md: "none" },
          }}>
            <Button variant="contained" size="large" fullWidth startIcon={<PlayArrowRounded />} disabled={!ready || run.isPending} onClick={() => run.mutate(req)}>
              {run.isPending ? "Đang chạy…" : "Chạy backtest"}
            </Button>
          </Box>
          {run.error ? <Alert severity="error" sx={{ mt: 1.5 }}>{run.error instanceof Error ? run.error.message : String(run.error)}</Alert> : null}
        </CardContent>
      </Card>

      {run.data ? <Results result={run.data} /> : null}
    </Stack>
  );
}
