import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import timedelta
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="cate-test-")
os.environ["CATE_DATA_DIR"] = TMP
os.environ["CATE_NO_GIT"] = "1"

from cate import core, store  # noqa: E402
from cate.cli import main  # noqa: E402
from cate.util import ROOT, now  # noqa: E402


def run(*argv):
    out = io.StringIO()
    with redirect_stdout(out):
        code = main(list(argv))
    return code, out.getvalue()


def backdate(task_id, field, minutes):
    tasks = store.load("tasks")
    task = store.find(tasks["tasks"], task_id)
    task[field] = (now() - timedelta(minutes=minutes)).replace(microsecond=0).isoformat()
    store.save("tasks", tasks)


class Pipeline(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(TMP, ignore_errors=True)
        Path(TMP).mkdir()
        for ident, provider, runner in (("claude-1", "anthropic", "claude-code-scheduled"),
                                        ("claude-2", "anthropic", "claude-code-scheduled"),
                                        ("gpt-1", "openai", "codex-automation")):
            self.assertEqual(run("agent", "add", "--id", ident, "--provider", provider, "--runner", runner)[0], 0)

    def test_resume_pipeline_end_to_end(self):
        code, out = run("task", "import", str(ROOT / "examples" / "resume_tailor.json"))
        self.assertEqual(code, 0, out)
        tasks = store.load("tasks")["tasks"]
        self.assertEqual(tasks[1]["after"], ["T0001"])
        self.assertIn("outputs/T0001.md", tasks[1]["inputs"])

        # Claude visits first: the research task prefers openai and the tailor task waits on it.
        self.assertIn("NOTHING TO DO", run("tick", "--agent", "claude-1")[1])
        # GPT takes the research task, sees the resume in the brief.
        out = run("tick", "--agent", "gpt-1")[1]
        self.assertIn("WORK for gpt-1: T0001", out)
        self.assertIn("Shlok Agrawal", out)
        self.assertEqual(run("submit", "--agent", "gpt-1", "--task", "T0001", "--text", "JD: Founder's Office at X")[0], 0)
        self.assertEqual(store.find(store.load("tasks")["tasks"], "T0001")["status"], "done")
        self.assertTrue((Path(TMP) / "outputs" / "T0001.md").exists())

        # Claude now gets the tailoring task with the JD inlined.
        out = run("tick", "--agent", "claude-1")[1]
        self.assertIn("WORK for claude-1: T0002", out)
        self.assertIn("Founder's Office at X", out)
        run("submit", "--agent", "claude-1", "--task", "T0002", "--text", "Tailored resume v1",
            "--tokens-in", "9000", "--tokens-out", "1500")
        self.assertEqual(store.find(store.load("tasks")["tasks"], "T0002")["status"], "review")

        # Cross review: the other Claude account may not review yet, GPT may.
        self.assertIn("NOTHING TO DO", run("tick", "--agent", "claude-2")[1])
        out = run("tick", "--agent", "gpt-1")[1]
        self.assertIn("REVIEW for gpt-1: T0002", out)
        run("review", "--agent", "gpt-1", "--task", "T0002", "--score", "62", "--verdict", "fail",
            "--notes", "Missing S&OP keywords")
        task = store.find(store.load("tasks")["tasks"], "T0002")
        self.assertEqual(task["status"], "queued")
        self.assertEqual(task["attempts"], 1)

        # Back to Claude with the feedback; second attempt passes.
        out = run("tick", "--agent", "claude-1")[1]
        self.assertIn("Missing S&OP keywords", out)
        run("submit", "--agent", "claude-1", "--task", "T0002", "--text", "Tailored resume v2")
        run("tick", "--agent", "gpt-1")
        run("review", "--agent", "gpt-1", "--task", "T0002", "--score", "88", "--verdict", "pass", "--notes", "Good")
        self.assertEqual(store.find(store.load("tasks")["tasks"], "T0002")["status"], "done")

        ledger = store.load("ledger")
        self.assertEqual(core.tokens_used(ledger, "claude-1") >= 10500, True)

    def test_preference_falls_back_after_wait(self):
        run("task", "add", "--title", "GPT job", "--brief", "x", "--prefer", "openai")
        self.assertIn("NOTHING TO DO", run("tick", "--agent", "claude-1")[1])
        backdate("T0001", "queued_at", 120)
        self.assertIn("WORK for claude-1: T0001", run("tick", "--agent", "claude-1")[1])

    def test_silent_agent_loses_task(self):
        run("task", "add", "--title", "job", "--brief", "x")
        run("tick", "--agent", "claude-1")
        backdate("T0001", "claimed_at", 200)
        out = run("tick", "--agent", "gpt-1")[1]
        self.assertIn("WORK for gpt-1: T0001", out)
        task = store.find(store.load("tasks")["tasks"], "T0001")
        self.assertIn("claude-1", task["exclude"])

    def test_usage_limit_release_and_rest(self):
        run("task", "add", "--title", "job", "--brief", "x")
        run("tick", "--agent", "claude-1")
        run("release", "--agent", "claude-1", "--task", "T0001", "--reason", "usage limit", "--rest-minutes", "300")
        self.assertIn("usage limit", run("tick", "--agent", "claude-1")[1])
        self.assertIn("WORK for claude-2: T0001", run("tick", "--agent", "claude-2")[1])

    def test_budget_stops_agent(self):
        run("agent", "set", "claude-1", "--weekly-budget", "1000")
        run("task", "add", "--title", "a", "--brief", "x")
        run("tick", "--agent", "claude-1")
        run("submit", "--agent", "claude-1", "--task", "T0001", "--text", "y", "--tokens-in", "900", "--tokens-out", "200")
        run("task", "add", "--title", "b", "--brief", "x")
        self.assertIn("budget", run("tick", "--agent", "claude-1")[1])

    def test_wrong_agent_cannot_submit(self):
        run("task", "add", "--title", "a", "--brief", "x")
        run("tick", "--agent", "claude-1")
        code, _ = run("submit", "--agent", "gpt-1", "--task", "T0001", "--text", "y")
        self.assertEqual(code, 2)

    def test_prompt_names_agent(self):
        out = run("agent", "prompt", "gpt-1")[1]
        self.assertIn('CATE agent "gpt-1"', out)
        self.assertIn("python3 -m cate tick --agent gpt-1", out)


if __name__ == "__main__":
    unittest.main()


class Dispatch(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(TMP, ignore_errors=True)
        Path(TMP).mkdir()
        run("agent", "add", "--id", "claude-1", "--provider", "anthropic", "--runner", "claude-actions")
        run("agent", "add", "--id", "gpt-1", "--provider", "openai", "--runner", "codex-actions")
        run("agent", "add", "--id", "free-gh", "--provider", "other", "--runner", "api", "--preset", "github-models",
            "--secret", "GITHUB_TOKEN", "--skills", "write", "review")

    def plan(self):
        return core.plan_dispatch(store.load("agents")["agents"], store.load("tasks")["tasks"], store.load("ledger"))

    def test_no_work_no_runs(self):
        self.assertEqual(self.plan(), [])

    def test_wakes_preferred_agent_only(self):
        run("task", "add", "--title", "a", "--brief", "x", "--kind", "research", "--prefer", "openai")
        plan = self.plan()
        self.assertEqual([p["agent"] for p in plan], ["gpt-1"])
        self.assertEqual(plan[0]["secret"], "CODEX_AUTH_GPT_1")

    def test_limits_steer_work_away(self):
        agents = store.load("agents")
        store.find(agents["agents"], "gpt-1")["limits"] = {
            "five_hour": {"used_pct": 95, "resets_at": (now() + timedelta(hours=2)).isoformat()}}
        store.save("agents", agents)
        run("task", "add", "--title", "a", "--brief", "x", "--kind", "research", "--prefer", "openai")
        backdate("T0001", "queued_at", 120)
        self.assertEqual([p["agent"] for p in self.plan()], ["claude-1"])

    def test_review_goes_to_other_provider(self):
        run("task", "add", "--title", "a", "--brief", "x", "--kind", "write", "--prefer", "anthropic", "--review", "cross")
        run("tick", "--agent", "claude-1")
        run("submit", "--agent", "claude-1", "--task", "T0001", "--text", "draft")
        agents = {p["agent"] for p in self.plan()}
        self.assertNotIn("claude-1", agents)
        self.assertTrue(agents & {"gpt-1", "free-gh"})

    def test_api_agent_round_trip(self):
        from cate import api_agent
        run("task", "add", "--title", "a", "--brief", "write a haiku", "--kind", "write", "--prefer", "agent:free-gh")
        os.environ["CATE_API_KEY"] = "test"
        original = api_agent.chat
        api_agent.chat = lambda base, key, model, messages: ("an old silent pond", 50, 7)
        try:
            self.assertIn("submitted T0001", api_agent.run("free-gh"))
        finally:
            api_agent.chat = original
        task = store.find(store.load("tasks")["tasks"], "T0001")
        self.assertEqual(task["status"], "done")
        self.assertEqual(core.tokens_used(store.load("ledger"), "free-gh"), 57)


class Parse(unittest.TestCase):
    def write(self, lines):
        path = Path(TMP) / "run.jsonl"
        Path(TMP).mkdir(exist_ok=True)
        path.write_text("\n".join(json.dumps(x) for x in lines))
        return path

    def test_claude_stream(self):
        from cate import runs
        info = runs.parse(self.write([
            {"type": "system", "subtype": "init"},
            {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed", "rateLimitType": "five_hour",
                                                             "utilization": 0.42, "resetsAt": 1795660000}},
            {"type": "rate_limit_event", "rate_limit_info": {"unifiedWindows": {"seven_day": {"utilization": 0.18, "resetsAt": 1796000000}}}},
            {"type": "result", "usage": {"input_tokens": 10, "cache_creation_input_tokens": 2000,
                                         "cache_read_input_tokens": 30000, "output_tokens": 400}, "total_cost_usd": 0.2},
        ]))
        self.assertEqual(info["limits"]["five_hour"]["used_pct"], 42.0)
        self.assertEqual(info["limits"]["seven_day"]["used_pct"], 18.0)
        self.assertEqual((info["tokens_in"], info["cached"], info["tokens_out"]), (2010, 30000, 400))

    def test_codex_stream(self):
        from cate import runs
        info = runs.parse(self.write([
            {"type": "thread.started"},
            {"type": "event_msg", "payload": {"type": "token_count", "rate_limits": {
                "primary": {"used_percent": 12.5, "window_minutes": 300, "resets_in_seconds": 3600},
                "secondary": {"used_percent": 30, "window_minutes": 10080, "resets_in_seconds": 86400}}}},
            {"type": "turn.completed", "usage": {"input_tokens": 9000, "cached_input_tokens": 6000, "output_tokens": 800}},
        ]))
        self.assertEqual(info["limits"]["five_hour"]["used_pct"], 12.5)
        self.assertEqual(info["limits"]["seven_day"]["used_pct"], 30.0)
        self.assertEqual((info["tokens_in"], info["cached"], info["tokens_out"]), (3000, 6000, 800))
