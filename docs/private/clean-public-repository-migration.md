# Clean distribution repository migration

Status: source import complete; CI acceptance pending. All repositories remain private during validation.

- Replacement: `thiennguyen3004931-sudo/xauusd-ai-master`, repository ID `1432234586`.
- Replacement main: `06dc6901874839bbaba58fc37e51790c3d366c59`.
- Source tree: `c0be424f1ea023129e8c095ca75b11813c077b5c`.
- Legacy repository: `xauusd-ai-master-legacy-private`; must remain private.
- Replacement history: root README commit plus sanitized import, one main branch, no tags. No legacy commit ancestry was imported.
- 54 allowlisted files. Three governed package trees unchanged from the existing contract lock.

The imported source tree exactly matches the locally validated clean candidate: build and typecheck of three packages, 143 package tests, 30 security tests and P1/P2/P3 boundary checks passed. The new first-push regression handles a zero base SHA by inspecting every published path.

Remote Actions runs started on the imported commit but failed before any job steps executed. For example: https://github.com/thiennguyen3004931-sudo/xauusd-ai-master/actions/runs/40100431997 . No runner step output was available. The cause has not been confirmed; do not describe these runs as source-test failures or successful acceptance.

Before merge/release:

1. Resolve the pre-step Actions failure and require completed public boundary/distribution jobs, including the redacted history secret scan.
2. Validate the private CI runner can fetch the replacement commit. While the distribution repo is private, the existing cross-repository git fetch needs an independently authorized read credential; the core repository GITHUB_TOKEN should not be assumed to have cross-repository access. Do not embed credentials in source or logs.
3. Require Private Master Core and Canonical PR Gate on this change. Keep this PR draft until the gates have actually executed successfully.
4. Any later visibility change is a separate owner action after validation. Do not switch the legacy repository or Master/Core to public.

This change pins only public contract provenance. No strategy, risk, execution, MT5 runtime, account, ARM or bot-mode change is included.
