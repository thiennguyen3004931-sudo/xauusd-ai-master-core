// Types for the single Phase 7C break-even (BE) configuration source (used by the API).
export const DEFAULT_BREAK_EVEN_TRIGGER_PRICE: number;
export const DEFAULT_BREAK_EVEN_OFFSET_PRICE: number;
export const BREAK_EVEN_TRIGGER_MIN_PRICE: number;
export const BREAK_EVEN_TRIGGER_MAX_PRICE: number;
export const BREAK_EVEN_OFFSET_MIN_PRICE: number;
export const BREAK_EVEN_OFFSET_MAX_PRICE: number;
export const BREAK_EVEN_APPLY_POLICY: "NEW_POSITIONS_ONLY";
export function validateBreakEvenConfig(
  triggerPrice: unknown,
  offsetPrice: unknown,
):
  | { valid: true; reason: string; breakEvenTriggerPrice: number; breakEvenOffsetPrice: number }
  | { valid: false; reason: string };
