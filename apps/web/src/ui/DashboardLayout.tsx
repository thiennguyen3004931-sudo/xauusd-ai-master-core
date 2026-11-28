import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import SmartToyRounded from "@mui/icons-material/SmartToyRounded";
import BuildRounded from "@mui/icons-material/BuildRounded";
import PowerSettingsNewRounded from "@mui/icons-material/PowerSettingsNewRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import InsightsRounded from "@mui/icons-material/InsightsRounded";
import MenuRounded from "@mui/icons-material/MenuRounded";
import LockRounded from "@mui/icons-material/LockRounded";
import { useMt5Telemetry } from "../hooks";
import { StatusChip } from "./StatusChip";
import { Phase7CStatusStrip } from "./Phase7CStatusStrip";
import { tokens } from "./industrial-theme";

const drawerWidth = 220;

type LinkRow = readonly [string, string, typeof SmartToyRounded];
type RuntimeLabel = "DEMO" | "LIVE" | "MT5 CHECK";

// Lean menu: legacy pages (detailed dashboard, signals, phone) stay routable from "Kỹ thuật".
const links: readonly LinkRow[] = [
  ["/phase7c-control-center", "Vận hành", TuneRounded],
  ["/phase7b-ops", "Tài khoản & LIVE", PowerSettingsNewRounded],
  ["/performance", "Hiệu quả", InsightsRounded],
  ["/technical", "Kỹ thuật", BuildRounded],
] as const;

function runtimeLabel(accountMode: string | undefined): RuntimeLabel {
  if (accountMode === "real") return "LIVE";
  if (accountMode === "demo") return "DEMO";
  return "MT5 CHECK";
}

function Navigation({ runtime, onNavigate }: { runtime: RuntimeLabel; onNavigate?: () => void }) {
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", p: 1.6 }}>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 0.8, py: 1.3 }}>
        <Box className="brand-mark">AU</Box>
        <Box>
          <Typography variant="caption" color="primary" sx={{ letterSpacing: ".18em" }}>XAUUSD</Typography>
          <Typography variant="subtitle2" fontWeight={900}>AI MASTER</Typography>
        </Box>
      </Stack>

      <Typography variant="caption" color="text.disabled" sx={{ px: 1.2, mt: 1.2, letterSpacing: ".12em", fontWeight: 800 }}>
        Vận hành {runtime}
      </Typography>
      <List dense sx={{ pt: 0.7 }}>
        {links.map(([href, label, Icon]) => (
          <ListItemButton
            key={href}
            component={NavLink}
            to={href}
            onClick={onNavigate}
            sx={{
              my: 0.35,
              px: 1.25,
              borderRadius: 1,
              color: "text.secondary",
              borderLeft: "3px solid transparent",
              "&.active": {
                color: tokens.gold,
                backgroundColor: "rgba(233,185,73,.08)",
                borderLeftColor: tokens.gold,
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 34, color: "inherit" }}><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ fontSize: 13, fontWeight: 700 }} />
          </ListItemButton>
        ))}
      </List>

      <Box className="hazard" sx={{ mt: "auto", mb: 1.2, p: 1.4, borderRadius: 1 }}>
        <Typography variant="caption" fontWeight={900} sx={{ color: tokens.warn, display: "block" }}>⚠ CHƯA CÓ LỢI THẾ</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.4, lineHeight: 1.45 }}>
          Backtest chưa đạt ngưỡng PF &gt; 1,20 ngoài mẫu. Chưa có bằng chứng sinh lời.
        </Typography>
      </Box>
      <Box sx={{ p: 1.6, borderRadius: 1, border: `1px solid ${tokens.line2}`, bgcolor: tokens.panel }}>
        <Stack direction="row" spacing={0.8} alignItems="center">
          <LockRounded fontSize="small" color="primary" />
          <Typography variant="caption" fontWeight={900}>MT5 PANEL · CHỈ ĐỌC</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.9, lineHeight: 1.5 }}>
          Runtime hiện tại: {runtime}. Web không có quyền đặt lệnh. Chuyển DEMO/LIVE chỉ qua Guarded Account Switch với PAUSE + FLAT + xác nhận 2 bước; LIVE ARM vẫn là thao tác riêng.
        </Typography>
      </Box>
    </Box>
  );
}

/** Phone: thumb-reachable tab bar with the same four destinations as the sidebar. */
function PhoneTabBar({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const current = links.find(([href]) => pathname.startsWith(href))?.[0] ?? false;
  return (
    <BottomNavigation
      value={current}
      onChange={(_event, href: string) => navigate(href)}
      showLabels
      sx={{
        display: { xs: "flex", lg: "none" },
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        height: 62,
        pb: "env(safe-area-inset-bottom)",
        bgcolor: tokens.bgRaised,
        borderTop: `1px solid ${tokens.line2}`,
        "& .MuiBottomNavigationAction-root": { minWidth: 0, color: tokens.muted },
        "& .Mui-selected": { color: tokens.gold },
      }}
    >
      {links.map(([href, label, Icon]) => (
        <BottomNavigationAction key={href} value={href} label={label} icon={<Icon fontSize="small" />} />
      ))}
    </BottomNavigation>
  );
}

export function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const telemetry = useMt5Telemetry();
  const runtime = runtimeLabel(telemetry.data?.health?.accountMode);

  let headerTitle = `Bảng điều khiển vận hành ${runtime}`;
  let headerSubtitle = "XAUUSD · AUTO/PAUSE · trạng thái thị trường · tài khoản · rủi ro · hệ thống";
  if (location.pathname.startsWith("/phase7b-pattern-check")) {
    headerTitle = "Tín hiệu & quyết định";
    headerSubtitle = `Điều kiện tín hiệu · lý do vận hành · điều kiện vào lệnh · ${runtime}`;
  } else if (location.pathname.startsWith("/phase7b-ops")) {
    headerTitle = "Tài khoản & rủi ro";
    headerSubtitle = `Tài khoản MT5 · khối lượng/rủi ro · an toàn · vận hành ${runtime}`;
  } else if (location.pathname.startsWith("/phase7c-control-center")) {
    headerTitle = "Vận hành";
    headerSubtitle = `MT5 · bot · Telegram · quyết định giao dịch · khối lượng/rủi ro · ${runtime}`;
  } else if (location.pathname.startsWith("/phase7c-mobile")) {
    headerTitle = "Điện thoại · chỉ đọc";
    headerSubtitle = `MOBILE_REMOTE_ACCESS_M1 · trạng thái canonical · ${runtime}`;
  } else if (location.pathname.startsWith("/performance")) {
    headerTitle = "Hiệu quả";
    headerSubtitle = `Kết quả giao dịch XAUUSD và phân tích bot của tài khoản ${runtime} hiện tại`;
  } else if (location.pathname.startsWith("/technical")) {
    headerTitle = "Kỹ thuật";
    headerSubtitle = `Trang chẩn đoán và trang cũ · chỉ xem · ${runtime}`;
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          display: { xs: "none", lg: "block" },
          "& .MuiDrawer-paper": {
            width: drawerWidth,
            bgcolor: tokens.bgRaised,
            borderRightColor: tokens.line2,
          },
        }}
      >
        <Navigation runtime={runtime} />
      </Drawer>
      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{
          display: { xs: "block", lg: "none" },
          "& .MuiDrawer-paper": { width: drawerWidth, bgcolor: tokens.bgRaised },
        }}
      >
        <Navigation runtime={runtime} onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: "rgba(10,13,18,.9)",
            backdropFilter: "blur(14px)",
            borderBottom: `1px solid ${tokens.line2}`,
          }}
        >
          <Toolbar sx={{ minHeight: { xs: 58, md: 62 } }}>
            <IconButton onClick={() => setMobileOpen(true)} sx={{ display: { lg: "none" }, mr: 1 }}><MenuRounded /></IconButton>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" fontWeight={900}>{headerTitle}</Typography>
              <Typography variant="caption" color="text.secondary">{headerSubtitle}</Typography>
            </Box>
            <StatusChip value={runtime} />
          </Toolbar>
          {/* Desktop: the strip stays pinned with the header. Phone: it scrolls with the page (below). */}
          <Box sx={{ display: { xs: "none", md: "block" } }}><Phase7CStatusStrip /></Box>
        </AppBar>
        <Box sx={{ display: { xs: "block", md: "none" }, pt: 1.2 }}><Phase7CStatusStrip /></Box>
        <Box component="main" sx={{ p: { xs: 1.5, md: 2.2 }, pb: { xs: 10, lg: 2.2 }, maxWidth: 1780, mx: "auto", width: "100%" }}>
          <Outlet />
        </Box>
        <PhoneTabBar pathname={location.pathname} />
      </Box>
    </Box>
  );
}
