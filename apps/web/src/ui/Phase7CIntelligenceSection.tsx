import { useState } from "react";
import { Button, Stack } from "@mui/material";
import { Phase7CCounterfactualIntelligenceCard } from "./Phase7CCounterfactualIntelligenceCard";
import { Phase7CIntelligenceSummaryCard } from "./Phase7CIntelligenceSummaryCard";
import { Phase7CPerformanceEffectivenessCard } from "./Phase7CPerformanceEffectivenessCard";
import { Phase7CPerformanceIntelligenceCard } from "./Phase7CPerformanceIntelligenceCard";
import { Phase7CRecommendationIntelligenceCard } from "./Phase7CRecommendationIntelligenceCard";

// Read-only bot analysis, moved off the main operating screen onto "Hiệu quả".
export function Phase7CIntelligenceSection() {
  const [showIntelligenceDetails, setShowIntelligenceDetails] = useState(false);

  return (
    <Stack spacing={2}>
      <Phase7CIntelligenceSummaryCard />
      <Button
        size="small"
        variant="text"
        onClick={() => setShowIntelligenceDetails((value) => !value)}
        sx={{ alignSelf: "flex-start", fontWeight: 900 }}
      >
        {showIntelligenceDetails ? "Ẩn Intelligence chi tiết" : "Mở Intelligence chi tiết"}
      </Button>
      {showIntelligenceDetails ? (
        <Stack spacing={2}>
          <Phase7CPerformanceIntelligenceCard />
          <Phase7CPerformanceEffectivenessCard />
          <Phase7CCounterfactualIntelligenceCard />
          <Phase7CRecommendationIntelligenceCard />
        </Stack>
      ) : null}
    </Stack>
  );
}
