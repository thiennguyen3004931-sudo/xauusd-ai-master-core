"""Observe a running, isolated MT5 DEMO bridge for the P5 pilot record."""
from __future__ import annotations

import argparse
import json
import time
import warnings
from contextlib import closing
from datetime import datetime, timezone
from getpass import GetPassWarning, getpass
from http.client import HTTPConnection, HTTPException
from typing import Any


HEALTH_PATH = "/health?reconnect=false"
POSITIONS_PATH = "/v1/positions?reconnect=false"
ORDERS_PATH = "/v1/orders?reconnect=false"
MAX_RESPONSE_BYTES = 256 * 1024
MAX_HEALTH_AGE_MS = 30_000


class PreflightBlocked(Exception):
    """A stable diagnostic code safe to include in the pilot record."""


def _bridge_get(port: int, api_key: str, path: str) -> Any:
    # Direct loopback transport. HTTPConnection neither follows redirects nor
    # uses proxy settings from the operator's environment.
    try:
        with closing(HTTPConnection("127.0.0.1", port, timeout=5)) as connection:
            connection.request(
                "GET", path,
                headers={
                    "Accept": "application/json",
                    "X-MT5-API-Key": api_key,
                    "Cache-Control": "no-store",
                },
            )
            with connection.getresponse() as response:
                if 300 <= response.status < 400:
                    raise PreflightBlocked("BRIDGE_REDIRECT_REJECTED")
                if response.status != 200:
                    raise PreflightBlocked("BRIDGE_REQUEST_REJECTED")
                body = response.read(MAX_RESPONSE_BYTES + 1)
    except (OSError, HTTPException):
        raise PreflightBlocked("BRIDGE_READ_FAILED") from None

    if len(body) > MAX_RESPONSE_BYTES:
        raise PreflightBlocked("BRIDGE_RESPONSE_TOO_LARGE")
    try:
        return json.loads(body)
    except (ValueError, RecursionError):
        raise PreflightBlocked("BRIDGE_RESPONSE_INVALID") from None


def _verified_health(health: Any, login: int, server: str) -> tuple[str, int, int]:
    if not isinstance(health, dict):
        raise PreflightBlocked("BRIDGE_RESPONSE_INVALID")
    timestamp = health.get("timestamp")
    if (
        health.get("healthSource") != "LIVE_PROBE"
        or health.get("gatewayBusy") is not False
        or type(timestamp) is not int
        or abs(time.time_ns() // 1_000_000 - timestamp) > MAX_HEALTH_AGE_MS
    ):
        raise PreflightBlocked("FRESH_HEALTH_REQUIRED")
    if (
        health.get("status") != "ok"
        or health.get("connected") is not True
        or health.get("reconnecting") is not False
    ):
        raise PreflightBlocked("MT5_TERMINAL_UNAVAILABLE")
    if health.get("configuredAccountMode") != "DEMO" or health.get("accountMode") != "demo":
        raise PreflightBlocked("DEMO_MODE_REQUIRED")
    if (
        type(health.get("accountLogin")) is not int
        or health["accountLogin"] != login
        or health.get("server") != server
    ):
        raise PreflightBlocked("DEMO_BINDING_MISMATCH")
    if health.get("brokerConnected") is not True:
        raise PreflightBlocked("BROKER_CONNECTION_REQUIRED")
    if any(health.get(field) is not False for field in (
        "tradingEnabled", "terminalTradeAllowed", "liveExecutionArmed", "liveArmRequired",
    )):
        raise PreflightBlocked("TRADING_DISABLED_REQUIRED")

    session = health.get("bridgeSessionId")
    reconnects = health.get("reconnectCount")
    if not isinstance(session, str) or not session.strip() or type(reconnects) is not int or reconnects < 0:
        raise PreflightBlocked("BRIDGE_SESSION_UNVERIFIED")
    return session, reconnects, timestamp


def _report(status: str, reason: str, **counts: int) -> dict[str, Any]:
    return {
        "scope": "MT5_DEMO_ACCOUNT_AND_EXPOSURE_READ_ONLY",
        "status": status,
        "reasonCode": reason,
        "observedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "brokerExecutionAllowed": False,
        **counts,
    }


def run_preflight(port: int, login: int, server: str, api_key: str) -> dict[str, Any]:
    if (
        type(port) is not int or not 1 <= port <= 65535
        or type(login) is not int or not 0 < login <= (1 << 63) - 1
        or not isinstance(server, str) or not server or not server.isprintable() or server.strip() != server
        or not isinstance(api_key, str) or len(api_key) < 16
        or not api_key.isascii() or not api_key.isprintable() or api_key.strip() != api_key
    ):
        return _report("BLOCKED", "LOCAL_INPUT_INVALID")

    try:
        before = _verified_health(_bridge_get(port, api_key, HEALTH_PATH), login, server)
        positions = _bridge_get(port, api_key, POSITIONS_PATH)
        orders = _bridge_get(port, api_key, ORDERS_PATH)
        after = _verified_health(_bridge_get(port, api_key, HEALTH_PATH), login, server)
        if before[:2] != after[:2] or after[2] < before[2]:
            raise PreflightBlocked("BRIDGE_SESSION_CHANGED")
        if not isinstance(positions, list) or not isinstance(orders, list):
            raise PreflightBlocked("BRIDGE_RESPONSE_INVALID")
    except PreflightBlocked as blocked:
        return _report("BLOCKED", str(blocked))

    counts = {"openPositions": len(positions), "activeOrders": len(orders)}
    if positions or orders:
        return _report("BLOCKED", "DEMO_EXPOSURE_PRESENT", **counts)
    return _report("PASS", "DEMO_BINDING_AND_FLAT", **counts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-isolated-demo", action="store_true", required=True)
    parser.add_argument("--port", type=int, required=True, help="Loopback port of the isolated DEMO bridge")
    parser.add_argument("--expected-server", required=True, help="Exact approved DEMO broker server")
    args = parser.parse_args()

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", GetPassWarning)
            login_text = getpass("Approved DEMO account login (local input): ")
            api_key = getpass("Local DEMO bridge key (local input): ")
    except (GetPassWarning, EOFError, KeyboardInterrupt, OSError):
        report = _report("BLOCKED", "LOCAL_INPUT_UNAVAILABLE")
    else:
        login = 0
        if login_text.isascii() and login_text.isdecimal() and len(login_text) <= 19:
            login = int(login_text)
        report = run_preflight(args.port, login, args.expected_server, api_key)

    print(json.dumps(report))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
