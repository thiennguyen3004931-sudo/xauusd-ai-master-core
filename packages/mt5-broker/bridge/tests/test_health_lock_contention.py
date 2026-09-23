import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

from mt5_bridge.config import Settings
from mt5_bridge.guarded_gateway import GuardedMt5Gateway
from mt5_bridge.ledger import IdempotencyLedger
from mt5_bridge.mt5_gateway import Mt5Gateway


class CountingRealMt5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_CONTEST = 1

    def __init__(self):
        self.terminal_info_calls = 0
        self.account_info_calls = 0

    def initialize(self, **_):
        return True

    def shutdown(self):
        return None

    def last_error(self):
        return (0, "ok")

    def version(self):
        return (500, 5735, "test")

    def terminal_info(self):
        self.terminal_info_calls += 1
        return SimpleNamespace(trade_allowed=True)

    def account_info(self):
        self.account_info_calls += 1
        return SimpleNamespace(
            login=900001,
            trade_mode=2,
            trade_allowed=True,
            trade_expert=True,
            server="Broker-Live",
            balance=10000.0,
            equity=10000.0,
            margin=0.0,
            margin_free=10000.0,
            profit=0.0,
            leverage=500,
            currency="USD",
        )


def settings(ledger_path: Path, *, live: bool = False) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        api_key="0123456789abcdef",
        trading_enabled=True,
        allow_real_account=live,
        allowed_logins=frozenset({900001}),
        terminal_path=r"C:\\MT5-LIVE\\terminal64.exe" if live else None,
        login=900001 if live else None,
        password=None,
        server="Broker-Live" if live else None,
        portable=False,
        initialize_timeout_ms=60000,
        fail_startup_if_disconnected=True,
        symbol_map={"XAUUSD": "XAUUSD.G"},
        max_spread_points={"XAUUSD": 65},
        magic_number=270715,
        deviation_points=50,
        ledger_path=ledger_path,
        log_level="INFO",
        account_mode="LIVE" if live else "DEMO",
        live_arm_state_path=ledger_path.parent / "live-arm.json",
        live_compatibility_enabled=True,
    )


class HealthLockContentionTests(unittest.TestCase):
    def test_guarded_live_health_probes_terminal_and_account_only_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ledger_path = root / "ledger.sqlite3"
            mt5 = CountingRealMt5()
            gateway = GuardedMt5Gateway(
                settings(ledger_path, live=True),
                IdempotencyLedger(ledger_path),
                mt5,
            )
            self.assertTrue(gateway.start())

            health = gateway.health(reconnect=False)

            self.assertTrue(health["connected"])
            self.assertEqual(
                mt5.terminal_info_calls,
                1,
                "LIVE /health must not repeat terminal_info after the base health probe.",
            )
            self.assertEqual(
                mt5.account_info_calls,
                1,
                "LIVE /health must not repeat account_info after the base health probe.",
            )
            gateway.stop()

    def test_health_uses_recent_snapshot_instead_of_waiting_behind_busy_gateway_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ledger_path = root / "ledger.sqlite3"
            mt5 = CountingRealMt5()
            gateway = Mt5Gateway(
                settings(ledger_path, live=False),
                IdempotencyLedger(ledger_path),
                mt5,
            )
            self.assertTrue(gateway.start())

            warm = gateway.health(reconnect=False)
            self.assertTrue(warm["connected"])

            gateway._lock.acquire()
            result = {}
            error = []

            def call_health():
                try:
                    result.update(gateway.health(reconnect=False))
                except Exception as exc:  # pragma: no cover - evidence only
                    error.append(exc)

            worker = threading.Thread(target=call_health, daemon=True)
            try:
                worker.start()
                worker.join(timeout=0.75)
                self.assertFalse(
                    worker.is_alive(),
                    "RED_TARGET: /health must not wait behind a busy MT5 gateway lock until the client timeout.",
                )
            finally:
                gateway._lock.release()
                worker.join(timeout=1.0)

            self.assertFalse(error)
            self.assertTrue(result["connected"])
            self.assertTrue(result["gatewayBusy"])
            self.assertEqual(result["healthSource"], "RECENT_CACHE")
            gateway.stop()


if __name__ == "__main__":
    unittest.main()
