import { Router, type Request, type Response } from "express";
import { getMarketIntelSnapshot } from "../services/market-intel.service";

// GET only. Market intelligence is advisory: this router has no write route.
const router = Router();

router.get("/snapshot", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.query.symbol ?? "XAUUSD").trim().toUpperCase().replace(/[^A-Z0-9._]/g, "") || "XAUUSD";
    res.setHeader("cache-control", "no-store");
    res.json(await getMarketIntelSnapshot(symbol, { refresh: req.query.refresh === "1" }));
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Market intel snapshot failed." });
  }
});

export default router;
