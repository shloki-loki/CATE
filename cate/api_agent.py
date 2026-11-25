"""Agents that are plain API calls: free tiers (Gemini, OpenRouter, Groq, Mistral, Cerebras)
or any OpenAI-compatible endpoint (GitHub Models was retired by GitHub in July 2026). They have no tools (no browsing, no shell), so they suit writing,
planning and reviewing, which saves subscription tokens for the work that needs tools."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

from . import core, store
from .cli import read_input

# name: (label, base URL, default model, secret holding the key, where to get a free key, note)
PRESETS = {
    "gemini": ("Google Gemini (free tier)", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash",
               "GEMINI_API_KEY", "https://aistudio.google.com/apikey", "Free tier: Flash models, daily request cap."),
    "openrouter": ("OpenRouter free models", "https://openrouter.ai/api/v1", "openrouter/free",
                   "OPENROUTER_API_KEY", "https://openrouter.ai/keys", "25+ free models; rate-limited."),
    "groq": ("Groq (free tier)", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile",
             "GROQ_API_KEY", "https://console.groq.com/keys", "Very fast open models; free daily limits."),
    "mistral": ("Mistral (free tier)", "https://api.mistral.ai/v1", "mistral-small-latest",
                "MISTRAL_API_KEY", "https://console.mistral.ai/api-keys", "Free experiment tier."),
    "cerebras": ("Cerebras (free tier)", "https://api.cerebras.ai/v1", "llama-3.3-70b",
                 "CEREBRAS_API_KEY", "https://cloud.cerebras.ai", "Free daily tokens."),
    "deepseek": ("DeepSeek (paid, very cheap)", "https://api.deepseek.com/v1", "deepseek-chat",
                 "DEEPSEEK_API_KEY", "https://platform.deepseek.com/api_keys", "Not free, but cents per task."),
}

SYSTEM = """You are a careful, honest expert working as one agent in a team of AI models (CATE).
You have no tools: you cannot browse, run code or open links. Work only from the brief and inputs given.
Never invent facts, numbers, links or sources; say plainly what you could not verify."""

REVIEW_FORMAT = """Reply with ONLY a JSON object, no other text:
{"score": <0-100>, "verdict": "pass" or "fail", "notes": "<what is good, what must change, and each check: passed/failed with why>"}"""


def chat(base: str, key: str, model: str, messages: list[dict]) -> tuple[str, int, int]:
    body = json.dumps({"model": model, "messages": messages, "temperature": 0.3}).encode()
    request = urllib.request.Request(f"{base.rstrip('/')}/chat/completions", data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "cate-agent"})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{error.code} from {base}: {error.read().decode(errors='replace')[:500]}") from None
    text = data["choices"][0]["message"].get("content") or ""
    usage = data.get("usage") or {}
    return text, int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))


def brief_text(task: dict) -> str:
    parts = [f"# Task {task['id']}: {task['title']}", "", task["brief"]]
    checks = (task.get("review") or {}).get("checks") or []
    if checks:
        parts += ["", "It will be checked against:", *[f"- {c}" for c in checks]]
    if task.get("feedback"):
        parts += ["", "A reviewer sent the last attempt back. Fix these points:", task["feedback"]]
        if task.get("result"):
            parts += ["", "The last attempt:", task["result"]["text"]]
    for path in task.get("inputs", []):
        parts += ["", f"--- Input: {path} ---", read_input(path)]
    parts += ["", "Reply with the complete deliverable only."]
    return "\n".join(parts)


def run(agent_id: str) -> str:
    """One check-in for an API agent: take a job, call the model, hand the answer in."""
    result = store.transact(lambda: core.tick(agent_id), f"tick: {agent_id}")
    if result["action"] == "idle":
        return f"idle: {result['reason']}"
    agent = store.find(store.load("agents")["agents"], agent_id) or {}
    preset = PRESETS.get(agent.get("preset") or "", None)
    base = agent.get("api_base") or (preset[1] if preset else "")
    model = agent.get("model") or (preset[2] if preset else "")
    key = os.environ.get("CATE_API_KEY", "")
    task = result["task"]
    try:
        if not (base and model and key):
            raise RuntimeError("missing API base URL, model or key (GitHub secret " + core.agent_secret(agent) + ")")
        if result["action"] == "review":
            rv = task.get("review") or {}
            prompt = "\n".join([f"Review this work strictly. Pass only if every check passes and the score is at least "
                                f"{rv.get('pass_score', 80)}.", "", "--- Brief ---", task["brief"], "",
                                "--- Checks ---", *[f"- {c}" for c in rv.get("checks", [])], "",
                                f"--- Work by {task['result']['by']} ---", task["result"]["text"], "", REVIEW_FORMAT])
            text, t_in, t_out = chat(base, key, model, [{"role": "system", "content": SYSTEM},
                                                       {"role": "user", "content": prompt}])
            match = re.search(r"\{.*\}", text, re.S)
            verdict = json.loads(match.group(0)) if match else {"score": 0, "verdict": "fail", "notes": text}
            store.transact(lambda: core.review(agent_id, task["id"], int(verdict.get("score", 0)),
                                               "pass" if verdict.get("verdict") == "pass" else "fail",
                                               str(verdict.get("notes", "")), t_in, t_out), f"review: {task['id']}")
            return f"reviewed {task['id']}: {verdict.get('verdict')} ({verdict.get('score')})"
        text, t_in, t_out = chat(base, key, model, [{"role": "system", "content": SYSTEM},
                                                   {"role": "user", "content": brief_text(task)}])
        store.transact(lambda: core.submit(agent_id, task["id"], text, t_in, t_out), f"submit: {task['id']}")
        return f"submitted {task['id']} ({t_in + t_out:,} tokens)"
    except Exception as error:  # hand the work back so another agent takes it
        store.transact(lambda: core.release(agent_id, task["id"], f"API error: {error}"[:300], 60),
                       f"release: {agent_id}")
        return f"released {task['id']}: {error}"
