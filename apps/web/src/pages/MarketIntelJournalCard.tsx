import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { getMarketIntelJournal, syncMarketIntelJournal } from "../api";
import type { JournalGroup, MarketIntelJournalSummary } from "../market-intel-types";

const LABEL: Record<string, string> = {
  UPTREND: "Uptrend", DOWNTREND: "Downtrend", SIDEWAY: "Sideway", TRANSITION: "Chuyển tiếp", UNKNOWN: "Không rõ",
  WITH_TREND: "Cùng xu hướng", AGAINST_TREND: "Ngược xu hướng",
};
const fmt = (v: number | null, suffix = "") => (v === null ? "–" : `${v}${suffix}`);

function GroupTable({ title, rows }: { title: string; rows: JournalGroup[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <Typography variant="subtitle2" fontWeight={800} sx={{ mt: 2 }}>{title}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            {["Nhóm", "Lệnh", "Winrate", "PF", "R:R thực tế", "Kỳ vọng/lệnh", "Lãi/lỗ ròng", "Thua liên tiếp", ""].map((h) => <TableCell key={h}>{h}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((g) => (
            <TableRow key={g.key}>
              <TableCell>{g.key.split("|").map((k) => LABEL[k] ?? k).join(" · ")}</TableCell>
              <TableCell>{g.trades}</TableCell>
              <TableCell>{fmt(g.winRatePct, "%")}</TableCell>
              <TableCell>{g.profitFactorInfinite ? "∞" : fmt(g.profitFactor)}</TableCell>
              <TableCell>{fmt(g.payoffRatio)}</TableCell>
              <TableCell>{fmt(g.expectancy)}</TableCell>
              <TableCell>{g.netPnl}</TableCell>
              <TableCell>{g.maxConsecutiveLosses}</TableCell>
              <TableCell>{g.enoughSample ? null : <Chip size="small" variant="outlined" label="chưa đủ mẫu" />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function Body({ data }: { data: MarketIntelJournalSummary }) {
  const b = data.breakdown;
  if (!b || data.totalTrades === 0) return <Typography variant="body2" sx={{ mt: 1 }}>Nhật ký chưa có lệnh. Bấm "Đồng bộ" để chép các lệnh đã đóng của bot vào nhật ký.</Typography>;
  return (
    <>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {data.totalTrades} lệnh · winrate {fmt(b.overall.winRatePct, "%")} · PF {b.overall.profitFactorInfinite ? "∞" : fmt(b.overall.profitFactor)} · R:R thực tế {fmt(b.overall.payoffRatio)} · ròng {b.overall.netPnl}
      </Typography>
      <GroupTable title="Theo loại thị trường (thư viện mẫu, tại lúc vào lệnh)" rows={b.byLibraryState} />
      <GroupTable title="Cùng hay ngược xu hướng" rows={b.byAlignment} />
      <GroupTable title="Theo regime của bot" rows={b.byProductionRegime} />
      <GroupTable title="Theo chiến lược × loại thị trường" rows={b.byStrategyAndLibraryState} />
      <GroupTable title="Theo chiều lệnh" rows={b.bySide} />
    </>
  );
}

export function MarketIntelJournalCard() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["market-intel-journal"], queryFn: getMarketIntelJournal, retry: false });
  const sync = useMutation({ mutationFn: syncMarketIntelJournal, onSuccess: () => client.invalidateQueries({ queryKey: ["market-intel-journal"] }) });
  const data = query.data;
  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap">
          <Typography variant="subtitle1" fontWeight={900}>Nhật ký lệnh và hiệu quả theo loại thị trường</Typography>
          {data?.enabled && <Button size="small" variant="outlined" disabled={sync.isPending} onClick={() => sync.mutate()}>{sync.isPending ? "Đang đồng bộ…" : "Đồng bộ"}</Button>}
        </Stack>
        {query.error && <Alert severity="error" sx={{ mt: 1 }}>{query.error instanceof Error ? query.error.message : "Không tải được nhật ký."}</Alert>}
        {sync.error && <Alert severity="error" sx={{ mt: 1 }}>{sync.error instanceof Error ? sync.error.message : "Đồng bộ thất bại."}</Alert>}
        {data && !data.enabled && <Alert severity="warning" sx={{ mt: 1 }}>Nhật ký đang tắt. Đặt ZIQ_MARKET_INTEL_JOURNAL_ENABLED=true cho API rồi khởi động lại API.</Alert>}
        {data?.enabled && <Body data={data} />}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {data?.sampleNote} Đồng bộ chỉ chép lệnh đã đóng vào file nhật ký trên máy bot; không gửi, sửa hay đóng lệnh.
        </Typography>
      </CardContent>
    </Card>
  );
}
