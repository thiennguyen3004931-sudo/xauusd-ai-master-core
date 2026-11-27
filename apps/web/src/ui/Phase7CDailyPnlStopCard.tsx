import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  getPhase7CDailyPnlStop,
  setPhase7CDailyPnlStop,
  type Phase7CDailyPnlStopStatus,
  type Phase7CDailyPnlStopUnit,
} from "../api";

type Draft = {
  enabled: boolean;
  unit: Phase7CDailyPnlStopUnit;
  dailyLossLimit: string;
  dailyProfitTarget: string;
};

function usd(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value));
}

function toLimit(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function statusChip(status: Phase7CDailyPnlStopStatus | null | undefined) {
  if (!status || status.reason === "DISABLED") return { label: "ĐANG TẮT", color: "default" as const };
  switch (status.reason) {
    case "DAILY_LOSS_LIMIT_HIT":
      return { label: "CHẠM LỖ NGÀY · BOT NGHỈ", color: "error" as const };
    case "DAILY_PROFIT_TARGET_HIT":
      return { label: "ĐẠT LÃI NGÀY · BOT NGHỈ", color: "success" as const };
    case "CONFIG_INVALID":
      return { label: "CẤU HÌNH LỖI · CHẶN LỆNH MỚI", color: "error" as const };
    case "DATA_UNAVAILABLE":
      return { label: "THIẾU DỮ LIỆU · CHẶN LỆNH MỚI", color: "warning" as const };
    default:
      return { label: "ĐANG THEO DÕI", color: "primary" as const };
  }
}

// Daily loss limit / daily profit target. Operator-set, default OFF. Once hit, the bot
// opens no new XAUUSD position until the next broker day; open positions keep normal
// management and are never closed by this rule. BOT_MODE is not changed.
export function Phase7CDailyPnlStopCard() {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: ["phase7c-daily-pnl-stop"],
    queryFn: getPhase7CDailyPnlStop,
    refetchInterval: 10_000,
    retry: false,
  });
  const [draft, setDraft] = useState<Draft | null>(null);

  const state = snapshot.data?.state ?? null;
  const status = snapshot.data?.status ?? null;
  const current: Draft = {
    enabled: state?.enabled ?? false,
    unit: state?.unit ?? "USD",
    dailyLossLimit: state?.dailyLossLimit == null ? "" : String(state.dailyLossLimit),
    dailyProfitTarget: state?.dailyProfitTarget == null ? "" : String(state.dailyProfitTarget),
  };
  const form = draft ?? current;
  const update = (patch: Partial<Draft>) => setDraft({ ...form, ...patch });

  const save = useMutation({
    mutationFn: () =>
      setPhase7CDailyPnlStop({
        expectedVersion: state?.version ?? 0,
        enabled: form.enabled,
        unit: form.unit,
        dailyLossLimit: toLimit(form.dailyLossLimit),
        dailyProfitTarget: toLimit(form.dailyProfitTarget),
      }),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["phase7c-daily-pnl-stop"] });
    },
  });

  const unitLabel = form.unit === "PERCENT" ? "%" : "USD";
  const chip = statusChip(status);
  const missingLimit = form.enabled && toLimit(form.dailyLossLimit) === null && toLimit(form.dailyProfitTarget) === null;

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent sx={{ p: { xs: 1.7, md: 2 } }}>
        <Stack spacing={1.3}>
          <Stack direction="row" justifyContent="space-between" gap={1} alignItems="center">
            <Box>
              <Typography variant="h6" fontWeight={950}>Giới hạn lỗ / lãi trong ngày</Typography>
              <Typography variant="caption" color="text.secondary">
                Chạm một trong hai mức thì bot không mở lệnh mới đến hết ngày giao dịch (giờ server MT5). Lệnh đang mở vẫn được quản lý bình thường, không bị đóng.
              </Typography>
            </Box>
            <Chip label={chip.label} size="small" color={chip.color} />
          </Stack>

          <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
            <Chip size="small" variant="outlined" label={`P/L HÔM NAY ${usd(status?.dayPnl)}`} />
            <Chip size="small" variant="outlined" label={`ĐÃ CHỐT ${usd(status?.realizedPnl)}`} />
            <Chip size="small" variant="outlined" label={`ĐANG MỞ ${usd(status?.floatingPnl)}`} />
            {status?.lossLimitUsd != null ? <Chip size="small" variant="outlined" label={`NGƯỠNG LỖ −${usd(status.lossLimitUsd)}`} /> : null}
            {status?.profitTargetUsd != null ? <Chip size="small" variant="outlined" label={`NGƯỠNG LÃI +${usd(status.profitTargetUsd)}`} /> : null}
          </Stack>

          <Grid container spacing={1.2} alignItems="center">
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <FormControlLabel
                control={<Switch checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })} />}
                label="Bật giới hạn ngày"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                select
                fullWidth
                size="small"
                label="Đơn vị"
                value={form.unit}
                onChange={(event) => update({ unit: event.target.value as Phase7CDailyPnlStopUnit })}
              >
                <MenuItem value="USD">USD</MenuItem>
                <MenuItem value="PERCENT">% số dư đầu ngày</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label={`Lỗ tối đa trong ngày (${unitLabel})`}
                placeholder="Để trống = không dùng"
                value={form.dailyLossLimit}
                onChange={(event) => update({ dailyLossLimit: event.target.value })}
                slotProps={{ htmlInput: { min: 0, step: form.unit === "PERCENT" ? 0.1 : 1 } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label={`Lãi mục tiêu trong ngày (${unitLabel})`}
                placeholder="Để trống = không dùng"
                value={form.dailyProfitTarget}
                onChange={(event) => update({ dailyProfitTarget: event.target.value })}
                slotProps={{ htmlInput: { min: 0, step: form.unit === "PERCENT" ? 0.1 : 1 } }}
              />
            </Grid>
          </Grid>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            <Button
              variant="contained"
              disabled={save.isPending || !snapshot.data || missingLimit}
              onClick={() => save.mutate()}
              sx={{ fontWeight: 950 }}
            >
              {save.isPending ? "ĐANG LƯU..." : "Lưu giới hạn ngày"}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Áp dụng ngay cho lệnh mới, không cần khởi động lại. Sang ngày mới bot tự chạy lại.
            </Typography>
          </Stack>

          {missingLimit ? <Alert severity="info" sx={{ py: 0.4 }}>Nhập ít nhất một mức lỗ hoặc lãi để bật.</Alert> : null}
          {save.error ? <Alert severity="error" sx={{ py: 0.4 }}>{save.error instanceof Error ? save.error.message : String(save.error)}</Alert> : null}
          {snapshot.data && !snapshot.data.valid ? (
            <Alert severity="error" sx={{ py: 0.4 }}>File cấu hình lỗi, bot đang chặn lệnh mới: {snapshot.data.error}. Lưu lại cấu hình để sửa.</Alert>
          ) : null}
          {status?.reason === "DATA_UNAVAILABLE" ? (
            <Alert severity="warning" sx={{ py: 0.4 }}>Chưa đọc được P/L ngày từ MT5 nên bot tạm chặn lệnh mới: {status.error}</Alert>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
