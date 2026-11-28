// Fixed status strip under the header: is the bot safe right now? Display only, except one
// emergency PAUSE button (confirmed). PAUSE uses the existing bot-mode API; it only blocks new
// entries and never closes, modifies or sends orders. Remote/phone access stays read-only
// because the API itself refuses mode changes there.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { getPhase7CDailyPnlStop, getPhase7CLifecycle, setPhase7CBotMode } from "../api";
import { useMt5Telemetry } from "../hooks";
import { captionSx, numberSx, toneColor, tokens, type SignalTone } from "./industrial-theme";

function Cell({ label, children, grow = 0 }: { label: string; children: React.ReactNode; grow?: number }) {
  return (
    <Box
      sx={{
        flex: `${grow} 0 auto`,
        minWidth: { xs: "calc(50% - 4px)", sm: 116 },
        px: 1.4,
        py: 0.8,
        border: `1px solid ${tokens.line2}`,
        borderRadius: `${tokens.radius}px`,
        bgcolor: tokens.panel,
      }}
    >
      <Typography sx={captionSx}>{label}</Typography>
      <Box sx={{ mt: 0.3, display: "flex", alignItems: "center", gap: 0.8, minHeight: 22 }}>{children}</Box>
    </Box>
  );
}

function Led({ tone, live = false }: { tone: SignalTone; live?: boolean }) {
  return <span className={`led${live ? " led--live" : ""}`} style={{ color: toneColor(tone) }} aria-hidden />;
}

function Value({ tone = "muted", children, className }: { tone?: SignalTone; children: React.ReactNode; className?: string }) {
  return (
    <Typography component="span" className={className} sx={{ ...numberSx, fontWeight: 700, fontSize: 15, color: tone === "muted" ? tokens.text : toneColor(tone) }}>
      {children}
    </Typography>
  );
}

/** Flash the price green / red for a moment when it ticks (CSS animation, off under reduced motion). */
function usePriceTick(price: number | null): { cls: string; n: number } {
  const previous = useRef<number | null>(null);
  const [tick, setTick] = useState({ cls: "", n: 0 });
  useEffect(() => {
    const last = previous.current;
    if (price !== null && last !== null && price !== last) {
      const cls = price > last ? "tick-up" : "tick-down";
      setTick((t) => ({ cls, n: t.n + 1 }));
    }
    previous.current = price;
  }, [price]);
  return tick;
}

export function Phase7CStatusStrip() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const telemetry = useMt5Telemetry();
  const lifecycle = useQuery({ queryKey: ["phase7c-lifecycle"], queryFn: getPhase7CLifecycle, refetchInterval: 2_000, retry: false });
  const dailyStop = useQuery({ queryKey: ["phase7c-daily-pnl-stop"], queryFn: getPhase7CDailyPnlStop, refetchInterval: 5_000, retry: false });
  const pause = useMutation({
    mutationFn: () => setPhase7CBotMode("PAUSE"),
    onSuccess: async () => {
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["phase7c-lifecycle"] });
    },
  });

  const t = telemetry.data;
  const bridgeOk = t?.reachable === true;
  const mid = t?.quote ? (t.quote.bid + t.quote.ask) / 2 : null;
  const tick = usePriceTick(mid);
  const spread = t?.quote?.spread ?? null;
  const maxSpread = t?.spec?.maxSpread ?? null;
  const spreadRatio = spread !== null && maxSpread ? Math.min(1, spread / maxSpread) : null;
  const spreadTone: SignalTone = spreadRatio === null ? "muted" : spreadRatio >= 1 ? "bad" : spreadRatio >= 0.8 ? "warn" : "ok";

  const mode = lifecycle.data?.mode.mode ?? null;
  const modeTone: SignalTone = mode === null ? "muted" : mode === "PAUSE" ? "warn" : "ok";
  const openPositions = lifecycle.data?.bridge.openXauusdPositions ?? t?.positions.length ?? null;

  const status = dailyStop.data?.status ?? null;
  const dayPnl = status?.dayPnl ?? null;
  const lossLimit = status?.lossLimitUsd ?? null;
  const lossRatio = dayPnl !== null && lossLimit ? Math.min(1, Math.max(0, -dayPnl / lossLimit)) : null;
  const dayTone: SignalTone = status?.blocked ? "bad" : lossRatio !== null && lossRatio >= 0.7 ? "warn" : dayPnl !== null && dayPnl < 0 ? "warn" : dayPnl !== null ? "ok" : "muted";

  const canPause = lifecycle.data?.controlEnabled === true && mode !== null && mode !== "PAUSE";

  return (
    <Box sx={{ px: { xs: 1.5, md: 2.2 }, pb: 1.1, pt: 0.2 }}>
      <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} alignItems="stretch">
        <Cell label="Chế độ bot">
          <Led tone={modeTone} live={mode !== null && mode !== "PAUSE"} />
          <Value tone={modeTone}>{mode ?? "—"}</Value>
        </Cell>
        <Cell label="MT5 bridge">
          <Led tone={bridgeOk ? "ok" : "bad"} live={bridgeOk} />
          <Value tone={bridgeOk ? "ok" : "bad"}>{bridgeOk ? `${t?.latencyMs ?? "—"} ms` : "MẤT KẾT NỐI"}</Value>
        </Cell>
        <Cell label="XAUUSD">
          <Value key={tick.n} tone="gold" className={tick.cls}>{mid !== null ? mid.toFixed(2) : "—"}</Value>
        </Cell>
        <Cell label={maxSpread ? `Spread · ngưỡng ${maxSpread.toFixed(2)}` : "Spread"} grow={1}>
          <Value tone={spreadTone}>{spread !== null ? spread.toFixed(2) : "—"}</Value>
          {spreadRatio !== null ? (
            <LinearProgress variant="determinate" value={spreadRatio * 100} sx={{ flex: 1, "& .MuiLinearProgress-bar": { bgcolor: toneColor(spreadTone) } }} />
          ) : null}
        </Cell>
        <Cell label={lossLimit ? `Lãi/lỗ ngày · giới hạn −${lossLimit.toFixed(0)}` : "Lãi/lỗ ngày"} grow={1}>
          <Value tone={dayTone}>{dayPnl !== null ? `${dayPnl >= 0 ? "+" : "−"}${Math.abs(dayPnl).toFixed(2)}` : status?.enabled === false ? "TẮT" : "—"}</Value>
          {lossRatio !== null ? (
            <LinearProgress variant="determinate" value={lossRatio * 100} sx={{ flex: 1, "& .MuiLinearProgress-bar": { bgcolor: toneColor(dayTone) } }} />
          ) : null}
          {status?.blocked ? <Typography sx={{ ...captionSx, color: tokens.bad }}>ĐÃ CHẶN</Typography> : null}
        </Cell>
        <Cell label="Lệnh mở">
          <Value tone={openPositions ? "warn" : "muted"}>{openPositions ?? "—"}</Value>
        </Cell>
        <Box sx={{ display: "flex", alignItems: "stretch", flex: { xs: "1 0 100%", sm: "0 0 auto" } }}>
          <Button
            variant="contained"
            color="error"
            disabled={!canPause || pause.isPending}
            onClick={() => setConfirmOpen(true)}
            sx={{ fontWeight: 900, letterSpacing: ".06em", px: 2.2, width: "100%" }}
          >
            ■ DỪNG KHẨN (PAUSE)
          </Button>
        </Box>
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle sx={{ fontWeight: 900 }}>Chuyển bot sang PAUSE?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Chỉ chặn lệnh mới. Lệnh đang mở vẫn do bot quản lý SL như cũ, không bị đóng hay sửa.
            Muốn chạy lại thì bật AUTO ở trang Vận hành.
          </Typography>
          {pause.isError ? (
            <Typography variant="body2" sx={{ mt: 1.2, color: tokens.bad }}>
              {pause.error instanceof Error ? pause.error.message : "Không chuyển được sang PAUSE."}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Huỷ</Button>
          <Button variant="contained" color="error" disabled={pause.isPending} onClick={() => pause.mutate()}>
            Xác nhận PAUSE
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
