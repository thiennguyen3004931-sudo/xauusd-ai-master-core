import { Link as RouterLink } from "react-router-dom";
import { Card, CardContent, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";

// "Kỹ thuật": legacy and diagnostic pages, hidden from the main menu but kept and reachable here.
const technicalLinks: readonly (readonly [string, string, string])[] = [
  ["/phase7b-dashboard", "Bảng điều khiển chi tiết", "Lý do chọn strategy, lý do chưa vào lệnh, dời SL, chốt 1/3, đóng lệnh"],
  ["/phase7b-pattern-check", "Tín hiệu", "Điều kiện tín hiệu và điều kiện vào lệnh"],
  ["/phase7c-mobile", "Điện thoại", "Trang chỉ đọc cho điện thoại"],
] as const;

export function Phase7CTechnicalPage() {
  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={900}>Kỹ thuật</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Các trang chẩn đoán và trang cũ. Chỉ để xem, không đổi cấu hình hay trạng thái bot.
          </Typography>
          <List dense sx={{ mt: 1 }}>
            {technicalLinks.map(([href, label, hint]) => (
              <ListItemButton key={href} component={RouterLink} to={href} sx={{ borderRadius: 2 }}>
                <ListItemText
                  primary={label}
                  secondary={hint}
                  primaryTypographyProps={{ fontWeight: 800 }}
                />
              </ListItemButton>
            ))}
          </List>
        </CardContent>
      </Card>
    </Stack>
  );
}
