# COPY_FOLLOWER signed-command simulated runner (NO broker I/O)

The dry-run command validates a Master-signed command using a trusted Ed25519 public key, customer/installation/MT5 binding and allowed symbol. It then reserves the command ID/sequence **durably in SQLite** before forwarding it to an injected **no-op simulator**. There is no MT5 bridge, network transport, Master strategy or real broker mutation here.

## Prerequisites

- Run only in a controlled test environment, with Node.js 24.x and built `@xauusd/copy-protocol`, `@xauusd/customer-agent`, `@xauusd/customer-follower-state`.
- Never store a Master private signing key in the follower configuration.
- Keep the SQLite journal per unique `licenseId` / `installationId` / `mt5Login` / `brokerServer` binding; file must be writable in a controlled, persistent location.

## 1. Prepare a demo-only config

Example protected file `C:\DemoFollower\copy-demo.json`:

```json
{
  "productMode": "COPY_FOLLOWER",
  "executionMode": "SIMULATED_ONLY",
  "licenseId": "YOUR_APPROVED_LICENSE_ID",
  "installationId": "YOUR_APPROVED_INSTALLATION_ID",
  "mt5Login": 12345678,
  "brokerServer": "Broker-Demo",
  "allowedSymbols": ["XAUUSD"],
  "trustedPublicKeys": {
    "master-key-id": "-----BEGIN PUBLIC KEY-----\\nYOUR_APPROVED_MASTER_PUBLIC_KEY\\n-----END PUBLIC KEY-----"
  },
  "journalPath": "C:\\DemoFollower\\command-journal.sqlite"
}
```

The public-key example is deliberately a placeholder and cannot verify a real signed command. Use the exact approved public key and key ID from a trusted administrator channel. Do not copy an unknown key from a signal file.

## 2. Obtain a signed command from the approved DEMO test harness

Provide an exact valid `SignedCopyCommand` JSON from the authorized Master test process, stored on the local machine. Never accept arbitrary unsigned command JSON.

## 3. Verify + dry-run once

```powershell
node scripts/customer-follower-demo/verify-and-simulate.mjs C:\DemoFollower\copy-demo.json C:\DemoFollower\signed-command.json
```

- First fresh valid command: `DISPATCHED` with `simulatedOnly: true`, `mt5Mutation: false`.
- Duplicate ID after restart: `REPLAYED_COMMAND`, no second execution.
- Non-monotonic sequence after restart: `SEQUENCE_NOT_MONOTONIC`.
- Tampered signature or wrong account/installation/key: denied before reservation.
- On executor uncertainty, the reservation stays `RESERVED`, preventing automatic replay until independently reconciled. **A reserved order is not proof that any broker has filled it.**

## Remaining before real follower deployment

- Build and deploy a separately approved local MT5 bridge and authenticated signed-command transport.
- Enforce account/server/symbol binding, lot sizing rules, margin/exposure and trailing/SL/TP policy with actual broker-side snapshots.
- Add approved DEMO acceptance of disconnect/restart/open/partial/full close/reconciliation and operator recovery for unresolved reservations.
- Keep Master signing key private, use signed releases, and separate DEMO and LIVE environments.
- Require independent documented approval before any actual LIVE execution.

Never infer LIVE readiness from this CLI or green CI. Track production runtime work in [Issue #160](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/issues/160).
