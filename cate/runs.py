"""Reading what an agent's own CLI reports after a run: exact tokens, and the subscription's 5-hour and
weekly limits. Claude Code (`claude -p --output-format stream-json`) and Codex (`codex exec --json`) both
print one JSON event per line; their shapes change between versions, so everything here is read defensively
and anything missing is simply left out."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from .util import now, tz

WINDOWS = {300: "five_hour", 10080: "seven_day"}


def events(path: str | Path) -> Iterator[dict]:
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def walk(value: Any, path: tuple = ()) -> Iterator[tuple[tuple, dict]]:
    if isinstance(value, dict):
        yield path, value
        for key, child in value.items():
            yield from walk(child, path + (key,))
    elif isinstance(value, list):
        for child in value:
            yield from walk(child, path)


def when(value: Any) -> str | None:
    """Epoch seconds/milliseconds or an ISO string -> local ISO time."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e12 else value
        return datetime.fromtimestamp(seconds, tz()).replace(microsecond=0).isoformat()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(tz()).replace(microsecond=0).isoformat()
    except ValueError:
        return None


def pct(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return round(value * 100 if value <= 1 else value, 1)


def window_name(key: str) -> str | None:
    """Account-wide windows only: 'five_hour' and 'seven_day' exactly (plus a few aliases). Model-specific
    windows such as 'seven_day_opus' are NOT the account's limit and are handled separately."""
    key = key.lower()
    if key in ("five_hour", "5h", "session"):
        return "five_hour"
    if key in ("seven_day", "7d", "weekly", "week"):
        return "seven_day"
    return None


def model_window(key: str) -> tuple[str, str] | None:
    """('opus', 'seven_day') for Claude's model-specific windows like 'seven_day_opus'."""
    key = key.lower()
    for base in ("five_hour", "seven_day"):
        if key.startswith(base + "_") and len(key) > len(base) + 1:
            return key[len(base) + 1:], base
    return None


def _reading(used, resets) -> dict:
    return {"used_pct": used, "resets_at": when(resets)}


def parse(path: str | Path) -> dict:
    """Returns {"tokens_in", "tokens_out", "cached", "cost_usd", "limits": {...}, "raw": [...]}.

    limits["five_hour"] / limits["seven_day"] are the ACCOUNT-WIDE windows (they decide whether the account
    can work). limits["models"][name][window] holds model-specific windows (they only steer model choice).
    Codex reports several rate-limit snapshots side by side (each with limit_id / limit_name /
    normal_model_slug); only the general one is account-wide. Claude reports rateLimitType values such as
    five_hour, seven_day, seven_day_opus, seven_day_sonnet. The last reading of each wins."""
    out = {"tokens_in": 0, "tokens_out": 0, "cached": 0, "cost_usd": None, "limits": {}, "raw": []}
    models: dict[str, dict] = {}
    claude_result = None
    codex_turns = []
    for event in events(path):
        kind = event.get("type")
        if kind == "result" and isinstance(event.get("usage"), dict):
            claude_result = event
        if kind == "turn.completed" and isinstance(event.get("usage"), dict):
            codex_turns.append(event["usage"])
        for where, node in walk(event):
            # ---- Claude: {rateLimitType, utilization (0-1), resetsAt} or unifiedWindows {five_hour: {...}}
            if "utilization" in node:
                key = str(node.get("rateLimitType") or (where[-1] if where else ""))
                used = pct(node.get("utilization"))
                if used is None:
                    continue
                reading = _reading(used, node.get("resetsAt") or node.get("resets_at"))
                out["raw"].append(f"claude {key}: {used}% used, resets {reading['resets_at']}")
                if window_name(key):
                    out["limits"][window_name(key)] = reading
                elif model_window(key):
                    model, base = model_window(key)
                    models.setdefault(model, {})[base] = reading
            # ---- Codex: a snapshot {limit_id?, limit_name?, normal_model_slug?, primary: {...}, secondary: {...}}
            if isinstance(node.get("primary"), dict) or isinstance(node.get("secondary"), dict):
                label = node.get("normal_model_slug") or node.get("limit_name") or node.get("metered_limit_name")
                general = not label or str(node.get("limit_id") or "").lower() in ("codex", "default", "")
                general = general and not node.get("normal_model_slug")
                for side in ("primary", "secondary"):
                    w = node.get(side)
                    if not isinstance(w, dict) or "used_percent" not in w:
                        continue
                    minutes = w.get("window_minutes")
                    name = WINDOWS.get(int(minutes)) if isinstance(minutes, (int, float)) else \
                        {"primary": "five_hour", "secondary": "seven_day"}[side]
                    if name is None:
                        continue
                    used = pct(w.get("used_percent"))
                    resets = w.get("resets_at")
                    if resets is None and isinstance(w.get("resets_in_seconds"), (int, float)):
                        resets = (now() + timedelta(seconds=w["resets_in_seconds"])).isoformat()
                    reading = _reading(used, resets)
                    who = "account" if general else f"model {label}"
                    out["raw"].append(f"codex {who} {name}: {used}% used, resets {reading['resets_at']}"
                                      f" (limit_id={node.get('limit_id')}, limit_name={node.get('limit_name')})")
                    if general:
                        out["limits"][name] = reading
                    else:
                        models.setdefault(str(label), {})[name] = reading
    if models:
        out["limits"]["models"] = models
    if claude_result:
        u = claude_result["usage"]
        out["tokens_in"] = int(u.get("input_tokens", 0)) + int(u.get("cache_creation_input_tokens", 0))
        out["cached"] = int(u.get("cache_read_input_tokens", 0))
        out["tokens_out"] = int(u.get("output_tokens", 0))
        out["cost_usd"] = claude_result.get("total_cost_usd")
    elif codex_turns:
        for u in codex_turns:
            cached = int(u.get("cached_input_tokens", 0))
            out["tokens_in"] += int(u.get("input_tokens", 0)) - cached
            out["cached"] += cached
            out["tokens_out"] += int(u.get("output_tokens", 0))
    return out
