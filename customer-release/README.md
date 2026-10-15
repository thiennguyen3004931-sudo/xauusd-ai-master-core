# XAUUSD Customer Agent Release

This release contains customer-side libraries and bootstrap scripts only.

It does **not** contain Master strategy, risk, execution, MT5 bridge, server persistence, or Master source code.

## 1. Requirements

- Windows customer machine
- Node.js 24
- HTTPS access to the Customer API Gateway
- Customer MT5 login and broker server approved by the administrator

## 2. Generate installation identity on the customer machine

From this release directory:

```powershell
node .\bin\generate-installation-identity.mjs
```

The command prints:

- INSTALLATION_ID
- INSTALLATION_PUBLIC_KEY

Send only those two values to the administrator.

Never send:

- `keys/installation-private.pem`

The private key must remain on the customer machine.

## 3. Administrator provisioning

The administrator creates the customer License and Grant bound to:

- customer ID
- MT5 login
- broker server
- installation ID
- installation public key
- product mode

For SELF_MANAGED, grant only the approved bot modes.

For COPY_FOLLOWER, grant only the approved sizing modes.

## 4. Configure the customer agent

Copy:

```text
config/customer-agent.example.json
```

to:

```text
config/customer-agent.json
```

Fill in:

- HTTPS gateway URL
- product mode
- grant ID
- MT5 login
- broker server
- requested SELF_MANAGED mode or COPY_FOLLOWER sizing mode

Keep the first SELF_MANAGED activation at PAUSE for handoff verification.

## 5. Set the API token only in the process environment

```powershell
$env:XAUUSD_CUSTOMER_API_TOKEN = "<customer bearer token>"
```

Do not save the token in the JSON configuration.

## 6. Activate

```powershell
node .\bin\activate-customer-agent.mjs
```

Expected success contains:

```text
"ok": true
```

## COPY_FOLLOWER execution status

This release verifies and normalizes signed copy commands through a fail-closed execution boundary.

The included acceptance uses an injected simulated executor. It does not send an MT5 order.

A real MT5 follower executor requires a separately approved production integration and LIVE execution acceptance.

## Security boundary

- Master source: not distributed
- Installation private key: generated/stored locally
- Bearer token: environment variable only
- HTTPS only
- Replay protection: enabled
- Cross-customer / wrong-installation binding: denied
