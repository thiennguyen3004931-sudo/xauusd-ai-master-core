import contextlib
import io
import json
import time
import unittest
from getpass import GetPassWarning
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from unittest.mock import patch

from customer_demo_preflight import main, run_preflight


LOGIN = 77123456
SERVER = "Synthetic-Broker-Demo"
KEY = "synthetic-isolated-demo-key"
SESSION = "synthetic-bridge-session"
HEALTH = "/health?reconnect=false"
POSITIONS = "/v1/positions?reconnect=false"
ORDERS = "/v1/orders?reconnect=false"


def health(**overrides):
    return {
        "status": "ok",
        "connected": True,
        "brokerConnected": True,
        "healthSource": "LIVE_PROBE",
        "gatewayBusy": False,
        "timestamp": time.time_ns() // 1_000_000,
        "configuredAccountMode": "DEMO",
        "accountMode": "demo",
        "accountLogin": LOGIN,
        "server": SERVER,
        "reconnecting": False,
        "tradingEnabled": False,
        "terminalTradeAllowed": False,
        "liveExecutionArmed": False,
        "liveArmRequired": False,
        "bridgeSessionId": SESSION,
        "reconnectCount": 0,
        **overrides,
    }


class ScriptedBridgeHandler(BaseHTTPRequestHandler):
    def _reply(self):
        self.server.calls.append((self.command, self.path, self.headers.get("X-MT5-API-Key")))
        status, payload = self.server.responses.pop(0) if self.server.responses else (500, {})
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        if status == 302:
            self.send_header("Location", "/redirect-target")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = _reply
    do_POST = _reply
    do_PATCH = _reply
    do_DELETE = _reply

    def log_message(self, *_):
        pass


@contextlib.contextmanager
def scripted_bridge(*responses):
    with HTTPServer(("127.0.0.1", 0), ScriptedBridgeHandler) as bridge:
        bridge.responses = list(responses)
        bridge.calls = []
        worker = Thread(target=bridge.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        worker.start()
        try:
            yield bridge
        finally:
            bridge.shutdown()
            worker.join(timeout=5)


class CustomerDemoPreflightTests(unittest.TestCase):
    def observe(self, *responses):
        with scripted_bridge(*responses) as bridge:
            report = run_preflight(bridge.server_port, LOGIN, SERVER, KEY)
        return report, bridge.calls

    def assert_blocked(self, report, reason):
        self.assertEqual(report["status"], "BLOCKED")
        self.assertEqual(report["reasonCode"], reason)
        self.assertIs(report["brokerExecutionAllowed"], False)

    def test_cli_observes_a_bound_flat_demo_account_using_only_no_reconnect_gets(self):
        output = io.StringIO()
        with scripted_bridge((200, health()), (200, []), (200, []), (200, health())) as bridge:
            args = ["preflight", "--confirm-isolated-demo", "--port", str(bridge.server_port), "--expected-server", SERVER]
            with (
                patch("sys.argv", args),
                patch("customer_demo_preflight.getpass", side_effect=[str(LOGIN), KEY]),
                contextlib.redirect_stdout(output),
            ):
                self.assertEqual(main(), 0)
        self.assertEqual(bridge.calls, [
            ("GET", HEALTH, KEY), ("GET", POSITIONS, KEY), ("GET", ORDERS, KEY), ("GET", HEALTH, KEY),
        ])
        report = json.loads(output.getvalue())
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["reasonCode"], "DEMO_BINDING_AND_FLAT")
        self.assertEqual(report["openPositions"], 0)
        self.assertEqual(report["activeOrders"], 0)
        self.assertIs(report["brokerExecutionAllowed"], False)
        for value in (KEY, str(LOGIN), SERVER, SESSION):
            self.assertNotIn(value, output.getvalue())

    def test_live_contest_wrong_configuration_and_wrong_binding_stop_after_health(self):
        for fields, reason in (
            ({"accountMode": "real"}, "DEMO_MODE_REQUIRED"),
            ({"accountMode": "contest"}, "DEMO_MODE_REQUIRED"),
            ({"configuredAccountMode": "LIVE"}, "DEMO_MODE_REQUIRED"),
            ({"accountLogin": LOGIN + 1}, "DEMO_BINDING_MISMATCH"),
            ({"accountLogin": str(LOGIN)}, "DEMO_BINDING_MISMATCH"),
            ({"server": SERVER.lower()}, "DEMO_BINDING_MISMATCH"),
        ):
            with self.subTest(fields=fields):
                report, calls = self.observe((200, health(**fields)))
                self.assert_blocked(report, reason)
                self.assertEqual(calls, [("GET", HEALTH, KEY)])

    def test_cached_busy_stale_or_disconnected_health_blocks_exposure_reads(self):
        for fields, reason in (
            ({"healthSource": "RECENT_CACHE"}, "FRESH_HEALTH_REQUIRED"),
            ({"gatewayBusy": True}, "FRESH_HEALTH_REQUIRED"),
            ({"timestamp": time.time_ns() // 1_000_000 - 60_000}, "FRESH_HEALTH_REQUIRED"),
            ({"connected": False}, "MT5_TERMINAL_UNAVAILABLE"),
            ({"brokerConnected": False}, "BROKER_CONNECTION_REQUIRED"),
            ({"brokerConnected": None}, "BROKER_CONNECTION_REQUIRED"),
        ):
            with self.subTest(fields=fields):
                report, calls = self.observe((200, health(**fields)))
                self.assert_blocked(report, reason)
                self.assertEqual(calls, [("GET", HEALTH, KEY)])

    def test_execution_flags_must_be_explicitly_disabled(self):
        for field in ("tradingEnabled", "terminalTradeAllowed", "liveExecutionArmed", "liveArmRequired"):
            with self.subTest(field=field):
                report, calls = self.observe((200, health(**{field: True})))
                self.assert_blocked(report, "TRADING_DISABLED_REQUIRED")
                self.assertEqual(calls, [("GET", HEALTH, KEY)])

    def test_orders_and_positions_in_other_symbols_still_block_a_flat_baseline(self):
        position = {"symbol": "EURUSD", "ticket": "synthetic-position"}
        order = {"symbol": "USDJPY", "ticket": "synthetic-order"}
        for positions, orders in (([position], []), ([], [order])):
            with self.subTest(positions=len(positions), orders=len(orders)):
                report, _ = self.observe((200, health()), (200, positions), (200, orders), (200, health()))
                self.assert_blocked(report, "DEMO_EXPOSURE_PRESENT")
                self.assertEqual(report["openPositions"], len(positions))
                self.assertEqual(report["activeOrders"], len(orders))
                self.assertNotIn("synthetic-position", json.dumps(report))
                self.assertNotIn("synthetic-order", json.dumps(report))

    def test_reconnect_or_changed_bridge_session_blocks_the_sample(self):
        for fields in ({"bridgeSessionId": "another-session"}, {"reconnectCount": 1}):
            with self.subTest(fields=fields):
                report, _ = self.observe((200, health()), (200, []), (200, []), (200, health(**fields)))
                self.assert_blocked(report, "BRIDGE_SESSION_CHANGED")
                self.assertNotIn("openPositions", report)

    def test_second_health_must_still_match_approved_account(self):
        report, _ = self.observe((200, health()), (200, []), (200, []), (200, health(accountLogin=LOGIN + 1)))
        self.assert_blocked(report, "DEMO_BINDING_MISMATCH")
        self.assertNotIn("activeOrders", report)

    def test_redirect_is_not_followed_and_response_details_are_not_emitted(self):
        report, calls = self.observe((302, {"secret": KEY}), (200, health()))
        self.assert_blocked(report, "BRIDGE_REDIRECT_REJECTED")
        self.assertEqual(calls, [("GET", HEALTH, KEY)])
        self.assertNotIn(KEY, json.dumps(report))

    def test_unavailable_and_invalid_exposure_reads_block(self):
        for status, payload, reason in (
            (401, {"message": KEY}, "BRIDGE_REQUEST_REJECTED"),
            (200, b"{broken-json", "BRIDGE_RESPONSE_INVALID"),
            (200, {"positions": []}, "BRIDGE_RESPONSE_INVALID"),
        ):
            with self.subTest(status=status, reason=reason):
                report, _ = self.observe((200, health()), (status, payload), (200, []), (200, health()))
                self.assert_blocked(report, reason)
                self.assertNotIn(KEY, json.dumps(report))

    def test_cli_requires_explicit_isolation_before_local_input(self):
        with (
            patch("sys.argv", ["preflight", "--port", "8765", "--expected-server", SERVER]),
            patch("customer_demo_preflight.getpass") as secret_input,
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as raised,
        ):
            main()
        self.assertEqual(raised.exception.code, 2)
        secret_input.assert_not_called()

    def test_cli_blocks_if_private_console_input_is_unavailable(self):
        output = io.StringIO()
        with (
            patch("sys.argv", ["preflight", "--confirm-isolated-demo", "--port", "8765", "--expected-server", SERVER]),
            patch("customer_demo_preflight.getpass", side_effect=GetPassWarning),
            patch("customer_demo_preflight._bridge_get") as bridge_get,
            contextlib.redirect_stdout(output),
        ):
            self.assertEqual(main(), 1)
        bridge_get.assert_not_called()
        self.assert_blocked(json.loads(output.getvalue()), "LOCAL_INPUT_UNAVAILABLE")
