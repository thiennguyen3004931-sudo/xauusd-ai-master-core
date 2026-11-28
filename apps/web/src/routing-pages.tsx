import { lazy, Suspense, type ReactNode } from "react";
import { LoadingState } from "./ui/PageState";

export const Phase7BPatternCheckPage = lazy(() =>
  import("./pages/Phase7BPatternCheckPage").then((module) => ({ default: module.Phase7BPatternCheckPage })),
);
export const Phase7CAccountRiskPage = lazy(() =>
  import("./pages/Phase7CAccountRiskPage").then((module) => ({ default: module.Phase7CAccountRiskPage })),
);
export const Phase7CControlCenterShellPage = lazy(() =>
  import("./pages/Phase7CControlCenterShellPage").then((module) => ({ default: module.Phase7CControlCenterShellPage })),
);
export const Phase7CMobileReadOnlyPage = lazy(() =>
  import("./pages/Phase7CMobileReadOnlyPage").then((module) => ({ default: module.Phase7CMobileReadOnlyPage })),
);
export const Phase7CTechnicalPage = lazy(() =>
  import("./pages/Phase7CTechnicalPage").then((module) => ({ default: module.Phase7CTechnicalPage })),
);
export const PerformancePage = lazy(() =>
  import("./pages/PerformancePage").then((module) => ({ default: module.PerformancePage })),
);

export const MarketIntelPage = lazy(() =>
  import("./pages/MarketIntelPage").then((module) => ({ default: module.MarketIntelPage })),
);

export const Phase7COfflineBacktestPage = lazy(() =>
  import("./pages/Phase7COfflineBacktestPage").then((module) => ({ default: module.Phase7COfflineBacktestPage })),
);

export function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState />}>{children}</Suspense>;
}
