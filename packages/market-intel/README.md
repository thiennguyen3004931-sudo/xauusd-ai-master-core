# @xauusd/market-intel

Read-only market intelligence for the XAUUSD Phase 7C bot. Advisory only: nothing in this package
sends, modifies or closes orders, touches the MT5 broker, the network, BOT_MODE or LIVE ARM
(`test/isolation.test.mjs` enforces this statically).

- Feature 3 — regime template library (`regime-library-v1`): Uptrend / Downtrend / Sideway templates
  with weighted quantitative criteria on H1 + H4, causal features, BOS/CHoCH, annotated SVG charts.
  Flag `ZIQ_MARKET_INTEL_REGIME_LIBRARY_ENABLED` (default off). Docs: `docs/market-intel/regime-library.md`.

Plain ESM JavaScript with no dependencies and no build step. Tests: `node --test packages/market-intel/test/*.test.mjs`.
