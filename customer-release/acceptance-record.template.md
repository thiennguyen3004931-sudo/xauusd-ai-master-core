# Customer Installation & Handoff Acceptance Record

Use one copy per customer installation. This record is for sanitized operational evidence only; **never record bearer tokens, passwords, private keys, full environment dumps, or unmasked account secrets**. Store completed records only in the approved access-controlled customer record system, not in this repository.

Status values: `PASS`, `FAIL`, `BLOCKED`, or `N/A`. Explain every `FAIL`, `BLOCKED`, and `N/A`.

## 1. Verified package evidence

The following values identify the customer package built and verified by CI on 2026-10-19. Re-check and replace this section when using a different package.

| Field | Verified value |
|---|---|
| Package version | `1.0.0` |
| Source commit | `23bbf69556861593ec55b044778ed274635e3cfb` |
| Workflow run | [39280213885](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/actions/runs/39280213885) |
| GitHub artifact ID | `12202345738` |
| GitHub artifact name | `xauusd-customer-agent-v1` |
| GitHub artifact archive SHA-256 | `307b24daf198c9a57b9a5992e705e63cf878130e5208e1174cca36f7d04ba2be` |
| Downloaded customer ZIP SHA-256 | `a893f5296db9932bc729fa84b5f1e8ab0c70e0cc50258dd501a084a8e1ef6945` |
| Customer ZIP internal manifest | 20 entries verified; all hashes matched |
| Artifact expiry | 2026-11-18 16:03:18 UTC |
| Official GitHub Release | Not created; this is a CI artifact, not a tagged release |

The two SHA-256 values refer to different files: the GitHub Actions artifact archive and the downloaded customer package ZIP. Do not interchange them. Verify the checksum of the exact file received before extraction. The inner ZIP hash identifies the package contained inside the downloaded outer artifact archive.

## 2. Customer and installation scope

- Customer reference (non-secret): `[fill in]`
- Handoff ticket/reference (no credentials): `[fill in]`
- Delivery mode: `[SELF_MANAGED / COPY_FOLLOWER]`
- Installation ID: `[fill in after generating on customer machine]`
- Grant/license reference (ID only): `[fill in]`
- MT5 login: `[masked; e.g. ****1234]`
- Broker server: `[fill in approved server label]`
- Gateway host (HTTPS only; no query strings or tokens): `[fill in]`
- Customer machine / operator reference: `[fill in]`
- Acceptance date/time and timezone: `[fill in]`

Do not attach the installation private key. The private key must remain on the machine where the identity was generated.

## 3. Installation and security checks

| Check | Status | Evidence reference / sanitized note |
|---|---|---|
| Received ZIP checksum matches the approved package | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| Package extracted on the intended Windows machine; Node.js 24.x confirmed | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| Installation identity generated on that machine | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| Installation ID/public key registered by administrator | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| Grant matches customer, installation, product mode, MT5 login and broker server | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in; do not include secrets]` |
| HTTPS gateway is reachable; no public Master API or MT5 bridge exposure | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| Bearer token supplied through process environment only; token not recorded | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| Activation accepted for the intended installation | `[PASS/FAIL/BLOCKED/N/A]` | `[timestamp / sanitized result]` |
| Denial paths covered by automated evidence (wrong binding, replay, revoked grant) | `[PASS/FAIL/BLOCKED/N/A]` | `[CI run/test reference]` |
| No credentials/private keys included in logs, tickets or handoff record | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |

Activation returning `ok: true` proves only that the gateway accepted the activation request. It does not prove MT5 connectivity, runtime health, executable orders, or LIVE authorization.

## 4. Trading-mode and execution boundary

| Check | Status | Evidence reference / sanitized note |
|---|---|---|
| SELF_MANAGED initial mode remains `PAUSE` | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| COPY_FOLLOWER uses only an explicitly authorized sizing mode | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| Follower execution acceptance is identified as simulated or approved DEMO only | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| No live order was sent as part of this handoff | `[PASS/FAIL/BLOCKED/N/A]` | `[fill in]` |
| Any future real MT5 execution has separate documented approval and its own acceptance evidence | `[PASS/FAIL/BLOCKED/N/A]` | `[approval reference or N/A reason]` |

**This record does not authorize LIVE trading.** Do not change Master `BOT_MODE`, ARM/AUTO, activate a real bridge, or send a LIVE test order as part of this package handoff.

## 5. Outcome and sign-off

- Overall outcome: `[PASS / FAIL / BLOCKED]`
- Open blockers / remediation owner / due date: `[fill in]`
- Sanitized evidence references: `[fill in]`
- Operator name or approved identity and sign-off: `[fill in]`
- Customer representative and sign-off: `[fill in]`
- Administrator/provisioning sign-off: `[fill in]`

Mark the operational handoff complete only when all required checks pass, all blockers are resolved, and customer/operator sign-off is recorded. Software CI passing is not a substitute for acceptance on the customer's actual machine.
