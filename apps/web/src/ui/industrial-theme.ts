// Industrial "control room" look for the operator web: graphite panels on a faint grid,
// one gold accent, and signal colours reserved for state (ok / warn / bad / info).
// Every page reads colours from here (theme palette or `tokens`) instead of hard-coding hex.
import { alpha, createTheme } from "@mui/material";

export const tokens = {
  bg: "#0a0d12",
  bgRaised: "#0c1016",
  panel: "#11161e",
  panel2: "#161c26",
  line: "#232b37",
  line2: "#2e3846",
  text: "#e6ebf2",
  muted: "#8592a3",
  gold: "#e9b949",
  ok: "#3ccf7a",
  warn: "#f5a623",
  bad: "#f2645a",
  info: "#4aa3ff",
  mono: '"Cascadia Mono", "JetBrains Mono", "Consolas", "DejaVu Sans Mono", monospace',
  sans: '"Segoe UI Variable", "Segoe UI", Inter, "Noto Sans", Arial, sans-serif',
  radius: 6,
} as const;

export type SignalTone = "ok" | "warn" | "bad" | "info" | "muted" | "gold";

export function toneColor(tone: SignalTone): string {
  return tone === "muted" ? tokens.muted : tokens[tone];
}

/** Small uppercase panel caption used across the shell. */
export const captionSx = {
  fontSize: 10.5,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: tokens.muted,
  fontWeight: 700,
} as const;

/** Monospace tabular numbers so prices and P&L do not jitter when they update. */
export const numberSx = {
  fontFamily: tokens.mono,
  fontVariantNumeric: "tabular-nums",
} as const;

export const industrialTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: tokens.gold },
    success: { main: tokens.ok },
    error: { main: tokens.bad },
    warning: { main: tokens.warn },
    info: { main: tokens.info },
    background: { default: tokens.bg, paper: tokens.panel },
    divider: tokens.line2,
    text: { primary: tokens.text, secondary: tokens.muted },
  },
  shape: { borderRadius: tokens.radius },
  typography: {
    fontFamily: tokens.sans,
    overline: { letterSpacing: ".14em", fontWeight: 700 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontFamily: tokens.sans,
          fontSynthesis: "none",
          textRendering: "optimizeLegibility",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          position: "relative",
          backgroundImage: "none",
          backgroundColor: tokens.panel,
          border: `1px solid ${tokens.line2}`,
          boxShadow: "0 10px 30px rgba(0,0,0,.28)",
          overflow: "visible",
          // Gold corner bracket: the "instrument panel" mark of the industrial look.
          "&::before": {
            content: '""',
            position: "absolute",
            left: -1,
            top: -1,
            width: 10,
            height: 10,
            borderLeft: `2px solid ${tokens.gold}`,
            borderTop: `2px solid ${tokens.gold}`,
            borderTopLeftRadius: tokens.radius,
            pointerEvents: "none",
          },
        },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 700, borderRadius: 4 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 4, fontWeight: 700, letterSpacing: ".02em" },
      },
    },
    MuiTab: {
      styleOverrides: { root: { textTransform: "none", fontWeight: 700 } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: tokens.panel2, border: `1px solid ${tokens.line2}`, fontSize: 12 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 6, borderRadius: 2, backgroundColor: alpha(tokens.line2, 0.8) },
        bar: { borderRadius: 2 },
      },
    },
  },
});
