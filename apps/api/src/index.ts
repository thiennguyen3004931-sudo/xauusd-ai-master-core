import "dotenv/config";
import app from "./app";
import {
  startAutoExecutionSoak,
  stopAutoExecutionSoak,
} from "./services/auto-execution-soak.service";
import { warmPhase7CCanonicalDealLedgerOnStartup } from "./services/phase7c-canonical-deal-ledger.service";
import { writePhase7CApiRuntimeSourceAttestation } from "./services/phase7c-runtime-source-attestation.service";
import { startMarketIntelProposalScheduler } from "./services/market-intel-proposals.service";
import { startMarketIntelScenarioAlerts } from "./services/market-intel-telegram";
import { getMarketIntelSnapshot } from "./services/market-intel.service";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`XAUUSD API running at http://${HOST}:${PORT}`);
  console.log("Trading mode defaults to SHADOW. Live execution is not exposed by this API.");
  try {
    const attestation = writePhase7CApiRuntimeSourceAttestation();
    console.log(
      `PHASE7C_RUNTIME_SOURCE_API_ATTESTATION=PASS|PID=${attestation.pid}|DEPLOYMENT_ID=${attestation.deploymentId}`,
    );
  } catch (error) {
    console.warn(
      `PHASE7C_RUNTIME_SOURCE_API_ATTESTATION=UNKNOWN|REASON=${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
});
startAutoExecutionSoak();
// Market intel (advisory, default OFF): proposal cadence and notify-only scenario alerts.
startMarketIntelProposalScheduler();
startMarketIntelScenarioAlerts(() => getMarketIntelSnapshot("XAUUSD"));

void warmPhase7CCanonicalDealLedgerOnStartup()
  .then((result) => {
    const details = result.status === "BACKFILLED"
      ? ` inserted=${result.inserted} total=${result.total} fromMs=${result.fromMs} toMs=${result.toMs}`
      : "";
    console.log(
      `PHASE7C_CANONICAL_LEDGER_STARTUP_BACKFILL=${result.status} reason=${result.reason}${details}`,
    );
  })
  .catch((error) => {
    console.warn(
      `PHASE7C_CANONICAL_LEDGER_STARTUP_BACKFILL=FAIL reason=${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopAutoExecutionSoak();
  });
}
