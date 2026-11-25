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
    budget = int(agent.get("weekly_budget_tokens") or 0)
    if budget and tokens_used(ledger, agent["id"]) >= budget:
        return False, f"weekly budget of {budget:,} tokens used up"
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


def lowest_left(agent: dict) -> float:
    lim = agent.get("limits") or {}
    return min([100 - float((lim.get(w) or {}).get("used_pct") or 0) for w in ("five_hour", "seven_day")] or [100])


def choose_model(agent: dict, task: dict) -> tuple[str, str]:
    """(model id, effort) for this agent doing this task. The task's own choice wins if this agent has that
    model; then the agent's per-job default; then the best-scoring enabled model for the job, picking a
    lighter one when the account is low on limits."""
    allowed = enabled_models(agent)
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

def deps_done(task: dict, tasks: list[dict]) -> bool:
    for ident in task.get("after", []):
        parent = store.find(tasks, ident)
        if not parent or parent.get("status") != "done":
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
    skills = agent.get("skills") or ["any"]
    if not ("any" in skills or "review" in skills):
        return False
    worker = (task.get("result") or {}).get("by")
    if agent["id"] == worker:
        return False
    if (task.get("review") or {}).get("mode") == "cross" and agent.get("provider") == worker_provider(task, agents):
        # another provider should check it; fall back to a different account of the same provider after a wait
        return minutes_since(task.get("review_queued_at")) >= cfg("fallback_minutes", 90)
    return True


def order(task: dict) -> tuple:
    return (int(task.get("priority", 3)), task.get("queued_at") or task.get("created_at") or "")


def limit_pct(agent: dict, window: str) -> float:
    return float(((agent.get("limits") or {}).get(window) or {}).get("used_pct") or 0)


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
            agent["limits"] = {**(agent.get("limits") or {}), **limits, "at": now_iso()}
            store.save("agents", agents)


# ---- the supervisor -----------------------------------------------------------------------------

def supervise(actor: str = "supervisor") -> list[str]:
    """Fix what is stuck. Safe to run any time, by anyone. Returns one line per change."""
    notes: list[str] = []
    agents = store.load("agents")
    tasks = store.load("tasks")
    timeout = cfg("claim_timeout_minutes", 150)
    max_attempts = cfg("max_attempts", 3)

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

    store.save("agents", agents)
    store.save("tasks", tasks)
    for line in notes:
        store.journal(actor, "supervise", line)
    return notes


# ---- an agent's turn ----------------------------------------------------------------------------

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
        task.update(status="reviewing", reviewer=agent_id, reviewing_at=now_iso(), review_model=review_model)
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
    task.update(status="claimed", claimed_by=agent_id, claimed_at=now_iso(), run_model=model, run_effort=effort)
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
