import { Router, type Request, type Response } from "express";
import { getMarketIntelJournalSummary, syncMarketIntelJournal } from "../services/market-intel-journal.service";

// Feature 1 (C1) journal. GET reads the local journal. POST /sync copies realized trades into the local
// SQLite journal only: it never touches orders, positions, BOT_MODE or the runtime.
const router = Router();

function isLoopbackRequest(req: Request): boolean {
  return [req.ip, req.socket.remoteAddress]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase())
    .some((v) => v === "127.0.0.1" || v === "::1" || v === "::ffff:127.0.0.1");
}

/** Same rule as other operator actions: loopback, or the configured operator token. */
function canSyncJournal(req: Request): boolean {
  if (isLoopbackRequest(req)) return true;
  const token = process.env.PHASE7C_BOT_MODE_TOKEN?.trim();
  return Boolean(token) && String(req.header("x-phase7c-token") ?? "").trim() === token;
}

function readDays(value: unknown, fallback: number | null): number | null {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 7 || n > 365) throw new Error("days must be an integer between 7 and 365.");
  return n;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    res.setHeader("cache-control", "no-store");
    res.json(await getMarketIntelJournalSummary({ sinceDays: readDays(req.query.days, null) }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Market intel journal failed." });
  }
});

router.post("/sync", async (req: Request, res: Response) => {
  if (!canSyncJournal(req)) {
    res.status(403).json({ error: "Journal sync is allowed from loopback or with the operator token only." });
    return;
  }
  try {
    res.setHeader("cache-control", "no-store");
    res.json(await syncMarketIntelJournal({ days: readDays(req.body?.days, 90) ?? 90 }));
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Market intel journal sync failed." });
  }
});

export default router;
