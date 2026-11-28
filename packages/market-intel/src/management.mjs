// Advisory trade-management plan for a scenario: where to move the stop to ride a trend, and how
// much volume to close at each target. Read-only and advisory: it never sends, modifies or closes
// an order and does not change the bot. It mirrors the bot's own rules (BE at +trigger -> entry +
// offset, 1/3 at +10, stop only tightens) and adds structure-based trailing on closed M15 bars.
// Not backtested as a whole: the notes say so, and the UI must show them.
import { detectSwings } from "./structure.mjs";

export const MANAGEMENT_PLAN_VERSION = "mgmt-plan-v1";

const SAFETY = Object.freeze({ readOnly: true, advisoryOnly: true, orderMutation: false, runtimeMutation: false });
const PARTIAL_DISTANCE = 10; // bot rule: close 1/3 at +10
const TRAIL_BUFFER = 1; // price units beyond the swing, same spirit as the bot's structure buffer
const LOT_STEP = 0.01;

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Split a lot into parts on the broker step; the last part takes the remainder. */
function splitLot(lot, fractions) {
  if (!(lot > 0)) return fractions.map(() => null);
  const parts = [];
  let used = 0;
  fractions.forEach((f, i) => {
    if (i === fractions.length - 1) {
      parts.push(round2(lot - used));
    } else {
      const part = Math.max(LOT_STEP, Math.floor((lot * f) / LOT_STEP + 1e-9) * LOT_STEP);
      parts.push(round2(part));
      used = round2(used + part);
    }
  });
  return parts;
}

/**
 * @param scenario a Scenario from buildScenarios (direction, entry, stopLoss, takeProfit1/2, invalidation)
 * @param options m15 closed bars; breakEvenTriggerPrice / breakEvenOffsetPrice (bot default 6 / 0); lot (optional)
 */
export function managementPlan(scenario, {
  m15 = [],
  breakEvenTriggerPrice = 6,
  breakEvenOffsetPrice = 0,
  lot = null,
  swingBars = 3,
} = {}) {
  const buy = scenario.direction === "BUY";
  const sign = buy ? 1 : -1;
  const entry = Number(scenario.entry);
  const at = (distance) => round2(entry + sign * distance);
  const beyond = (a, b) => (buy ? a > b : a < b); // a is further in profit than b

  // ---- Partials ----
  const tp1Distance = Math.abs(scenario.takeProfit1 - entry);
  const partials = [];
  if (tp1Distance > PARTIAL_DISTANCE) {
    partials.push({ id: "PLUS_10", label: "+10 giá", price: at(PARTIAL_DISTANCE), fraction: 1 / 3, reason: "Luật bot: chốt 1/3 ở +10." });
    partials.push({ id: "TP1", label: "TP1", price: round2(scenario.takeProfit1), fraction: 1 / 3, reason: "Chốt thêm 1/3 ở vùng cản đầu tiên." });
    partials.push({ id: "TP2", label: "TP2", price: round2(scenario.takeProfit2), fraction: 1 / 3, reason: "Phần còn lại gồng tới TP2 theo SL dời dần." });
  } else {
    partials.push({ id: "TP1", label: "TP1", price: round2(scenario.takeProfit1), fraction: 1 / 2, reason: "TP1 gần hơn +10: chốt một nửa ở TP1." });
    partials.push({ id: "TP2", label: "TP2", price: round2(scenario.takeProfit2), fraction: 1 / 2, reason: "Nửa còn lại gồng tới TP2 theo SL dời dần." });
  }
  const lots = splitLot(Number(lot), partials.map((p) => p.fraction));
  partials.forEach((p, i) => { p.lot = lots[i]; });

  // ---- Stop steps (each only tightens) ----
  const beStop = at(breakEvenOffsetPrice);
  const stopSteps = [{
    id: "BREAK_EVEN",
    when: `Giá đi được +${breakEvenTriggerPrice} giá`,
    triggerPrice: at(breakEvenTriggerPrice),
    newStop: beStop,
    reason: breakEvenOffsetPrice > 0 ? `Dời SL về entry + ${breakEvenOffsetPrice} (luật BE của bot).` : "Dời SL về entry (luật BE của bot).",
  }];

  const lockStop = round2(entry + (scenario.takeProfit1 - entry) / 2);
  if (beyond(lockStop, beStop)) {
    stopSteps.push({
      id: "AFTER_TP1",
      when: "Chạm TP1",
      triggerPrice: round2(scenario.takeProfit1),
      newStop: lockStop,
      reason: "Khoá một nửa quãng đường tới TP1, phần còn lại vẫn có chỗ thở.",
    });
  }

  // Order fixed-trigger steps by how far price must travel, and keep only steps that tighten
  // further (e.g. TP1 nearer than +BE: the TP1 lock already sits beyond entry, so BE adds nothing).
  stopSteps.sort((a, b) => Math.abs(a.triggerPrice - entry) - Math.abs(b.triggerPrice - entry));
  for (let i = stopSteps.length - 1; i > 0; i -= 1) {
    if (!beyond(stopSteps[i].newStop, stopSteps[i - 1].newStop)) stopSteps.splice(i, 1);
  }
  const tightest = stopSteps.at(-1).newStop;

  // Latest confirmed M15 swing in the trade direction (higher low for BUY, lower high for SELL).
  let currentCandidate = null;
  let swingPrice = null;
  const last = m15.length - 1;
  if (last >= 0) {
    const swings = detectSwings(m15, swingBars).filter((s) => s.confirmIndex <= last && s.type === (buy ? "LOW" : "HIGH"));
    const latest = swings.at(-1);
    if (latest) {
      swingPrice = round2(latest.price);
      const candidate = round2(latest.price - sign * TRAIL_BUFFER);
      const close = m15[last].close;
      if (beyond(candidate, tightest) && beyond(close, candidate)) currentCandidate = candidate;
    }
  }
  stopSteps.push({
    id: "TRAIL_M15_SWING",
    when: buy ? "Mỗi đáy cao hơn (HL) M15 mới được xác nhận" : "Mỗi đỉnh thấp hơn (LH) M15 mới được xác nhận",
    triggerPrice: null,
    newStop: null,
    swingPrice,
    currentCandidate,
    reason: buy
      ? `Dời SL xuống dưới đáy đó ${TRAIL_BUFFER} giá, chỉ khi SL mới cao hơn SL hiện tại.`
      : `Dời SL lên trên đỉnh đó ${TRAIL_BUFFER} giá, chỉ khi SL mới thấp hơn SL hiện tại.`,
  });

  return {
    version: MANAGEMENT_PLAN_VERSION,
    role: scenario.role,
    direction: scenario.direction,
    entry: round2(entry),
    initialStop: round2(scenario.stopLoss),
    partials,
    stopSteps,
    exit: {
      text: `${String(scenario.invalidation?.text ?? "Kịch bản mất hiệu lực").replace(/[.\s]+$/, "")}: đóng phần còn lại. Nến M15 đóng ${buy ? "dưới đáy HL" : "trên đỉnh LH"} gần nhất (đổi cấu trúc) cũng là dấu hiệu nên thoát.`,
    },
    notes: [
      "Gợi ý để tham khảo, không phải lệnh. Bot không tự làm theo kế hoạch này.",
      "Kế hoạch chưa được kiểm chứng bằng backtest; các báo cáo hiện có (R4, Market Intel PF 0,90) chưa cho thấy cách quản lý lệnh nào tạo lợi thế.",
    ],
    safety: SAFETY,
  };
}
