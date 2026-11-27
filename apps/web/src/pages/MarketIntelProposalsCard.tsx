import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import {
  decideMarketIntelProposal, getMarketIntelProposals, markMarketIntelConfigDeployed, marketIntelConfigExportUrl,
  rollbackMarketIntelConfig, runMarketIntelAnalysis,
} from "../api";
import type { JournalStats, MarketIntelProposal, MarketIntelProposalsOverview } from "../market-intel-types";

const KEY = ["market-intel-proposals"];
const date = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("vi-VN") : "–");
const day = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : "–");
const pf = (s: JournalStats) => (s.profitFactorInfinite ? "∞" : s.profitFactor ?? "–");
const STATUS: Record<MarketIntelProposal["status"], string> = {
  PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Đã từ chối", OUTDATED: "Không còn áp dụng", SUPERSEDED: "Đã có đề xuất mới hơn",
};

function StatsRow({ label, before, after }: { label: string; before: JournalStats; after: JournalStats }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell>{before.trades} → {after.trades}</TableCell>
      <TableCell>{before.winRatePct ?? "–"}% → {after.winRatePct ?? "–"}%</TableCell>
      <TableCell>{pf(before)} → {pf(after)}</TableCell>
      <TableCell>{before.payoffRatio ?? "–"} → {after.payoffRatio ?? "–"}</TableCell>
      <TableCell>{before.netPnl} → {after.netPnl}</TableCell>
    </TableRow>
  );
}

function ProposalCard({ p, overview, onDone }: { p: MarketIntelProposal; overview: MarketIntelProposalsOverview; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [editValue, setEditValue] = useState("");
  const param = overview.parameters.find((x) => x.id === p.parameterId);
  const decide = useMutation({
    mutationFn: (input: { decision: "APPROVE" | "REJECT" | "EDIT"; editedValue?: string }) => decideMarketIntelProposal(p.id, input.decision, note, input.editedValue),
    onSuccess: onDone,
  });
  const ev = p.evaluation;
  const editable = p.allowedValues.filter((v) => v !== p.oldValue && v !== p.newValue);
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle2" fontWeight={900}>{p.label}</Typography>
          <Chip size="small" color={p.evidenceLabel === "ENOUGH_EVIDENCE" ? "success" : "warning"} label={p.evidenceLabel === "ENOUGH_EVIDENCE" ? "Đủ bằng chứng" : "Chưa đủ bằng chứng"} />
          <Chip size="small" variant="outlined" label={STATUS[p.status]} />
        </Stack>
        <Typography variant="body2" sx={{ mt: 1 }}><b>Cũ:</b> {p.oldLabel} &nbsp;→&nbsp; <b>Mới:</b> {p.newLabel}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{p.reason}</Typography>
        <Table size="small" sx={{ mt: 1 }}>
          <TableHead>
            <TableRow>{["Backtest trước → sau", "Lệnh", "Winrate", "PF", "R:R thực tế", "Ròng (USD)"].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow>
          </TableHead>
          <TableBody>
            <StatsRow label={`Giai đoạn dùng để chọn (đến ${day(ev.splitAt)})`} before={ev.inSample.before} after={ev.inSample.after} />
            <StatsRow label={`Giai đoạn chưa dùng (từ ${day(ev.splitAt)})`} before={ev.outOfSample.before} after={ev.outOfSample.after} />
            <StatsRow label="Toàn bộ" before={ev.full.before} after={ev.full.after} />
            {p.liveCheck && p.liveCheck.before.trades > 0 && <StatsRow label="Lệnh thật trong nhật ký (đối chiếu)" before={p.liveCheck.before} after={p.liveCheck.after} />}
          </TableBody>
        </Table>
        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
          Walk-forward (Δ lãi ròng từng đoạn): {ev.walkForward.map((f) => `${day(f.from)}: ${f.netDelta >= 0 ? "+" : ""}${f.netDelta}`).join(" · ")}
        </Typography>
        {ev.evidence.checks.map((c) => (
          <Typography key={c.id} variant="caption" display="block" color={c.passed ? "success.main" : "warning.main"}>{c.passed ? "✓" : "✗"} {c.text}</Typography>
        ))}
        {p.caveats.map((c) => <Typography key={c} variant="caption" display="block" color="text.secondary">• {c}</Typography>)}
        {p.decision && (
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            {p.decision.decision} bởi {p.decision.actor} lúc {date(p.decision.at)}{p.decision.editedValue ? ` · giá trị sửa: ${param?.valueLabels[p.decision.editedValue] ?? p.decision.editedValue}` : ""}{p.decision.configVersion ? ` · tạo cấu hình v${p.decision.configVersion}` : ""}{p.decision.note ? ` · "${p.decision.note}"` : ""}
          </Typography>
        )}
        {p.status === "PENDING" && (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            <TextField size="small" label="Ghi chú (lưu vào audit log)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
              <Button size="small" variant="contained" color="success" disabled={decide.isPending} onClick={() => decide.mutate({ decision: "APPROVE" })}>Duyệt</Button>
              <Button size="small" variant="outlined" color="error" disabled={decide.isPending} onClick={() => decide.mutate({ decision: "REJECT" })}>Từ chối</Button>
              {editable.length > 0 && (
                <>
                  <TextField select size="small" label="Sửa thành" value={editValue} onChange={(e) => setEditValue(e.target.value)} sx={{ minWidth: 260 }}>
                    {editable.map((v) => <MenuItem key={v} value={v}>{param?.valueLabels[v] ?? v}</MenuItem>)}
                  </TextField>
                  <Button size="small" variant="outlined" disabled={!editValue || decide.isPending} onClick={() => decide.mutate({ decision: "EDIT", editedValue: editValue })}>Duyệt giá trị đã sửa</Button>
                </>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Duyệt chỉ tạo phiên bản cấu hình mới ở trạng thái "Chờ triển khai". Bot không đổi cho tới khi anh triển khai qua đường Phase 7C có bảo vệ (PAUSE, không còn lệnh mở) và chỉ áp dụng cho lệnh mới.
            </Typography>
            {decide.error && <Alert severity="error">{decide.error instanceof Error ? decide.error.message : "Thao tác thất bại."}</Alert>}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigSection({ o, onDone }: { o: MarketIntelProposalsOverview; onDone: () => void }) {
  const [note, setNote] = useState("");
  const rollback = useMutation({ mutationFn: (v: number) => rollbackMarketIntelConfig(v, note), onSuccess: onDone });
  const deployed = useMutation({ mutationFn: (v: number) => markMarketIntelConfigDeployed(v, note), onSuccess: onDone });
  const label = (id: string, v: string) => {
    const param = o.parameters.find((p) => p.id === id);
    return `${param?.label ?? id}: ${param?.valueLabels[v] ?? v}`;
  };
  return (
    <>
      <Typography variant="subtitle2" fontWeight={800} sx={{ mt: 2 }}>Lịch sử phiên bản cấu hình</Typography>
      {o.pendingDeploy && o.latestConfig && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Phiên bản v{o.latestConfig.version} đã duyệt, đang <b>chờ triển khai</b>. Bot vẫn chạy v{o.deployedConfig?.version ?? "?"}.
          Bot hiện chưa đọc các bộ lọc này; cần một PR riêng nối vào bot, rồi anh triển khai lúc PAUSE và không còn lệnh XAUUSD mở.
        </Alert>
      )}
      <TextField size="small" label="Ghi chú cho rollback / đánh dấu triển khai" value={note} onChange={(e) => setNote(e.target.value)} sx={{ mt: 1, minWidth: 360 }} />
      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>{["Phiên bản", "Tham số", "Nguồn", "Lúc", "Trạng thái", ""].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>
          {o.configVersions.map((v) => (
            <TableRow key={v.version}>
              <TableCell>v{v.version}</TableCell>
              <TableCell>{Object.entries(v.params).map(([k, val]) => <Box key={k}>{label(k, val)}</Box>)}</TableCell>
              <TableCell>{v.source}</TableCell>
              <TableCell>{date(v.createdAt)}</TableCell>
              <TableCell>{v.deployed ? <Chip size="small" color="success" label="Đang chạy" /> : v.version === o.latestConfig?.version ? <Chip size="small" color="warning" label="Chờ triển khai" /> : "–"}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={1}>
                  <Button size="small" href={marketIntelConfigExportUrl(v.version)} target="_blank" rel="noreferrer">Gói cấu hình</Button>
                  {!v.deployed && v.version === o.latestConfig?.version && (
                    <Button size="small" disabled={deployed.isPending} onClick={() => { if (window.confirm(`Chỉ đánh dấu khi anh ĐÃ triển khai v${v.version} qua đường Phase 7C có bảo vệ. Tiếp tục?`)) deployed.mutate(v.version); }}>Đánh dấu đã triển khai</Button>
                  )}
                  {v.version !== o.latestConfig?.version && (
                    <Button size="small" color="warning" disabled={rollback.isPending} onClick={() => { if (window.confirm(`Tạo phiên bản mới với tham số của v${v.version}? (vẫn cần triển khai)`)) rollback.mutate(v.version); }}>Rollback về đây</Button>
                  )}
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(rollback.error || deployed.error) && <Alert severity="error" sx={{ mt: 1 }}>{String((rollback.error ?? deployed.error) instanceof Error ? (rollback.error ?? deployed.error)!.message : "Thao tác thất bại.")}</Alert>}
    </>
  );
}

export function MarketIntelProposalsCard() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: getMarketIntelProposals, retry: false });
  const refresh = () => { void client.invalidateQueries({ queryKey: KEY }); };
  const run = useMutation({ mutationFn: runMarketIntelAnalysis, onSuccess: refresh });
  const o = query.data;
  const active = o?.proposals.filter((p) => p.status === "PENDING") ?? [];
  const history = o?.proposals.filter((p) => p.status !== "PENDING") ?? [];
  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap">
          <Typography variant="subtitle1" fontWeight={900}>Đề xuất cải thiện tín hiệu (cần anh duyệt)</Typography>
          {o?.enabled && <Button size="small" variant="outlined" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Đang phân tích…" : "Chạy phân tích ngay"}</Button>}
        </Stack>
        {query.error && <Alert severity="error" sx={{ mt: 1 }}>{query.error instanceof Error ? query.error.message : "Không tải được đề xuất."}</Alert>}
        {run.data && run.data.ok === false && run.data.error && <Alert severity="warning" sx={{ mt: 1 }}>{run.data.error}</Alert>}
        {o && !o.enabled && <Alert severity="warning" sx={{ mt: 1 }}>Chức năng đề xuất đang tắt. Đặt ZIQ_MARKET_INTEL_PROPOSALS_ENABLED=true cho API rồi khởi động lại API.</Alert>}
        {o?.enabled && (
          <>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Tự chạy mỗi tuần hoặc sau mỗi 30 lệnh đóng. Lần gần nhất: {o.lastRun ? `${date(o.lastRun.at)} (${o.lastRun.reason})` : "chưa chạy"} · {o.closedTradesSinceLastRun} lệnh đóng từ đó.
              Dữ liệu backtest: {o.dataset ? `${o.dataset.trades} lệnh, tạo ${date(o.dataset.generatedAt)}` : "chưa có"}.
              Nhãn "Đủ bằng chứng" cần: ≥ {o.evidenceRule.minOutOfSampleTrades} lệnh ở giai đoạn chưa dùng, PF &gt; {o.evidenceRule.minOutOfSampleProfitFactor}, ≥ {o.evidenceRule.minPositiveFolds}/{o.evidenceRule.walkForwardFolds} đoạn walk-forward tốt hơn.
            </Typography>
            <Stack spacing={2} sx={{ mt: 2 }}>
              {active.length === 0 && <Typography variant="body2">Không có đề xuất đang chờ duyệt.</Typography>}
              {active.map((p) => <ProposalCard key={p.id} p={p} overview={o} onDone={refresh} />)}
            </Stack>
            <ConfigSection o={o} onDone={refresh} />
            {history.length > 0 && (
              <>
                <Typography variant="subtitle2" fontWeight={800} sx={{ mt: 2 }}>Đề xuất đã xử lý</Typography>
                <Stack spacing={1} sx={{ mt: 1 }}>{history.map((p) => <ProposalCard key={p.id} p={p} overview={o} onDone={refresh} />)}</Stack>
              </>
            )}
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" fontWeight={800}>Audit log</Typography>
            {o.audit.slice(0, 20).map((a) => (
              <Typography key={a.seq} variant="caption" display="block" color="text.secondary">{date(a.at)} · {a.actor} · {a.action} · {JSON.stringify(a.detail)}</Typography>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
