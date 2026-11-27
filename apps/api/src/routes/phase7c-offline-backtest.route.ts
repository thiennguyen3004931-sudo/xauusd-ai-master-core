import { Router, type Request, type Response } from "express";
import {
  OfflineBacktestError,
  getOfflineBacktestStatus,
  offlineBacktestHttpStatus,
  runOfflineBacktest,
} from "../services/phase7c-offline-backtest.service";

// Backtest page: replay of MT5 CSV history only. This router cannot send, modify or close orders and cannot
// change BOT_MODE, LIVE ARM, lot settings or any runtime file of the bot.
const router = Router();

const fail = (res: Response, error: unknown) => {
  if (error instanceof OfflineBacktestError) {
    res.status(offlineBacktestHttpStatus(error.code)).json({ code: error.code, error: error.message });
  } else {
    res.status(500).json({ code: "FAILED", error: error instanceof Error ? error.message : "Backtest failed." });
  }
};

router.get("/status", async (_req: Request, res: Response) => {
  try {
    res.setHeader("cache-control", "no-store");
    res.json(await getOfflineBacktestStatus());
  } catch (error) {
    fail(res, error);
  }
});

router.post("/run", async (req: Request, res: Response) => {
  try {
    res.setHeader("cache-control", "no-store");
    res.json(await runOfflineBacktest(req.body ?? {}));
  } catch (error) {
    fail(res, error);
  }
});

export default router;
