import { Router, type Request, type Response } from "express";
import {
  decideMarketIntelProposal,
  exportMarketIntelConfig,
  getProposalsOverview,
  markMarketIntelConfigDeployed,
  rollbackMarketIntelConfig,
  runProposalAnalysis,
} from "../services/market-intel-proposals.service";

// Feature 1 (C2). Write routes only touch the local market-intel journal (proposals, decisions,
// config versions, deploy marks). None of them deploys to the bot, sends orders or changes BOT_MODE.
const router = Router();

function isLoopbackRequest(req: Request): boolean {
  return [req.ip, req.socket.remoteAddress]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase())
    .some((v) => v === "127.0.0.1" || v === "::1" || v === "::ffff:127.0.0.1");
}

/** Same rule as other operator actions: loopback, or the configured operator token. */
function canOperate(req: Request): boolean {
  if (isLoopbackRequest(req)) return true;
  const token = process.env.PHASE7C_BOT_MODE_TOKEN?.trim();
  return Boolean(token) && String(req.header("x-phase7c-token") ?? "").trim() === token;
}

const deny = (res: Response) => res.status(403).json({ error: "Chỉ thao tác được từ máy bot (loopback) hoặc với token vận hành." });
const fail = (res: Response, error: unknown, status = 400) => res.status(status).json({ error: error instanceof Error ? error.message : "Thao tác thất bại." });
const text = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : null);
const int = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error("version phải là số nguyên dương.");
  return n;
};

router.get("/", async (_req: Request, res: Response) => {
  try {
    res.setHeader("cache-control", "no-store");
    res.json(await getProposalsOverview());
  } catch (error) { fail(res, error, 503); }
});

router.get("/config/:version/export", async (req: Request, res: Response) => {
  try {
    res.setHeader("cache-control", "no-store");
    res.json(await exportMarketIntelConfig({ version: int(req.params.version) }));
  } catch (error) { fail(res, error); }
});

router.post("/run", async (req: Request, res: Response) => {
  if (!canOperate(req)) { deny(res); return; }
  try { res.json(await runProposalAnalysis({ reason: "MANUAL" })); } catch (error) { fail(res, error, 503); }
});

router.post("/:id/decision", async (req: Request, res: Response) => {
  if (!canOperate(req)) { deny(res); return; }
  try {
    const decision = String(req.body?.decision ?? "");
    if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "EDIT") throw new Error("decision phải là APPROVE, REJECT hoặc EDIT.");
    res.json(await decideMarketIntelProposal({
      id: String(req.params.id), decision, actor: text(req.body?.actor, 80) || "operator", note: text(req.body?.note), editedValue: text(req.body?.editedValue, 80),
    }));
  } catch (error) { fail(res, error); }
});

router.post("/config/rollback", async (req: Request, res: Response) => {
  if (!canOperate(req)) { deny(res); return; }
  try {
    res.json(await rollbackMarketIntelConfig({ toVersion: int(req.body?.toVersion), actor: text(req.body?.actor, 80) || "operator", note: text(req.body?.note) }));
  } catch (error) { fail(res, error); }
});

router.post("/config/:version/deployed", async (req: Request, res: Response) => {
  if (!canOperate(req)) { deny(res); return; }
  try {
    res.json(await markMarketIntelConfigDeployed({ version: int(req.params.version), actor: text(req.body?.actor, 80) || "operator", note: text(req.body?.note) }));
  } catch (error) { fail(res, error); }
});

export default router;
