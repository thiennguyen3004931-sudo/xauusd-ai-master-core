# Customer Copy Action Gate V1

## Goal

Enforce the current COPY_FOLLOWER grant and current license on every copy command authorization, not only at activation time.

This closes the post-activation revoke gap: if a customer grant is revoked or expires after a follower has already activated, new exposure must stop immediately while matched risk-reducing actions remain available.

## Inputs and trust boundary

Caller/request input contains:

- grantId
- licenseId from the verified copy command
- installationId
- MT5 login
- broker server
- copy action
- master position reference
- optional existing position context

Caller input must not contain server time.

A server-owned clock is injected separately.

Signature verification, command sequence/replay protection, payload execution validation, and transport authentication remain upstream/downstream boundaries and are not weakened by this gate.

## Server-side resolution

For every command:

1. validate the runtime action request shape;
2. read trusted server time;
3. resolve the current grant lifecycle by grantId;
4. require COPY_FOLLOWER product mode;
5. resolve the current license by the grant's licenseId;
6. require exact grant/license/customer/installation validity binding;
7. require the signed command licenseId to match the current grant;
8. delegate account/broker/action checks to the canonical license action matrix;
9. apply the current grant lifecycle matrix;
10. for POSITION_OPEN, re-read current grant, license and server time before returning authorization.

## Grant lifecycle action matrix

When the grant is ACTIVE:

- the canonical license action matrix decides whether the action is allowed.

When the grant is NOT_YET_VALID, EXPIRED or REVOKED:

- POSITION_OPEN: blocked;
- TAKE_PROFIT_UPDATE: blocked;
- PARTIAL_CLOSE: allowed only for an existing matched position;
- POSITION_CLOSE: allowed only for an existing matched position;
- POSITION_SNAPSHOT: allowed only for an existing matched position;
- STOP_LOSS_UPDATE: allowed only for an existing matched position and only when the requested stop is non-loosening.

This preserves safety/reconciliation paths while preventing fresh exposure after entitlement loss.

## License lifecycle interaction

The grant gate never weakens the license matrix.

Examples:

- active grant + suspended license: POSITION_OPEN remains blocked;
- active grant + suspended license: matched POSITION_CLOSE remains available;
- revoked grant + active license: POSITION_OPEN is still blocked by the grant;
- revoked grant + active license: matched risk-reducing actions may remain available.

## New-exposure freshness

POSITION_OPEN receives an additional final check:

- trusted server time must not move backward;
- grant lifecycle snapshot must remain unchanged;
- license snapshot must remain unchanged;
- effective grant status must still be ACTIVE;
- effective license status must still be ACTIVE.

Any change fails closed with `RUNTIME_STATE_CHANGED`.

## Out of scope

V1 does not:

- verify Ed25519 copy signatures;
- consume copy command sequence/replay state;
- validate trade payload semantics;
- place or modify orders;
- call MT5;
- mount an API route;
- change AUTO/ARM state;
- change strategy/risk/execution logic;
- mutate production.

## Acceptance

Tests must prove:

1. active COPY_FOLLOWER grant + active license authorizes POSITION_OPEN;
2. caller-supplied server time is rejected before source access;
3. revoked grant blocks POSITION_OPEN immediately;
4. revoked grant blocks TAKE_PROFIT_UPDATE;
5. revoked grant permits matched PARTIAL_CLOSE, POSITION_CLOSE and POSITION_SNAPSHOT;
6. revoked grant permits only non-loosening STOP_LOSS_UPDATE;
7. revoked grant requires a matched existing position for safe actions;
8. license non-active matrix is still enforced;
9. license/grant identity mismatch fails closed;
10. SELF_MANAGED grants cannot pass the copy action gate;
11. grant state change before POSITION_OPEN returns fails closed;
12. server time crossing grant expiry before POSITION_OPEN returns fails closed.

## Safety boundary

```text
PUBLIC_CONTRACT_MUTATION=NONE
PRODUCTION_MUTATION=NONE
BOT_RUNTIME_MUTATION=NONE
MODE_MUTATION=NONE
ARM_MUTATION=NONE
ORDER_MUTATION=NONE
POSITION_MUTATION=NONE
LIVE_TEST_ORDER=NONE
PERSISTENCE_MUTATION=NONE
NETWORK_MUTATION=NONE
API_ROUTE_MUTATION=NONE
```
