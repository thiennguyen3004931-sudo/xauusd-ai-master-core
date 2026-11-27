import { useState } from "react";
import { Stack } from "@mui/material";
import { Phase7CControlCenterCompactSection } from "../ui/Phase7CControlCenterCompactSection";
import { Phase7CExecutionAuthorizationCard } from "../ui/Phase7CExecutionAuthorizationCard";
import { Phase7COperatorStatusBar } from "../ui/Phase7COperatorStatusBar";
import { Phase7CRuntimeSourceAttestationCard } from "../ui/Phase7CRuntimeSourceAttestationCard";
import { Phase7CControlCenterPage } from "./Phase7CControlCenterPage";

// Lean operating screen: status bar, then execution + bot control + current decision/position,
// then the collapsed runtime-source check (kept here so a source mismatch stays visible before
// BAT BOT). Bot analysis lives on "Hiệu quả" (/performance).
export function Phase7CControlCenterShellPage() {
  const [showOperationalDetails, setShowOperationalDetails] = useState(false);

  return (
    <Stack spacing={2}>
      <Phase7COperatorStatusBar />

      <Phase7CExecutionAuthorizationCard />

      <Phase7CControlCenterCompactSection
        detailsOpen={showOperationalDetails}
        onToggleDetails={() => setShowOperationalDetails((value) => !value)}
      />
      {showOperationalDetails ? <Phase7CControlCenterPage /> : null}

      <Phase7CRuntimeSourceAttestationCard />
    </Stack>
  );
}
