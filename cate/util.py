"""Small shared helpers. Standard library only, so nothing needs installing anywhere."""

from __future__ import annotations

import tomllib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"


def settings() -> dict[str, Any]:
    with open(CONFIG_DIR / "settings.toml", "rb") as handle:
        return tomllib.load(handle)


def tz() -> ZoneInfo:
    return ZoneInfo(settings().get("timezone", "Asia/Kolkata"))


def now() -> datetime:
    return datetime.now(tz())


def now_iso() -> str:
    return now().replace(microsecond=0).isoformat()


def parse_iso(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def minutes_since(text: str | None) -> float:
    moment = parse_iso(text)
    if moment is None:
        return float("inf")
    return (now() - moment).total_seconds() / 60


def week_key(moment: datetime | None = None) -> str:
    """ISO week, e.g. 2026-W48. Budgets reset every Monday."""
    year, week, _ = (moment or now()).isocalendar()
    return f"{year}-W{week:02d}"


def day_key(moment: datetime | None = None) -> str:
    return (moment or now()).strftime("%Y-%m-%d")


def estimate_tokens(text: str) -> int:
    """Rough token count (about 4 characters a token). Subscriptions do not report exact usage to us."""
    return max(1, len(text or "") // 4)


def later(minutes: float) -> str:
    return (now() + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()
