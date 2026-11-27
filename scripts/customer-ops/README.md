# Customer licensing operator + HTTPS Gateway (staging, NO live trading)

This phase wires existing tested customer security contracts into a **local, operator-only CLI** and an **HTTPS customer activation listener**. It does not install a customer trading bot, implement an MT5 bridge, expose Master Control APIs, or authorize LIVE execution.

## Prerequisites and security

- Windows Node.js 24.x + pnpm 10.18.0; run from **private Core repository root**.
- Build `@xauusd/license-service`, `@xauusd/customer-product-access`, `@xauusd/customer-grant-registry`, `@xauusd/installation-proof`, `@xauusd/customer-runtime-gate` and `@xauusd/customer-runtime-session`. Run the accompanying CI before operational use.
- Keep the customer SQLite database, **separate operator-owned token ledger**, TLS certificate and **private TLS key** on an access-controlled server disk, not in GitHub or the customer ZIP. Use restrictive NTFS ACLs and dedicated service identities.
- Local operator approval via `XAUUSD_CUSTOMER_ADMIN_APPROVED=YES` is **only an explicit interactive safety confirmation, not authentication**. Real access control comes from the OS account/NTFS permissions and the private host. Never publish this CLI as an unauthenticated HTTP endpoint.
- Do not run the listener as SYSTEM or as an internet-facing wildcard listener. For remote clients, choose a specific interface and explicitly set `XAUUSD_CUSTOMER_GATEWAY_ALLOW_REMOTE=YES`, configure firewalls and a valid HTTPS certificate, and perform an independent deployment security review.

## 1. Build and test (no broker)

```powershell
pnpm install --frozen-lockfile
$packages = @(
  '@xauusd/license-service', '@xauusd/customer-product-access',
  '@xauusd/customer-grant-registry', '@xauusd/installation-proof',
  '@xauusd/customer-runtime-gate', '@xauusd/customer-runtime-session'
)
foreach ($package in $packages) { pnpm --filter $package build; if ($LASTEXITCODE -ne 0) { throw "Build failed: $package" } }
node --test scripts/customer-ops/customer-ops.test.mjs
```

## 2. Enroll a validated parent license (offline)

After the customer generates their local installation ID + Ed25519 public key, create a server-only JSON file like the following in a protected path (timestamps are Unix epoch **milliseconds**):

```json
{
  "licenseId": "license-unique-001",
  "status": "ACTIVE",
  "customerId": "customer-unique-001",
  "allowedMt5Logins": [12345678],
  "allowedBrokerServers": ["Broker-Demo"],
  "installationId": "installation-from-customer",
  "installationPublicKey": "public-key-from-customer",
  "plan": "CUSTOMER_V1",
  "maxAccounts": 1,
  "issuedAt": 1792900000000,
  "expiresAt": 1824436000000,
  "revokedAt": null
}
```

These timestamps and example account/server are placeholders. Use an approved currently valid license, accurate account binding and real public key. A repeated license ID is **rejected atomically**, not overwritten.

```powershell
$env:XAUUSD_CUSTOMER_ADMIN_APPROVED = 'YES'
node scripts/customer-ops/operator.mjs enroll-license C:\Secure\XAUUSD\customer.sqlite C:\Secure\XAUUSD\license.json
Remove-Item Env:\XAUUSD_CUSTOMER_ADMIN_APPROVED
```

## 3. Issue a strictly bound grant

SELF_MANAGED example (`PAUSE` is always included automatically):

```json
{
  "productMode": "SELF_MANAGED",
  "licenseId": "license-unique-001",
  "grantId": "grant-self-unique-001",
  "issuedAt": 1792900000000,
  "expiresAt": 1824436000000,
  "allowedBotModes": []
}
```

COPY_FOLLOWER example (simulated/DEMO-only until separate bridge acceptance):

```json
{
  "productMode": "COPY_FOLLOWER",
  "licenseId": "license-unique-001",
  "grantId": "grant-copy-unique-001",
  "issuedAt": 1792900000000,
  "expiresAt": 1824436000000,
  "allowedCopySizingModes": ["EQUITY_RATIO"]
}
```

```powershell
$env:XAUUSD_CUSTOMER_ADMIN_APPROVED = 'YES'
node scripts/customer-ops/operator.mjs issue-grant C:\Secure\XAUUSD\customer.sqlite C:\Secure\XAUUSD\grant.json
Remove-Item Env:\XAUUSD_CUSTOMER_ADMIN_APPROVED
```

All identity fields come from the **already enrolled parent license**, not the grant input. A grant cannot outlive its parent license or cross customer/installation identity.

## 4. Operator-owned durable bearer token ledger (required)

The Gateway no longer accepts a static list of SHA-256 token hashes. It requires an
**existing** operator-managed SQLite token ledger, provisioned and maintained outside
customer-restorable storage. It checks revocation, generation and expiry on every
request, and returns a denial if the ledger is unavailable. Never copy the ledger,
its WAL/SHM files or backups into a customer ZIP or customer restore scope.

Ledger initialization and registration require a separately authorized operator and
independently reviewed NTFS ACL, audit and encrypted disaster-recovery procedures.
This PR does **not** perform live token issuance or initialize a real ledger. The
standalone synthetic ledger tests use only disposable test records.

The ledger itself still needs an external monotonic authority and KMS-backed key
custody before release. Local SQLite durability alone is not P0 anti-rollback proof.

## 5. Start HTTPS Gateway (staging)

Supply a properly issued TLS cert/key. The listener binds to `127.0.0.1:8443` unless explicitly configured, and rejects wildcard addresses even when remote listening is allowed.

```powershell
$env:XAUUSD_CUSTOMER_GATEWAY_DB = 'C:\Secure\XAUUSD\customer.sqlite'
$env:XAUUSD_CUSTOMER_GATEWAY_OPERATOR_TOKEN_LEDGER = 'C:\\OperatorOnly\\XAUUSD\\tokens.sqlite'
$env:XAUUSD_CUSTOMER_GATEWAY_TLS_KEY = 'C:\Secure\XAUUSD\server.key'
$env:XAUUSD_CUSTOMER_GATEWAY_TLS_CERT = 'C:\Secure\XAUUSD\server.crt'
node scripts/customer-ops/serve-gateway.mjs
```

The customer activation agent uses HTTPS `POST /v1/customer/runtime/challenge` and `POST /v1/customer/runtime/activate`. Only customer access/authentication is handled here: **no mode switch, ARM, MT5 or order endpoints**. Do not expose the operator CLI remotely.

## 6. Revoke a compromised or retired grant (offline)

```powershell
$env:XAUUSD_CUSTOMER_ADMIN_APPROVED = 'YES'
node scripts/customer-ops/operator.mjs revoke-grant C:\Secure\XAUUSD\customer.sqlite grant-copy-unique-001
Remove-Item Env:\XAUUSD_CUSTOMER_ADMIN_APPROVED
```

A revoked grant denies activation for COPY_FOLLOWER. SELF_MANAGED's designed safe PAUSE fallback must not be treated as a permission for live exposure.

## Current deployment blockers

- No verified customer-facing DNS/TLS deployment, OS hardening, secret-management rollout or operational backups have been executed by this PR.
- Offline CLI enrollment and issue/revoke use OS identity/ACL controls; no authenticated production admin dashboard/route is provided.
- SELF_MANAGED customer trading runtime and COPY_FOLLOWER real MT5 bridge/DEMO execution remain separate deliverables tracked in [Issue #160](https://github.com/thiennguyen3004931-sudo/xauusd-ai-master-core/issues/160).
- **Never close customer acceptance Issue #158 just because integration CI passes.**
