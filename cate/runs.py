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
    key = key.lower()
    if key.startswith("five_hour") or key in ("5h", "session"):
        return "five_hour"
    if key.startswith("seven_day") or key in ("7d", "weekly", "week"):
        return "seven_day"
    return None


def parse(path: str | Path) -> dict:
    """Returns {"tokens_in", "tokens_out", "cached", "cost_usd", "limits": {"five_hour": {...}, ...}}."""
    out = {"tokens_in": 0, "tokens_out": 0, "cached": 0, "cost_usd": None, "limits": {}}
    claude_result = None
    codex_turns = []
    for event in events(path):
        kind = event.get("type")
        if kind == "result" and isinstance(event.get("usage"), dict):
            claude_result = event
        if kind == "turn.completed" and isinstance(event.get("usage"), dict):
            codex_turns.append(event["usage"])
        for where, node in walk(event):
            # Claude: rate_limit_info {rateLimitType: "five_hour", utilization, resetsAt} or
            # unifiedWindows {five_hour: {utilization, resetsAt}, seven_day: {...}}
            if "utilization" in node:
                name = window_name(str(node.get("rateLimitType") or (where[-1] if where else "")))
                used = pct(node.get("utilization"))
                if name and used is not None:
                    out["limits"][name] = {"used_pct": used, "resets_at": when(node.get("resetsAt") or node.get("resets_at"))}
            # Codex: rate_limits {primary: {used_percent, window_minutes, resets_in_seconds|resets_at}, secondary: {...}}
            if "used_percent" in node:
                minutes = node.get("window_minutes")
                name = WINDOWS.get(int(minutes)) if isinstance(minutes, (int, float)) else window_name(where[-1] if where else "")
                if name is None and where:
                    name = {"primary": "five_hour", "secondary": "seven_day"}.get(where[-1])
                used = pct(node.get("used_percent"))
                if name and used is not None:
                    resets = node.get("resets_at")
                    if resets is None and isinstance(node.get("resets_in_seconds"), (int, float)):
                        resets = (now() + timedelta(seconds=node["resets_in_seconds"])).isoformat()
                    out["limits"][name] = {"used_pct": used, "resets_at": when(resets)}
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
