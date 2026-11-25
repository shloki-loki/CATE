"""The data store: a handful of JSON files in ./data, which is a checkout of the repo's `data` branch.

Adapted from the Outreach HQ store. Several writers touch it (GitHub Actions, the website, every agent), so every write goes
through `transact`: sync to the latest remote state, apply the change, commit, push, and redo the
whole thing if someone else pushed first. A change must therefore be a function that can run again
on fresh data.

Several agents may also run on the same machine at once and share this one checkout, so `transact` holds a
cross-process lock for the whole sync-change-commit-push, files are written under unique temporary
names, and nothing that does not parse is ever committed.

Never edit the JSON by hand or outside `transact`; a sync discards uncommitted edits.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, TypeVar

from .util import ROOT, now_iso

DATA_DIR = Path(os.environ.get("CATE_DATA_DIR") or ROOT / "data")
BRANCH = "data"
T = TypeVar("T")

DEFAULTS: dict[str, Any] = {
    "agents": {"agents": []},     # every model account that can take work
    "tasks": {"tasks": []},       # the work queue
    "ledger": {"weeks": {}},      # tokens used per agent per ISO week
    "journal": {"entries": []},   # one line per thing that happened
}


def path(name: str) -> Path:
    return DATA_DIR / f"{name}.json"


class StoreBusy(Exception):
    pass


class StoreCorrupt(Exception):
    pass


_lock_depth = 0


@contextlib.contextmanager
def locked(wait: float = 600.0):
    """Hold the store for this process. Agents on the same Mac share one checkout; without this, two
    of them syncing and writing at the same moment lose each other's changes or mangle a file."""
    global _lock_depth
    if _lock_depth:  # already held by this process (a transact inside a transact)
        _lock_depth += 1
        try:
            yield
        finally:
            _lock_depth -= 1
        return
    lock_path = DATA_DIR.parent / f".{DATA_DIR.name}.lock"  # beside the checkout, so git never sees it
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + wait
    with open(lock_path, "a+") as handle:
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise StoreBusy(f"another cate command has held the data store for over {int(wait)} s") from None
                time.sleep(0.2)
        _lock_depth = 1
        try:
            yield
        finally:
            _lock_depth = 0
            fcntl.flock(handle, fcntl.LOCK_UN)


def load(name: str) -> Any:
    target = path(name)
    for attempt in range(6):
        if not target.exists():
            return json.loads(json.dumps(DEFAULTS[name]))
        try:
            with open(target, encoding="utf-8") as handle:
                return json.load(handle)
        except (json.JSONDecodeError, FileNotFoundError):
            # A reader outside the lock can catch a file while another process's sync is rewriting it.
            if _lock_depth or attempt == 5:
                raise
            time.sleep(0.3)
    raise AssertionError("unreachable")


def save(name: str, value: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=1) + "\n"
    fd, temp = tempfile.mkstemp(dir=DATA_DIR, prefix=f".{name}.", suffix=".tmp")  # unique per writer
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path(name))
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temp)
        raise


class StoreOffline(Exception):
    pass


def _run(command: list[str], timeout: float, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    """Run a command and, on timeout, kill it and everything it started. `subprocess.run(timeout=)` kills
    only the direct child; git's network helper (git-remote-https) survives, keeps the pipes open, and the
    caller waits for ever. That held the store lock for hours on 2026-11-14."""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               start_new_session=True, env=env)
    try:
        out, err = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGKILL)
        with contextlib.suppress(Exception):
            process.communicate(timeout=10)
        raise
    return subprocess.CompletedProcess(command, process.returncode, out, err)


NETWORK = ("fetch", "push", "pull", "clone", "ls-remote")


def _git(*args: str, check: bool = True, timeout: float | None = None) -> subprocess.CompletedProcess:
    network = any(arg in NETWORK for arg in args)
    # A stalled connection gives up after 30 s under 1 kB/s; nothing ever waits on a password prompt.
    command = ["git", "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=30", "-C", str(DATA_DIR), *args]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        done = _run(command, timeout or (90 if network else 180), env)
    except subprocess.TimeoutExpired:
        if network:
            raise StoreOffline(f"git {args[0]} got no answer from GitHub in {int(timeout or 90)} s; nothing was "
                               f"changed. Check the network (a sandboxed shell has none) and run the command again.") from None
        raise
    if check and done.returncode:
        raise subprocess.CalledProcessError(done.returncode, command, done.stdout, done.stderr)
    return done


def _unparseable() -> list[str]:
    """Changed JSON files that no longer parse. Checked before every commit."""
    broken = []
    for line in _git("status", "--porcelain").stdout.splitlines():
        name = line[3:].strip().strip('"')
        if not name.endswith(".json") or not (DATA_DIR / name).exists():
            continue
        try:
            with open(DATA_DIR / name, encoding="utf-8") as handle:
                json.load(handle)
        except (json.JSONDecodeError, UnicodeDecodeError):
            broken.append(name)
    return broken


def git_enabled() -> bool:
    """True when ./data is its own git checkout with a remote to sync against."""
    if os.environ.get("CATE_NO_GIT") == "1" or not (DATA_DIR / ".git").exists():
        return False
    return bool(_git("remote", check=False).stdout.strip())


def sync() -> None:
    """Make ./data match the remote `data` branch exactly."""
    if not git_enabled():
        return
    _git("fetch", "--quiet", "origin", BRANCH)
    _git("reset", "--quiet", "--hard", f"origin/{BRANCH}")


class PushConflict(Exception):
    pass


def transact(change: Callable[[], T], message: str, attempts: int = 6) -> T:
    """Run `change` (which loads, edits and saves files) and publish the result.

    `change` may run more than once, each time on freshly synced data.
    """
    with locked():
        if not git_enabled():
            return change()
        last = ""
        for _ in range(attempts):
            sync()
            result = change()
            _git("add", "-A")
            if not _git("status", "--porcelain").stdout.strip():
                return result
            broken = _unparseable()
            if broken:
                _git("reset", "--quiet", "--hard", f"origin/{BRANCH}")
                raise StoreCorrupt(f"'{message}' left {', '.join(broken)} unreadable; nothing was committed")
            _git("-c", "user.name=cate", "-c", "user.email=cate@users.noreply.github.com",
                 "commit", "--quiet", "-m", message)
            pushed = _git("push", "--quiet", "origin", f"HEAD:{BRANCH}", check=False)
            if pushed.returncode == 0:
                return result
            last = pushed.stderr.strip()
    raise PushConflict(f"could not publish '{message}' after {attempts} attempts: {last}")


# ---- small helpers -----------------------------------------------------------------------------

def next_id(items: list[dict], prefix: str) -> str:
    highest = 0
    for item in items:
        ident = str(item.get("id", ""))
        if ident.startswith(prefix) and ident[len(prefix):].isdigit():
            highest = max(highest, int(ident[len(prefix):]))
    return f"{prefix}{highest + 1:04d}"


def find(items: list[dict], ident: str) -> dict | None:
    return next((item for item in items if item.get("id") == ident), None)


JOURNAL_KINDS = ("run", "claim", "submit", "review", "requeue", "supervise", "fail", "update", "note")


def journal(by: str, kind: str, title: str, detail: str = "", ref: str = "") -> None:
    """Append to the log from inside a `transact` change."""
    data = load("journal")
    data["entries"].append({"id": next_id(data["entries"], "J"), "at": now_iso(), "by": by, "kind": kind,
                            "title": title.strip(), "detail": (detail or "").strip(), "ref": ref})
    data["entries"] = data["entries"][-3000:]
    save("journal", data)


def write_text(relative: str, text: str) -> None:
    """Write a text file (an agent's output) inside the data checkout, from inside a `transact` change."""
    target = (DATA_DIR / relative).resolve()
    if DATA_DIR.resolve() not in target.parents:
        raise ValueError(f"{relative} is outside the data store")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
