"""`python3 -m cate ...`: the one tool every agent, workflow and person uses to touch CATE's data."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import core, store
from .util import ROOT, settings

AGENT_PROTOCOL = """\
How to report back (run from the repository root):
  * Write your whole result to a file, e.g. /tmp/{task}.md
  * python3 -m cate submit --agent {agent} --task {task} --result-file /tmp/{task}.md --tokens-in N --tokens-out N
    (N = your best estimate of tokens read and written; leave the flags out if you cannot estimate)
  * If you hit your usage limit or cannot finish:
    python3 -m cate release --agent {agent} --task {task} --reason "usage limit" --rest-minutes 300
Never edit ./data by hand. Then stop: do not look for more work in this run unless told to."""

REVIEW_PROTOCOL = """\
How to report back (run from the repository root):
  * Write your review notes to a file, e.g. /tmp/{task}-review.md: what is good, what must change, and
    for each check whether it passed.
  * python3 -m cate review --agent {agent} --task {task} --score 0-100 --verdict pass|fail --notes-file /tmp/{task}-review.md
  * Pass only if every check passes and the score is at least {threshold}.
Then stop."""


def read_input(relative: str) -> str:
    """Inputs are files in the repo (main branch, e.g. workspace/inputs/...) or earlier outputs
    (outputs/T0001.md, kept on the data branch at ./data/outputs/...)."""
    candidates = [store.DATA_DIR / relative, ROOT / relative]
    for path in candidates:
        if path.is_file():
            return path.read_text(encoding="utf-8", errors="replace")
    return f"(missing input: {relative})"


def render(result: dict, agent_id: str) -> str:
    task = result["task"]
    if result["action"] == "idle":
        return f"NOTHING TO DO for {agent_id}: {result['reason']}. Stop now to save tokens."
    lines = [f"=== CATE {result['action'].upper()} for {agent_id}: {task['id']} — {task['title']} ===",
             f"kind: {task['kind']} · priority: {task['priority']} · attempt: {int(task.get('attempts', 0)) + 1}", ""]
    if result["action"] == "review":
        rv = task.get("review") or {}
        lines += ["You are REVIEWING another model's work. Be strict and specific.", "",
                  "--- The original brief ---", task["brief"], ""]
        if rv.get("checks"):
            lines += ["--- Checks it must pass ---", *[f"- {c}" for c in rv["checks"]], ""]
        lines += [f"--- The work to review (by {task['result']['by']}) ---", task["result"]["text"], ""]
        for path in task.get("inputs", []):
            lines += [f"--- Input: {path} ---", read_input(path), ""]
        lines.append(REVIEW_PROTOCOL.format(agent=agent_id, task=task["id"], threshold=rv.get("pass_score", 80)))
        return "\n".join(lines)
    lines += ["--- Brief ---", task["brief"], ""]
    checks = (task.get("review") or {}).get("checks") or []
    if checks:
        lines += ["--- It will be checked against ---", *[f"- {c}" for c in checks], ""]
    if task.get("feedback"):
        lines += ["--- A reviewer sent the last attempt back. Fix these points ---", task["feedback"], ""]
        if task.get("result"):
            lines += ["--- The last attempt ---", task["result"]["text"], ""]
    for path in task.get("inputs", []):
        lines += [f"--- Input: {path} ---", read_input(path), ""]
    lines.append(AGENT_PROTOCOL.format(agent=agent_id, task=task["id"]))
    return "\n".join(lines)


def text_from(args_text: str | None, file: str | None) -> str:
    if file:
        return Path(file).read_text(encoding="utf-8")
    return args_text or ""


def cmd_tick(a):
    result = store.transact(lambda: core.tick(a.agent), f"tick: {a.agent}")
    print(json.dumps(result, indent=1) if a.json else render(result, a.agent))


def cmd_submit(a):
    text = text_from(a.text, a.result_file)
    task = store.transact(lambda: core.submit(a.agent, a.task, text, a.tokens_in, a.tokens_out),
                          f"submit: {a.task} by {a.agent}")
    print(f"Saved. {task['id']} is now {task['status']}. You are done for this run.")


def cmd_review(a):
    notes = text_from(a.notes, a.notes_file)
    task = store.transact(lambda: core.review(a.agent, a.task, a.score, a.verdict, notes, a.tokens_in, a.tokens_out),
                          f"review: {a.task} by {a.agent}")
    print(f"Saved. {task['id']} is now {task['status']}.")


def cmd_release(a):
    store.transact(lambda: core.release(a.agent, a.task, a.reason, a.rest_minutes), f"release: {a.agent}")
    print("Handed back. Another agent will pick it up.")


def cmd_supervise(a):
    notes = store.transact(lambda: core.supervise(a.by), "supervise")
    print("\n".join(notes) if notes else "All good: nothing stuck.")


def cmd_task_add(a):
    brief = text_from(a.brief, a.brief_file)
    task = store.transact(lambda: core.add_task(
        a.by, a.title, brief, a.kind, a.prefer, a.priority, a.after, a.input, a.review, a.pass_score,
        a.check, a.parent), f"task: {a.title[:50]}")
    print(f"Added {task['id']}: {task['title']}")


def cmd_task_import(a):
    """Add a whole pipeline from a JSON file. `after` may name earlier entries by their "key"."""
    spec = json.loads(Path(a.file).read_text(encoding="utf-8"))

    def change():
        keys: dict[str, str] = {}
        added = []
        for item in spec["tasks"]:
            after = [keys.get(x, x) for x in item.get("after", [])]
            inputs = list(item.get("inputs", []))
            for key, ident in keys.items():  # "outputs/{find-job}.md" -> "outputs/T0001.md"
                inputs = [path.replace("{" + key + "}", ident) for path in inputs]
            task = core.add_task(a.by, item["title"], item["brief"], item.get("kind", "other"),
                                 item.get("prefer", "any"), item.get("priority", 3), after, inputs,
                                 item.get("review", "none"), item.get("pass_score"), item.get("checks", []))
            keys[item.get("key", task["id"])] = task["id"]
            added.append(f"{task['id']}: {task['title']}")
        return added
    for line in store.transact(change, f"import: {Path(a.file).name}"):
        print("Added", line)


def cmd_task_list(a):
    store.sync() if store.git_enabled() else None
    for t in store.load("tasks")["tasks"]:
        if a.all or t["status"] in core.OPEN or t["status"] == "blocked":
            who = t.get("claimed_by") or t.get("reviewer") or ""
            print(f"{t['id']}  {t['status']:<9} {t['kind']:<8} {t.get('prefer','any'):<10} {who:<10} {t['title']}")


def cmd_task_show(a):
    store.sync() if store.git_enabled() else None
    task = store.find(store.load("tasks")["tasks"], a.task)
    print(json.dumps(task, indent=1, ensure_ascii=False) if task else f"No task {a.task}")


def cmd_task_cancel(a):
    def change():
        tasks = store.load("tasks")
        task = store.find(tasks["tasks"], a.task)
        if not task:
            raise core.Refused(f"No task {a.task}")
        task.update(status="cancelled", claimed_by=None, reviewer=None)
        core.history(task, a.by, "cancelled", a.reason or "")
        store.save("tasks", tasks)
        store.journal(a.by, "update", f"Cancelled {a.task}", a.reason or "", a.task)
    store.transact(change, f"cancel: {a.task}")
    print(f"Cancelled {a.task}")


def cmd_agent_add(a):
    agent = store.transact(lambda: core.add_agent(a.by, a.id, a.provider, a.runner, a.label, a.account, a.model,
                                                  a.skills, a.weekly_budget), f"agent: {a.id}")
    print(f"Added agent {agent['id']}. Its scheduled-task prompt:\n")
    print(agent_prompt(agent["id"]))


def agent_prompt(agent_id: str) -> str:
    template = (ROOT / "config" / "prompts" / "agent_tick.md").read_text(encoding="utf-8")
    return template.replace("{{agent}}", agent_id).replace("{{repo}}", settings().get("repo", "OWNER/CATE"))


def cmd_agent_prompt(a):
    print(agent_prompt(a.id))


def cmd_agent_list(a):
    store.sync() if store.git_enabled() else None
    ledger = store.load("ledger")
    for g in store.load("agents")["agents"]:
        ok, why = core.availability(g, ledger)
        used = core.tokens_used(ledger, g["id"])
        budget = g.get("weekly_budget_tokens") or 0
        print(f"{g['id']:<12} {g['provider']:<10} {g['runner']:<22} {'ready' if ok else why:<30} "
              f"{used:,}/{budget:,} tokens this week · last seen {g.get('last_seen') or 'never'}")


def cmd_agent_set(a):
    def change():
        agents = store.load("agents")
        agent = store.find(agents["agents"], a.id)
        if not agent:
            raise core.Refused(f"No agent {a.id}")
        if a.status:
            agent["status"] = a.status
            if a.status == "active":
                agent["limited_until"] = None
        if a.weekly_budget is not None:
            agent["weekly_budget_tokens"] = a.weekly_budget
        if a.skills:
            agent["skills"] = a.skills
        store.save("agents", agents)
        store.journal(a.by, "update", f"Changed agent {a.id}")
    store.transact(change, f"agent set: {a.id}")
    print(f"Updated {a.id}")


def cmd_status(a):
    store.sync() if store.git_enabled() else None
    tasks = store.load("tasks")["tasks"]
    counts: dict[str, int] = {}
    for t in tasks:
        counts[t["status"]] = counts.get(t["status"], 0) + 1
    print("Tasks:", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "none")
    cmd_agent_list(a)


def cmd_log(a):
    store.sync() if store.git_enabled() else None
    for e in store.load("journal")["entries"][-a.n:]:
        print(f"{e['at']}  {e['by']:<12} {e['kind']:<9} {e['title']}" + (f" — {e['detail']}" if e.get("detail") else ""))


def build() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="cate", description="CATE: Consume All Tokens Effectively")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("tick", help="an agent's scheduled visit: get the next job")
    s.add_argument("--agent", required=True)
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_tick)

    s = sub.add_parser("submit", help="hand in a finished task")
    s.add_argument("--agent", required=True)
    s.add_argument("--task", required=True)
    s.add_argument("--result-file")
    s.add_argument("--text")
    s.add_argument("--tokens-in", type=int)
    s.add_argument("--tokens-out", type=int)
    s.set_defaults(func=cmd_submit)

    s = sub.add_parser("review", help="hand in a review")
    s.add_argument("--agent", required=True)
    s.add_argument("--task", required=True)
    s.add_argument("--score", type=int, required=True)
    s.add_argument("--verdict", choices=["pass", "fail"], required=True)
    s.add_argument("--notes-file")
    s.add_argument("--notes")
    s.add_argument("--tokens-in", type=int)
    s.add_argument("--tokens-out", type=int)
    s.set_defaults(func=cmd_review)

    s = sub.add_parser("release", help="give work back (usage limit, stuck)")
    s.add_argument("--agent", required=True)
    s.add_argument("--task")
    s.add_argument("--reason", required=True)
    s.add_argument("--rest-minutes", type=int)
    s.set_defaults(func=cmd_release)

    s = sub.add_parser("supervise", help="fix stuck work (safe any time)")
    s.add_argument("--by", default="supervisor")
    s.set_defaults(func=cmd_supervise)

    s = sub.add_parser("status")
    s.set_defaults(func=cmd_status)

    s = sub.add_parser("log")
    s.add_argument("-n", type=int, default=30)
    s.set_defaults(func=cmd_log)

    task = sub.add_parser("task").add_subparsers(dest="sub", required=True)
    s = task.add_parser("add")
    s.add_argument("--by", default="owner")
    s.add_argument("--title", required=True)
    s.add_argument("--brief")
    s.add_argument("--brief-file")
    s.add_argument("--kind", default="other", choices=core.KINDS)
    s.add_argument("--prefer", default="any")
    s.add_argument("--priority", type=int, default=3)
    s.add_argument("--after", nargs="*", default=[])
    s.add_argument("--input", nargs="*", default=[])
    s.add_argument("--review", default="none", choices=["none", "cross", "any"])
    s.add_argument("--pass-score", type=int)
    s.add_argument("--check", nargs="*", default=[])
    s.add_argument("--parent")
    s.set_defaults(func=cmd_task_add)
    s = task.add_parser("import")
    s.add_argument("file")
    s.add_argument("--by", default="owner")
    s.set_defaults(func=cmd_task_import)
    s = task.add_parser("list")
    s.add_argument("--all", action="store_true")
    s.set_defaults(func=cmd_task_list)
    s = task.add_parser("show")
    s.add_argument("task")
    s.set_defaults(func=cmd_task_show)
    s = task.add_parser("cancel")
    s.add_argument("task")
    s.add_argument("--reason")
    s.add_argument("--by", default="owner")
    s.set_defaults(func=cmd_task_cancel)

    agent = sub.add_parser("agent").add_subparsers(dest="sub", required=True)
    s = agent.add_parser("add")
    s.add_argument("--by", default="owner")
    s.add_argument("--id", required=True)
    s.add_argument("--provider", required=True, choices=core.PROVIDERS)
    s.add_argument("--runner", required=True, choices=core.RUNNERS)
    s.add_argument("--label", default="")
    s.add_argument("--account", default="")
    s.add_argument("--model", default="")
    s.add_argument("--skills", nargs="*", default=["any"])
    s.add_argument("--weekly-budget", type=int, default=0)
    s.set_defaults(func=cmd_agent_add)
    s = agent.add_parser("list")
    s.set_defaults(func=cmd_agent_list)
    s = agent.add_parser("prompt")
    s.add_argument("id")
    s.set_defaults(func=cmd_agent_prompt)
    s = agent.add_parser("set")
    s.add_argument("id")
    s.add_argument("--by", default="owner")
    s.add_argument("--status", choices=["active", "paused"])
    s.add_argument("--weekly-budget", type=int)
    s.add_argument("--skills", nargs="*")
    s.set_defaults(func=cmd_agent_set)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build().parse_args(argv)
    try:
        args.func(args)
    except core.Refused as refusal:
        print(f"Refused: {refusal}", file=sys.stderr)
        return 2
    except (store.StoreBusy, store.StoreOffline, store.PushConflict, store.StoreCorrupt) as problem:
        print(f"Store problem: {problem}", file=sys.stderr)
        return 3
    return 0
