import contextlib
import io
import json
import unittest
from unittest.mock import patch

from scripts.codex_control import (
    ControlError,
    _granted_permissions,
    _permissions_fit_profile,
    _route_is_valid,
    cleanup_thread_background_terminals,
    managed_thread_settings,
    project_notification,
    resolve_worker_cwd,
    run_steer,
    turn_sandbox_policy,
)


class DashboardCodexControlTests(unittest.TestCase):
    def test_live_steer_requires_the_expected_active_turn_and_emits_no_prompt(self):
        class FakeConnection:
            transport = "tailscale"

            def __init__(self):
                self.calls = []

            def request(self, method, params):
                self.calls.append((method, params))
                return {"turnId": "turn-1"}

            def close(self):
                pass

        connection = FakeConnection()
        output = io.StringIO()
        prompt = "private live steering text"
        with patch("scripts.codex_control.connect_app_server", return_value=connection):
            with contextlib.redirect_stdout(output):
                run_steer({"host": {"local": True}, "threadId": "thread-1", "turnId": "turn-1", "prompt": prompt})

        self.assertEqual(connection.calls, [("turn/steer", {
            "threadId": "thread-1",
            "expectedTurnId": "turn-1",
            "input": [{"type": "text", "text": prompt}],
        })])
        self.assertEqual(json.loads(output.getvalue()), {
            "type": "steered", "threadId": "thread-1", "turnId": "turn-1", "accepted": True, "transport": "tailscale",
        })
        self.assertNotIn(prompt, output.getvalue())

    def test_live_steer_rejects_a_response_for_a_different_turn(self):
        class FakeConnection:
            transport = "tailscale"

            def request(self, _method, _params):
                return {"turnId": "turn-2"}

            def close(self):
                pass

        with patch("scripts.codex_control.connect_app_server", return_value=FakeConnection()):
            with self.assertRaises(ControlError):
                run_steer({"host": {"local": True}, "threadId": "thread-1", "turnId": "turn-1", "prompt": "new guidance"})

    def test_cleanup_uses_only_thread_scoped_codex_terminal_ids(self):
        class FakeConnection:
            def __init__(self):
                self.calls = []
                self.list_calls = 0

            def request(self, method, params):
                self.calls.append((method, params))
                if method == "thread/backgroundTerminals/list":
                    self.list_calls += 1
                    data = [{"processId": "codex-pty-7"}] if self.list_calls == 1 else []
                    return {"data": data, "nextCursor": None}
                return {"terminated": True}

        connection = FakeConnection()
        result = cleanup_thread_background_terminals(connection, "thread-1")

        self.assertEqual(result, {"status": "cleared", "trackedTerminalCount": 1, "terminatedTerminalCount": 1})
        self.assertEqual(connection.calls[0], ("thread/backgroundTerminals/list", {"threadId": "thread-1", "limit": 100}))
        self.assertEqual(connection.calls[1], ("thread/backgroundTerminals/terminate", {"threadId": "thread-1", "processId": "codex-pty-7"}))
        self.assertNotIn("osPid", str(connection.calls))

    def test_cleanup_reports_unknown_if_thread_scoped_reconciliation_fails(self):
        class FailedConnection:
            def request(self, _method, _params):
                raise RuntimeError("private app-server response")

        self.assertEqual(cleanup_thread_background_terminals(FailedConnection(), "thread-1"), {
            "status": "unknown", "trackedTerminalCount": None, "terminatedTerminalCount": 0,
        })

    def test_profile_defaults_keep_home_sandbox_and_toggle_both_network_surfaces(self):
        home = "/home/operator"
        enabled = managed_thread_settings(home, True)
        disabled = managed_thread_settings(home, False)
        self.assertEqual(enabled["approvalPolicy"], "never")
        self.assertEqual(enabled["sandbox"], "workspace-write")
        self.assertEqual(enabled["runtimeWorkspaceRoots"], [home])
        self.assertEqual(enabled["config"]["web_search"], "live")
        self.assertTrue(enabled["config"]["sandbox_workspace_write"]["network_access"])
        self.assertEqual(managed_thread_settings(home, False, "~/project")["cwd"], "/home/operator/project")
        self.assertEqual(disabled["config"]["web_search"], "disabled")
        self.assertFalse(disabled["config"]["sandbox_workspace_write"]["network_access"])
        self.assertEqual(turn_sandbox_policy(home, False), {
            "type": "workspaceWrite",
            "writableRoots": [home],
            "networkAccess": False,
        })

    def test_fleet_routes_are_limited_to_supported_transports_and_safe_aliases(self):
        self.assertTrue(_route_is_valid({"transport": "zerotier", "target": "operator@node-a.example.test", "hostKeyAlias": "fleet-node-a"}))
        self.assertFalse(_route_is_valid({"transport": "ssh", "target": "operator@node-a.example.test", "hostKeyAlias": "fleet-node-a"}))
        self.assertFalse(_route_is_valid({"transport": "zerotier", "target": "-oProxyCommand=evil", "hostKeyAlias": "fleet-dc2"}))

    def test_worker_cwd_resolves_only_within_the_remote_user_home(self):
        self.assertEqual(resolve_worker_cwd("~/project", "/home/operator"), "/home/operator/project")
        self.assertEqual(resolve_worker_cwd("~", "/home/operator"), "/home/operator")
        with self.assertRaises(ControlError):
            resolve_worker_cwd("~/../../etc", "/home/operator")
        with self.assertRaises(ControlError):
            resolve_worker_cwd("/etc", "/home/operator")

    def test_permission_expansion_stays_inside_the_profile(self):
        home = "/home/operator"
        self.assertTrue(_permissions_fit_profile({"fileSystem": {"write": ["/home/operator/work"]}}, home, True))
        self.assertFalse(_permissions_fit_profile({"fileSystem": {"write": ["/etc"]}}, home, True))
        self.assertFalse(_permissions_fit_profile({"network": {"enabled": True}}, home, False))
        self.assertTrue(_permissions_fit_profile({"network": {"enabled": True}}, home, True))

    def test_permission_grant_returns_only_the_requested_subset_inside_profile(self):
        requested = {
            "fileSystem": {"write": ["/home/operator/work", "/etc"], "entries": [
                {"path": {"type": "path", "path": "/home/operator/cache"}, "access": "read"},
                {"path": {"type": "special", "value": "root"}, "access": "write"},
            ]},
            "network": {"enabled": True},
            "unknown": {"enabled": True},
        }
        self.assertEqual(_granted_permissions(requested, "/home/operator", False), {
            "fileSystem": {
                "write": ["/home/operator/work"],
                "entries": [{"path": {"type": "path", "path": "/home/operator/cache"}, "access": "read"}],
            },
        })

    def test_terminal_output_is_never_projected_to_dashboard_events(self):
        event = project_notification({
            "method": "item/completed",
            "params": {"item": {"type": "commandExecution", "aggregatedOutput": "private command output", "command": "secret command"}},
        })
        self.assertEqual(event, {"type": "activity", "status": "completed", "kind": "commandExecution"})
        self.assertNotIn("private command output", str(event))
        self.assertNotIn("secret command", str(event))

    def test_turn_terminal_status_and_usage_are_content_free(self):
        completed = project_notification({"method": "turn/completed", "params": {"turn": {"id": "t-1", "status": "interrupted", "error": {"message": "private details"}}}})
        usage = project_notification({"method": "thread/tokenUsage/updated", "params": {"tokenUsage": {"total": {"inputTokens": 10, "cachedInputTokens": 2, "outputTokens": 5, "reasoningOutputTokens": 1, "totalTokens": 16}}}})
        self.assertEqual(completed, {"type": "completed", "status": "interrupted", "turnId": "t-1", "failed": True})
        self.assertEqual(usage["totalTokens"], 16)
        self.assertNotIn("private details", str(completed))


if __name__ == "__main__":
    unittest.main()
