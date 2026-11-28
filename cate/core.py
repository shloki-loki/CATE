"""The CATE rules: who may take which task, what happens on submit and review, and what the supervisor fixes.

Every function that changes data is meant to run inside `store.transact`, because it may be re-run on
fresh data if another writer pushed first.
"""

from __future__ import annotations

from typing import Any

from . import store
from .util import catalog, estimate_tokens, later, minutes_since, now_iso, parse_iso, settings, week_key, day_key

PROVIDERS = ("anthropic", "openai", "google", "groq", "xai", "deepseek", "perplexity", "local", "other")
# Runners that GitHub Actions starts on demand (only when there is work), and older/manual ones.
ACTIONS_RUNNERS = ("claude-actions", "codex-actions", "api")
RUNNERS = ACTIONS_RUNNERS + ("claude-code-scheduled", "codex-automation", "chatgpt-scheduled", "manual")
KINDS = ("plan", "research", "write", "code", "review", "data", "other")
OPEN = ("queued", "claimed", "review", "reviewing")


class Refused(Exception):
    """A request that breaks a rule. The message says why, in words an agent can act on."""


def cfg(name: str, default: Any) -> Any:
    return settings().get("supervisor", {}).get(name, default)


def history(task: dict, actor: str, event: str, detail: str = "") -> None:
    task.setdefault("history", []).append({"at": now_iso(), "actor": actor, "event": event, "detail": detail})
    task["updated_at"] = now_iso()


# ---- tokens -------------------------------------------------------------------------------------

def deferred() -> bool:
    """True inside a GitHub Actions run that measures tokens exactly (charged afterwards by `cate usage`)."""
    import os
    return os.environ.get("CATE_DEFER_TOKENS") == "1"


def tokens_used(ledger: dict, agent_id: str, week: str | None = None) -> int:
    row = ledger.get("weeks", {}).get(week or week_key(), {}).get(agent_id, {})
    return int(row.get("in", 0)) + int(row.get("out", 0))


def charge(ledger: dict, agent_id: str, tokens_in: int, tokens_out: int) -> None:
    week = ledger.setdefault("weeks", {}).setdefault(week_key(), {})
    row = week.setdefault(agent_id, {"in": 0, "out": 0, "tasks": 0, "days": {}})
    row["in"] += tokens_in
    row["out"] += tokens_out
    row["tasks"] += 1
    day = row.setdefault("days", {}).setdefault(day_key(), 0)
    row["days"][day_key()] = day + tokens_in + tokens_out
    # keep twelve weeks
    for old in sorted(ledger["weeks"])[:-12]:
        del ledger["weeks"][old]


def availability(agent: dict, ledger: dict) -> tuple[bool, str]:
    """Can this agent take work right now? Returns (yes, reason when not)."""
    if agent.get("status") == "paused":
        return False, "paused on the dashboard"
    until = parse_iso(agent.get("limited_until"))
    if agent.get("status") == "limited" and until and minutes_since(agent["limited_until"]) < 0:
        return False, f"usage limit reached; resting until {agent['limited_until']}"
    # (Weekly token budgets were a guess and blocked accounts with real limit left: they are display-only now.)
    # The subscription's own limits, as last reported by the CLI after a run.
    for window, ceiling in (("five_hour", cfg("five_hour_stop_pct", 90)), ("seven_day", cfg("seven_day_stop_pct", 97))):
        info = (agent.get("limits") or {}).get(window) or {}
        used = info.get("used_pct")
        if used is not None and used >= ceiling and minutes_since(info.get("resets_at")) < 0:
            label = "5-hour" if window == "five_hour" else "weekly"
            return False, f"{label} limit {used:.0f}% used; resets {info.get('resets_at')}"
    return True, ""


# ---- models -------------------------------------------------------------------------------------

def provider_models(provider: str) -> list[dict]:
    return catalog().get("providers", {}).get(provider, {}).get("models", [])


def model_info(model_id: str) -> dict:
    for prov in catalog().get("providers", {}).values():
        for m in prov.get("models", []):
            if m["id"] == model_id:
                return m
    return {}


def enabled_models(agent: dict) -> list[str]:
    """The models this agent may use: chosen on the Models page, else every model of its provider that
    does not cost extra credits."""
    if agent.get("models"):
        return list(agent["models"])
    known = [m["id"] for m in provider_models(agent.get("provider", "")) if not m.get("paid_credits")]
    return known or ([agent["model"]] if agent.get("model") else [])


def window_used(agent: dict, window: str) -> float:
    """% used of an account-wide window, or 0 if the reading is older than its reset time."""
    w = (agent.get("limits") or {}).get(window) or {}
    if not w or (w.get("resets_at") and minutes_since(w["resets_at"]) >= 0):
        return 0.0
    return float(w.get("used_pct") or 0)


def lowest_left(agent: dict) -> float:
    return min(100 - window_used(agent, w) for w in ("five_hour", "seven_day"))


def model_exhausted(agent: dict, model: str) -> bool:
    """True if a model-specific window (e.g. Claude's seven_day_opus, a Codex per-model limit) for this model
    is (nearly) used up and has not reset yet."""
    for name, windows in ((agent.get("limits") or {}).get("models") or {}).items():
        if name.lower() not in model.lower():
            continue
        for w in windows.values():
            if float(w.get("used_pct") or 0) >= 97 and minutes_since(w.get("resets_at")) < 0:
                return True
    return False


def choose_model(agent: dict, task: dict) -> tuple[str, str]:
    """(model id, effort) for this agent doing this task. The task's own choice wins if this agent has that
    model; then the agent's per-job default; then the best-scoring enabled model for the job, picking a
    lighter one when the account is low on limits. Models whose own limit is used up are skipped."""
    allowed = [m for m in enabled_models(agent) if not model_exhausted(agent, m)] or enabled_models(agent)
    kind = task.get("kind", "other")
    wanted = task.get("model")
    if wanted and wanted in allowed:
        pick = wanted
    elif (agent.get("roles") or {}).get(kind) in allowed:
        pick = agent["roles"][kind]
    else:
        scored = [(model_info(m).get("scores", {}).get(kind, 3), -model_info(m).get("weight", 1), m) for m in allowed]
        if not scored:
            return model_id(agent.get("model")), task.get("effort") or ""
        if lowest_left(agent) < 30:  # running low: prefer the lightest model that is still good enough
            good = [x for x in scored if x[0] >= max(s for s, _, _ in scored) - 1]
            pick = max(good, key=lambda x: (x[1], x[0]))[2]
        else:
            pick = max(scored)[2]
    effort = task.get("effort") or model_info(pick).get("effort", "")
    return pick, effort


# ---- routing ------------------------------------------------------------------------------------

def landed(task: dict) -> bool:
    """Done AND, if its result is a pull request, merged (or knowingly superseded). Code that never reached main
    must not unlock the steps built on top of it."""
    if task.get("status") != "done":
        return False
    if pr_number((task.get("result") or {}).get("text", "")) is None:
        return True
    merge = task.get("merge") or {}
    return merge.get("status") == "merged" or "superseded" in str(merge.get("detail", ""))


def deps_done(task: dict, tasks: list[dict]) -> bool:
    for ident in task.get("after", []):
        parent = store.find(tasks, ident)
        if not parent or not landed(parent):
            return False
    return True


def waited(task: dict) -> float:
    return minutes_since(task.get("queued_at") or task.get("created_at"))


def preference_ok(task: dict, agent: dict, agents: list[dict] | None = None, ledger: dict | None = None) -> bool:
    """The task's preferred provider or agent gets it first; anyone suitable gets it once it has waited
    longer than `fallback_minutes`. If the chosen agent is out of limits (or paused) right now, the next
    agent of the same provider gets it at once: the automatic switch the user agreed to."""
    prefer = task.get("prefer") or "any"
    if prefer == "any":
        return True
    matches = agent["id"] == prefer[6:] if prefer.startswith("agent:") else agent.get("provider") == prefer
    if matches or waited(task) >= cfg("fallback_minutes", 90):
        return True
    if prefer.startswith("agent:") and agents is not None and ledger is not None:
        chosen = store.find(agents, prefer[6:])
        if chosen and not availability(chosen, ledger)[0] and agent.get("provider") == chosen.get("provider"):
            return not task.get("model") or task["model"] in enabled_models(agent)
    return False


def can_work(task: dict, agent: dict, tasks: list[dict], agents: list[dict] | None = None,
             ledger: dict | None = None) -> bool:
    skills = agent.get("skills") or ["any"]
    return (task.get("status") == "queued"
            and agent["id"] not in task.get("exclude", [])
            and ("any" in skills or task.get("kind") in skills or task.get("prefer") == f"agent:{agent['id']}")
            and deps_done(task, tasks)
            and preference_ok(task, agent, agents, ledger))


def worker_provider(task: dict, agents: list[dict]) -> str:
    worker = store.find(agents, (task.get("result") or {}).get("by", ""))
    return worker.get("provider", "") if worker else ""


def can_review(task: dict, agent: dict, agents: list[dict]) -> bool:
    if task.get("status") != "review":
        return False
    if agent.get("runner") == "api":
        return False  # free API models frame and clarify; reviews go to subscription agents (reliable, can read code)
    skills = agent.get("skills") or ["any"]
    if not ("any" in skills or "review" in skills):
        return False
    worker = (task.get("result") or {}).get("by")
    if agent["id"] == worker:
        return False
    if (task.get("review") or {}).get("mode") == "cross" and agent.get("provider") == worker_provider(task, agents):
        # Another provider should check it. Fall back to another account of the same provider at once if no
        # other-provider reviewer can work right now (paused, out of limit), else after the wait.
        if minutes_since(task.get("review_queued_at")) >= cfg("fallback_minutes", 90):
            return True
        worker = worker_provider(task, agents)
        others = [a for a in agents if a.get("provider") != worker and a.get("runner") != "api"
                  and a.get("status") != "paused" and a["id"] not in task.get("review_exclude", [])]
        ledger = store.load("ledger")
        return not any(availability(a, ledger)[0] for a in others)
    return True


def order(task: dict) -> tuple:
    return (int(task.get("priority", 3)), task.get("queued_at") or task.get("created_at") or "")


def limit_pct(agent: dict, window: str) -> float:
    return window_used(agent, window)


def plan_dispatch(agents: list[dict], tasks: list[dict], ledger: dict) -> list[dict]:
    """Which agents GitHub Actions should start right now: one per piece of available work, the best fit
    for each (preferred provider first, then the one with most of its limits left). No work, no runs."""
    ready = [a for a in agents if a.get("runner") in ACTIONS_RUNNERS and availability(a, ledger)[0]]
    busy = {t.get("claimed_by") for t in tasks if t.get("status") == "claimed"} | \
           {t.get("reviewer") for t in tasks if t.get("status") == "reviewing"}
    chosen: dict[str, dict] = {}

    def score(agent: dict, task: dict) -> tuple:
        prefer = task.get("prefer") or "any"
        match = agent["id"] == prefer[6:] if prefer.startswith("agent:") else agent.get("provider") == prefer
        return (0 if match else 1, limit_pct(agent, "seven_day"), limit_pct(agent, "five_hour"),
                tokens_used(ledger, agent["id"]))

    reviews = sorted((t for t in tasks if t.get("status") == "review"), key=order)
    work = sorted((t for t in tasks if t.get("status") == "queued"), key=order)
    for task in reviews + work:
        candidates = [a for a in ready if a["id"] not in chosen and a["id"] not in busy and (
            (task["status"] == "review" and can_review(task, a, agents) and a["id"] not in task.get("review_exclude", []))
            or (task["status"] == "queued" and can_work(task, a, tasks, agents, ledger)))]
        if candidates:
            best = min(candidates, key=lambda a: score(a, task))
            model, effort = choose_model(best, task)
            chosen[best["id"]] = {"agent": best["id"], "runner": best["runner"], "provider": best.get("provider"),
                                  "secret": agent_secret(best), "model": model_id(model), "effort": effort,
                                  "preset": best.get("preset") or "", "task": task["id"]}
    return list(chosen.values())


def model_id(text: str | None) -> str:
    """Only a real model id (no spaces or brackets) is passed to a CLI; descriptions like
    "Claude (Pro plan)" mean "the account's default model"."""
    import re
    return text if text and re.fullmatch(r"[A-Za-z0-9._:/-]+", text) else ""


def agent_secret(agent: dict) -> str:
    """The GitHub Actions secret that holds this agent's login or key."""
    if agent.get("secret"):
        return agent["secret"]
    tag = agent["id"].upper().replace("-", "_")
    return {"claude-actions": f"CLAUDE_TOKEN_{tag}", "codex-actions": f"CODEX_AUTH_{tag}"}.get(
        agent.get("runner", ""), f"API_KEY_{tag}")


def record_run(agent_id: str, tokens_in: int, tokens_out: int, cached: int, limits: dict) -> None:
    """After a run: charge the exact tokens the CLI reported and keep its latest limit readings."""
    ledger = store.load("ledger")
    if tokens_in or tokens_out:
        charge(ledger, agent_id, tokens_in, tokens_out)
        row = ledger["weeks"][week_key()][agent_id]
        row["cached"] = int(row.get("cached", 0)) + cached
        row["tasks"] -= 1  # charge() counts a job; a run is not a job
        store.save("ledger", ledger)
    if limits:
        agents = store.load("agents")
        agent = store.find(agents["agents"], agent_id)
        if agent:
            # A run's readings replace the old ones (keeping a window the CLI did not report this time).
            merged = {k: v for k, v in (agent.get("limits") or {}).items() if k in ("five_hour", "seven_day")}
            agent["limits"] = {**merged, **limits, "at": now_iso()}
            store.save("agents", agents)


# ---- the supervisor -----------------------------------------------------------------------------

def supervise(actor: str = "supervisor") -> list[str]:
    """Fix what is stuck. Safe to run any time, by anyone. Returns one line per change."""
    notes: list[str] = []
    agents = store.load("agents")
    tasks = store.load("tasks")
    timeout = cfg("claim_timeout_minutes", 150)
    max_attempts = cfg("max_attempts", 3)
    failed: list[tuple[dict, str]] = []

    for agent in agents["agents"]:
        if agent.get("status") == "limited" and minutes_since(agent.get("limited_until")) >= 0:
            agent["status"] = "active"
            agent["limited_until"] = None
            notes.append(f"{agent['id']} is back from its usage-limit rest")

    for task in tasks["tasks"]:
        status = task.get("status")
        if status == "claimed" and minutes_since(task.get("claimed_at")) >= timeout:
            who = task.get("claimed_by")
            task["attempts"] = int(task.get("attempts", 0)) + 1
            task.setdefault("exclude", []).append(who)
            task["claimed_by"] = None
            if task["attempts"] >= max_attempts:
                task["status"] = "failed"
                history(task, actor, "failed", f"{who} went silent; out of attempts")
                failed.append((task, f"{who} went silent"))
                notes.append(f"{task['id']} failed: {who} went silent and attempts are used up")
            else:
                task["status"] = "queued"
                task["queued_at"] = now_iso()
                history(task, actor, "requeued", f"{who} claimed it {timeout}+ minutes ago and went silent")
                notes.append(f"{task['id']} taken back from {who} (silent for {timeout}+ min), offered to others")
        elif status == "reviewing" and minutes_since(task.get("reviewing_at")) >= timeout:
            who = task.get("reviewer")
            task["status"] = "review"
            task["reviewer"] = None
            task.setdefault("review_exclude", []).append(who)
            history(task, actor, "review requeued", f"{who} went silent during review")
            notes.append(f"{task['id']} review taken back from {who}")
        elif status == "queued" and task.get("after"):
            for ident in task["after"]:
                parent = store.find(tasks["tasks"], ident)
                if parent and parent.get("status") in ("failed", "cancelled"):
                    task["status"] = "blocked"
                    history(task, actor, "blocked", f"depends on {ident}, which {parent['status']}")
                    notes.append(f"{task['id']} blocked: {ident} {parent['status']}")
                    break

    # Say why work is waiting when nobody can take it (shown on the task card, posted in the chat once).
    ledger = store.load("ledger")
    told = []
    for task in tasks["tasks"]:
        if task.get("status") not in ("queued", "review"):
            task.pop("waiting_reason", None)
            continue
        reason = explain_waiting(task, tasks["tasks"], agents["agents"], ledger)
        if reason != task.get("waiting_reason"):
            if reason:
                task["waiting_reason"] = reason
                told.append((task, reason))
            else:
                task.pop("waiting_reason", None)

    store.save("agents", agents)
    store.save("tasks", tasks)
    for task, why in failed:
        tell_chat(task, failure_message(task, why))
    for task, reason in told:
        tell_chat(task, f"⏸ {task['id']} \u201c{task.get('title', '')}\u201d is waiting: {reason}.")
        notes.append(f"{task['id']} waiting: {reason}")
    for line in notes:
        store.journal(actor, "supervise", line)
    return notes


def explain_waiting(task: dict, tasks: list[dict], agents: list[dict], ledger: dict) -> str:
    """Why nobody can take this task right now ('' if someone can, or it simply waits its turn)."""
    for ident in task.get("after", []):
        parent = store.find(tasks, ident)
        if parent and parent.get("status") == "done" and not landed(parent):
            merge = parent.get("merge") or {}
            if merge.get("status") == "blocked":
                return f"it builds on {ident}, whose pull request #{merge.get('pr')} can't be merged ({merge.get('detail')})"
            return ""  # the parent's pull request is on its way to being merged
        if not parent or parent.get("status") != "done":
            return ""  # waiting its turn behind an earlier step
    usable = [a for a in agents if a.get("runner") != "api"]
    if task.get("status") == "queued":
        fits = [a for a in usable if can_work(task, a, tasks, agents, ledger) or
                (task.get("prefer", "").startswith("agent:") and a["id"] == task["prefer"][6:])]
    else:
        fits = [a for a in usable if can_review(task, a, agents)]
    if not fits:
        return "" if task.get("status") == "queued" else "no account other than the author can review it yet"
    reasons = [f"{a['id']}: {availability(a, ledger)[1]}" for a in fits if not availability(a, ledger)[0]]
    if len(reasons) == len(fits):
        return "every account that could do it is unavailable (" + "; ".join(reasons) + ")"
    return ""


# ---- an agent's turn ----------------------------------------------------------------------------

def run_url() -> str:
    """Link to the GitHub Actions run doing this job (empty outside Actions)."""
    import os
    run, repo, server = os.environ.get("GITHUB_RUN_ID"), os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_SERVER_URL")
    return f"{server}/{repo}/actions/runs/{run}" if run and repo and server else ""


def pr_number(text: str) -> int | None:
    import re
    repo = settings().get("repo", "")
    found = re.findall(rf"github\.com/{re.escape(repo)}/pull/(\d+)", text or "", re.I)
    return int(found[0]) if found else None


def merge_candidates(tasks: list[dict]) -> list[dict]:
    """Done tasks whose result links a pull request that CATE has not merged or given up on."""
    out = []
    for t in tasks:
        pr = pr_number((t.get("result") or {}).get("text", ""))
        if t.get("status") == "done" and pr and (t.get("merge") or {}).get("status") not in ("merged", "blocked"):
            out.append({"task": t["id"], "pr": pr, "chat": t.get("chat") or ""})
    return out


def tell_chat(task: dict, text: str) -> None:
    """Post a CATE message in the project chat the task came from (if any)."""
    if not task.get("chat"):
        return
    chats = store.load("chats")
    chat = store.find(chats["chats"], task["chat"])
    if chat is None:
        return
    chat.setdefault("messages", []).append({"id": store.next_id(chat["messages"], "M"), "role": "system", "by": "cate",
                                            "text": text, "at": now_iso()})
    chat["updated_at"] = now_iso()
    store.save("chats", chats)


def failure_message(task: dict, why: str) -> str:
    """What the owner reads in the chat when a task runs out of attempts."""
    text = f"✗ {task['id']} \u201c{task.get('title', '')}\u201d stopped after {task.get('attempts', 0)} attempts: {why}."
    pr = pr_number((task.get("result") or {}).get("text", ""))
    if pr:
        repo = settings().get("repo", "")
        text += (f" Its pull request #{pr} was not merged (CATE only auto-merges work that passed review)."
                 f" Read the last review, then merge it by hand on GitHub (https://github.com/{repo}/pull/{pr})"
                 " or press Run again.")
    else:
        text += " Press Run again to retry."
    return text


def record_merge(task_id: str, pr: int, status: str, detail: str) -> None:
    tasks = store.load("tasks")
    task = store.find(tasks["tasks"], task_id)
    if not task:
        raise Refused(f"No task {task_id}")
    before = task.get("merge") or {}
    if status == "conflict":
        # Send the work back to an agent to bring the branch up to date with main; give up after two tries.
        tries = int(before.get("conflicts", 0)) + 1
        if tries <= 2:
            task["merge"] = {"pr": pr, "status": "conflict", "detail": detail[:1000], "at": now_iso(), "conflicts": tries}
            task.update(status="queued", queued_at=now_iso(), claimed_by=None, reviewer=None, exclude=[])
            task["feedback"] = (f"Your pull request #{pr} can't be merged: it conflicts with main (other work was merged "
                                f"first). Check out its branch, merge origin/main into it, resolve every conflict so both "
                                f"your change and the newer work keep working, run the tests (and the build if you touched "
                                f"web/ or game/), push to the SAME branch, and submit again with the pull request link.")
            history(task, "cate", f"pull request #{pr} conflicts with main: sent back to resolve", f"try {tries} of 2")
            store.save("tasks", tasks)
            tell_chat(task, f"Pull request #{pr} ({task['id']}) clashed with newer work on main. "
                            f"It's back in the queue for an agent to bring up to date (try {tries} of 2).")
            store.journal("cate", "update", f"PR #{pr} conflicts with main: sent back", f"try {tries} of 2", task_id)
            return
        status, detail = "blocked", "it still conflicts with main after two attempts to bring it up to date"
    task["merge"] = {"pr": pr, "status": status, "detail": detail[:1000], "at": now_iso(),
                     "conflicts": before.get("conflicts", 0)}
    history(task, "cate", f"pull request #{pr} {status}", detail[:300])
    store.save("tasks", tasks)
    # Tell the chat once per outcome; "waiting" (retry next run) is not news.
    if status != "waiting" and (before.get("status"), before.get("pr")) != (status, pr):
        tell_chat(task, f"✓ Merged pull request #{pr} after review, tests and build passed. It goes live in about a minute."
                  if status == "merged" else f"Auto-merge of pull request #{pr} stopped: {detail}. You can merge it by hand on GitHub.")
    store.journal("cate", "update", f"PR #{pr} {status}", detail[:300], task_id)


def heartbeat(agent_id: str) -> dict:
    agents = store.load("agents")
    agent = store.find(agents["agents"], agent_id)
    if not agent:
        raise Refused(f"No agent called {agent_id}. Add it on the dashboard's Agents page first.")
    agent["last_seen"] = now_iso()
    store.save("agents", agents)
    return agent


def tick(agent_id: str) -> dict:
    """One scheduled visit: heartbeat, supervise, then hand the agent its next job (or nothing).
    Returns {"action": "work"|"review"|"idle", "task": {...}, "reason": "..."}."""
    agent = heartbeat(agent_id)
    supervise(actor=agent_id)
    agents = store.load("agents")["agents"]
    tasks = store.load("tasks")
    ledger = store.load("ledger")

    own = [t for t in tasks["tasks"] if t.get("claimed_by") == agent_id and t.get("status") == "claimed"]
    if own:
        return {"action": "work", "task": own[0], "reason": "you already hold this task; finish it"}
    reviewing = [t for t in tasks["tasks"] if t.get("reviewer") == agent_id and t.get("status") == "reviewing"]
    if reviewing:
        return {"action": "review", "task": reviewing[0], "reason": "you are already reviewing this task"}

    ok, why = availability(agent, ledger)
    if not ok:
        store.journal(agent_id, "run", "Idle", why)
        return {"action": "idle", "task": None, "reason": why}

    # Finish pipelines before starting new work: reviews first.
    reviews = sorted((t for t in tasks["tasks"] if can_review(t, agent, agents)
                      and agent_id not in t.get("review_exclude", [])), key=order)
    if reviews:
        task = reviews[0]
        review_model, _ = choose_model(agent, {"kind": "review", "model": (task.get("review") or {}).get("model")})
        task.update(status="reviewing", reviewer=agent_id, reviewing_at=now_iso(), review_model=review_model,
                    review_run_url=run_url())
        history(task, agent_id, "review started")
        store.save("tasks", tasks)
        store.journal(agent_id, "claim", f"Reviewing {task['id']}: {task['title']}", ref=task["id"])
        return {"action": "review", "task": task, "reason": "review needed"}

    work = sorted((t for t in tasks["tasks"] if can_work(t, agent, tasks["tasks"], agents, ledger)), key=order)
    if not work:
        store.journal(agent_id, "run", "Idle", "nothing in the queue for this agent")
        return {"action": "idle", "task": None, "reason": "nothing in the queue for you"}
    task = work[0]
    model, effort = choose_model(agent, task)
    task.update(status="claimed", claimed_by=agent_id, claimed_at=now_iso(), run_model=model, run_effort=effort,
                run_url=run_url() or task.get("run_url", ""))
    history(task, agent_id, "claimed", model_info(model).get("label", model) if model else "")
    store.save("tasks", tasks)
    store.journal(agent_id, "claim", f"Took {task['id']}: {task['title']}", ref=task["id"])
    return {"action": "work", "task": task, "reason": "next in the queue"}


def submit(agent_id: str, task_id: str, text: str, tokens_in: int | None = None,
           tokens_out: int | None = None) -> dict:
    tasks = store.load("tasks")
    task = store.find(tasks["tasks"], task_id)
    if not task:
        raise Refused(f"No task {task_id}.")
    if task.get("status") != "claimed" or task.get("claimed_by") != agent_id:
        raise Refused(f"{task_id} is {task.get('status')} and held by {task.get('claimed_by') or 'nobody'}, "
                      f"not by {agent_id}; your result was not saved. Run `tick` again for current work.")
    if not text.strip():
        raise Refused("The result is empty.")
    t_in = tokens_in if tokens_in is not None else estimate_tokens(task.get("brief", "")) + 2000
    t_out = tokens_out if tokens_out is not None else estimate_tokens(text)
    output = f"outputs/{task_id}.md"
    store.write_text(output, text)
    task["result"] = {"by": agent_id, "at": now_iso(), "file": output, "text": text[:60000],
                      "tokens_in": t_in, "tokens_out": t_out, "model": task.get("run_model") or ""}
    task["claimed_by"] = None
    review = task.get("review") or {"mode": "none"}
    if review.get("mode", "none") == "none":
        task["status"] = "done"
        history(task, agent_id, "done", f"{t_in + t_out:,} tokens")
    else:
        task["status"] = "review"
        task["review_queued_at"] = now_iso()
        history(task, agent_id, "submitted for review", f"{t_in + t_out:,} tokens")
    store.save("tasks", tasks)
    ledger = store.load("ledger")
    charge(ledger, agent_id, 0 if deferred() else t_in, 0 if deferred() else t_out)
    store.save("ledger", ledger)
    store.journal(agent_id, "submit", f"Finished {task_id}: {task['title']}",
                  f"{t_in + t_out:,} tokens; now {task['status']}", task_id)
    return task


def review(agent_id: str, task_id: str, score: int, verdict: str, notes: str,
           tokens_in: int | None = None, tokens_out: int | None = None) -> dict:
    tasks = store.load("tasks")
    task = store.find(tasks["tasks"], task_id)
    if not task:
        raise Refused(f"No task {task_id}.")
    if task.get("status") != "reviewing" or task.get("reviewer") != agent_id:
        raise Refused(f"{task_id} is not being reviewed by {agent_id}; nothing was saved.")
    if verdict not in ("pass", "fail"):
        raise Refused("verdict must be pass or fail")
    threshold = int((task.get("review") or {}).get("pass_score") or cfg("default_pass_score", 80))
    passed = verdict == "pass" and score >= threshold
    task.setdefault("reviews", []).append({"by": agent_id, "model": task.get("review_model") or "", "at": now_iso(), "score": score,
                                           "verdict": "pass" if passed else "fail", "notes": notes[:20000]})
    task["reviewer"] = None
    if passed:
        task["status"] = "done"
        history(task, agent_id, "review passed", f"score {score} (needs {threshold})")
    else:
        task["attempts"] = int(task.get("attempts", 0)) + 1
        if task["attempts"] >= cfg("max_attempts", 3):
            task["status"] = "failed"
            history(task, agent_id, "review failed; out of attempts", f"score {score} (needs {threshold})")
        else:
            task["status"] = "queued"
            task["queued_at"] = now_iso()
            task["feedback"] = notes[:20000]
            history(task, agent_id, "review failed; sent back with feedback", f"score {score} (needs {threshold})")
    store.save("tasks", tasks)
    if task["status"] == "failed":
        tell_chat(task, failure_message(task, f"the last review scored {score} and needs {threshold}"))
    ledger = store.load("ledger")
    charge(ledger, agent_id,
           0 if deferred() else (tokens_in if tokens_in is not None else estimate_tokens(task["result"]["text"]) + 2000),
           0 if deferred() else (tokens_out if tokens_out is not None else estimate_tokens(notes)))
    store.save("ledger", ledger)
    store.journal(agent_id, "review", f"Reviewed {task_id}: {'pass' if passed else 'fail'} ({score})", ref=task_id)
    return task


def release(agent_id: str, task_id: str | None, reason: str, rest_minutes: int | None = None) -> None:
    """The agent cannot go on (usually: its subscription's usage limit). Hand the work back and rest."""
    tasks = store.load("tasks")
    for task in tasks["tasks"]:
        if task_id and task["id"] != task_id:
            continue
        if task.get("claimed_by") == agent_id and task.get("status") == "claimed":
            task.update(status="queued", claimed_by=None, queued_at=now_iso())
            task.setdefault("exclude", [])
            history(task, agent_id, "released", reason)
        elif task.get("reviewer") == agent_id and task.get("status") == "reviewing":
            task.update(status="review", reviewer=None)
            history(task, agent_id, "review released", reason)
    store.save("tasks", tasks)
    if rest_minutes:
        agents = store.load("agents")
        agent = store.find(agents["agents"], agent_id)
        if agent:
            agent.update(status="limited", limited_until=later(rest_minutes))
            store.save("agents", agents)
    store.journal(agent_id, "fail", "Handed work back", f"{reason}" + (f"; resting {rest_minutes} min" if rest_minutes else ""),
                  task_id or "")


# ---- adding things ------------------------------------------------------------------------------

def add_task(by: str, title: str, brief: str, kind: str = "other", prefer: str = "any", priority: int = 3,
             after: list[str] | None = None, inputs: list[str] | None = None, review_mode: str = "none",
             pass_score: int | None = None, checks: list[str] | None = None, parent: str | None = None,
             model: str = "", chat: str = "", effort: str = "") -> dict:
    if kind not in KINDS:
        raise Refused(f"kind must be one of {', '.join(KINDS)}")
    if not (prefer == "any" or prefer in PROVIDERS or prefer.startswith("agent:")):
        raise Refused(f"prefer must be any, a provider ({', '.join(PROVIDERS)}) or agent:<id>")
    if review_mode not in ("none", "cross", "any"):
        raise Refused("review must be none, cross or any")
    tasks = store.load("tasks")
    for ident in after or []:
        if not store.find(tasks["tasks"], ident):
            raise Refused(f"after: no task {ident}")
    task = {
        "id": store.next_id(tasks["tasks"], "T"), "title": title.strip()[:200], "brief": brief.strip(),
        "kind": kind, "prefer": prefer, "priority": max(1, min(5, int(priority))), "after": after or [],
        "inputs": inputs or [], "status": "queued", "attempts": 0, "exclude": [],
        "review": {"mode": review_mode, "pass_score": pass_score or cfg("default_pass_score", 80),
                   "checks": checks or []},
        "parent": parent, "model": model, "chat": chat, "effort": effort,
        "created_by": by, "created_at": now_iso(), "queued_at": now_iso(),
        "claimed_by": None, "result": None, "reviews": [], "history": [],
    }
    history(task, by, "created")
    tasks["tasks"].append(task)
    store.save("tasks", tasks)
    store.journal(by, "update", f"New task {task['id']}: {task['title']}", ref=task["id"])
    return task


def add_agent(by: str, ident: str, provider: str, runner: str, label: str = "", account: str = "",
              model: str = "", skills: list[str] | None = None, weekly_budget_tokens: int = 0,
              preset: str = "", secret: str = "") -> dict:
    if provider not in PROVIDERS:
        raise Refused(f"provider must be one of {', '.join(PROVIDERS)}")
    if runner not in RUNNERS:
        raise Refused(f"runner must be one of {', '.join(RUNNERS)}")
    if not ident.replace("-", "").isalnum():
        raise Refused("id may use letters, digits and dashes only, e.g. claude-1")
    agents = store.load("agents")
    if store.find(agents["agents"], ident):
        raise Refused(f"agent {ident} already exists")
    agent = {"id": ident, "label": label or ident, "provider": provider, "runner": runner, "account": account,
             "model": model, "skills": skills or ["any"], "weekly_budget_tokens": int(weekly_budget_tokens),
             "status": "active", "limited_until": None, "last_seen": None, "created_at": now_iso(),
             "preset": preset, "secret": secret, "limits": {}}
    agents["agents"].append(agent)
    store.save("agents", agents)
    store.journal(by, "update", f"New agent {ident} ({provider}, {runner})")
    return agent
