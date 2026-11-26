"""Read-only product audit. Run from a checkout with python -m cate.audit."""

from __future__ import annotations

import ast
import builtins
import re
import symtable
import sys
from pathlib import Path

from .util import ROOT


# Each checklist row requires a marker in production source, including when the
# audit runs on a different checkout or a capability is subsequently removed.
FEATURES = (
    ("Project chat and attachments", "web/app/actions.js", "await uploadFile("),
    ("Send the same prompt to multiple models", "web/app/actions.js", "compare && selection.length >= 2"),
    ("Review a plan before starting its steps", "web/app/actions.js", "export async function runPlan("),
    ("Add model connections", "web/app/actions.js", "export async function addAgent("),
    ("Choose a model for a task", "cate/core.py", "def choose_model("),
    ("Gate dispatch on account availability", "cate/core.py", "def availability("),
    ("Check cross-provider review eligibility", "cate/core.py", "def can_review("),
    ("Track run usage and limits", "cate/core.py", "def record_run("),
    ("Recover stalled work", "cate/core.py", "def supervise("),
    ("Restore browser drafts per project", "web/components/Chat.js", "window.localStorage.getItem(draftKey(chatId))"),
)

COMPARISON = """## Competitor Analysis

These fixed examples use named 2024 model releases so the vendor measurements have a clear baseline. The reusable-context examples come from separate product documentation.

### OpenAI ChatGPT · GPT-4o

GPT-4o processes speech, images and text in one neural network. A person can ask about a photo in chat, a shorter interaction than submitting an attachment and waiting for a CATE worker. OpenAI reported a 320 ms average response to audio input, a model-level figure. ChatGPT Projects also lets related chats reuse project files and instructions. [GPT-4o launch](https://openai.com/index/hello-gpt-4o/) · [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)

### Google Gemini Advanced · Gemini 1.5 Pro

Gemini uses a mixture of experts inside the model. CATE selects entire models for individual tasks. Gemini Advanced lets a user attach files from Drive or a device and ask about them together. Google reported 99% retrieval of a planted fact in its test with inputs up to one million tokens. That test measures recall within one input. For continuity across chats, a user can save instructions and reference files in a Gem. [Model and evaluation](https://blog.google/innovation-and-ai/products/google-gemini-next-generation-model-february-2024/) · [Gemini Advanced workflow](https://blog.google/products-and-platforms/products/gemini/google-gemini-update-may-2024/) · [Reusable Gems](https://support.google.com/gemini/answer/15146780?hl=en)

### Anthropic Claude · Claude 3.5 Sonnet

Claude pairs a hosted vision-and-text model with Artifacts, a pane for inspecting and revising generated work alongside the chat. A user can check the result while discussing it. Anthropic reported twice the speed of Claude 3 Opus and stronger results on its vision evaluations. CATE adds a different quality check by sending completed work to a separate reviewer. [Sonnet and Artifacts](https://www.anthropic.com/news/claude-3-5-sonnet)

### What to measure in CATE

Run the same document question and revision through direct chat and a reviewed CATE task. Record time to first answer, time to accepted result, charges or subscription tokens, and errors caught by review. A second chat with the same project instructions tests continuity. Use a non-secret preference for the recall test. These vendor measurements cover different tasks and cannot establish a CATE performance ranking."""


def python_findings(path, source, modules):
    """Use Python's own scope rules without executing the scanned module."""
    try:
        tree = ast.parse(source, filename=str(path))
        table = symtable.symtable(source, str(path), "exec")
    except SyntaxError as error:
        yield f"`{path}:{error.lineno}` Python syntax error ({error.msg})."
        return

    referenced = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            referenced.add(node.id)
        if isinstance(node, ast.Import):
            targets = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            package = path.parts[:len(path.parts) - node.level] if node.level else ()
            targets = [".".join((*package, node.module))]
        else:
            continue
        for name in targets:
            if name.partition(".")[0] not in sys.stdlib_module_names and name not in modules:
                yield f"`{path}:{node.lineno}` Check import `{name}`. No matching CATE or standard-library module."

    declared = {s.get_name() for s in table.get_symbols() if s.is_assigned() or s.is_imported()}
    # Restrict findings to explicit references (the compiler also generates names).
    known = declared | set(dir(builtins)) | {"__file__", "__cached__", "__package__", "__spec__", "__path__"}
    pending = [table]
    reported = set()
    while pending:
        scope = pending.pop()
        pending.extend(scope.get_children())
        for symbol in scope.get_symbols():
            name = symbol.get_name()
            if name not in referenced or name in known or name in reported:
                continue
            if symbol.is_referenced() and symbol.is_global():
                yield (f"`{path}` in `{scope.get_name()}`: unresolved name `{name}`. "
                       "Check for a missing import or a typo.")
                reported.add(name)


# Match root-relative destinations in JSX, the sidebar's navigation records,
# redirects, client navigation, and same-origin fetches. Ignore computed paths.
DESTINATION = re.compile(
    r"""\b(?:href\s*(?:=\s*\{?|:)|destination\s*:|(?:redirect|router\.(?:push|replace)|fetch)\s*\()"""
    r"""\s*(?P<quote>['"`])(?P<url>/(?!/)[^'"`\n]*)(?P=quote)"""
)
INTERVAL = re.compile(r"(?:\b(?:const|let|var)\s+(\w+)\s*=\s*)?\b(?:window\.)?setInterval\s*\(")


def route_pattern(parts):
    pattern = ""
    for part in parts:
        if part.startswith("(") or part.startswith("@"):
            continue
        if part.startswith("[[..."):
            pattern += "(/.+)?"
        elif part.startswith("[..."):
            pattern += "/.+"
        elif part.startswith(("[", ":")):
            pattern += "/[^/]+"
        else:
            pattern += "/" + re.escape(part)
    # An optional catch-all at the root must also accept the home page.
    if pattern == "(/.+)?":
        return re.compile("/.*")
    return re.compile(pattern or "/")


def web_findings(root, sources):
    routes = []
    for path in sources:
        if path.parts[:2] == ("web", "app") and path.stem in {"page", "route"}:
            routes.append(route_pattern(path.parts[2:-1]))
    config = sources.get(Path("web/next.config.mjs"), "")
    for alias in re.findall(r"""\bsource:\s*['"](/[^'"]*)['"]\s*,\s*destination:""", config):
        routes.append(route_pattern(alias.strip("/").split("/")))

    for path, source in sources.items():
        if path.parts[0] != "web":
            continue
        for match in DESTINATION.finditer(source):
            url = re.split(r"[?#]", match["url"], maxsplit=1)[0].rstrip("/") or "/"
            if "${" in url:  # A template can expand to several path segments.
                continue
            public_file = root / "web/public" / url.lstrip("/")
            if not any(route.fullmatch(url) for route in routes) and not public_file.is_file():
                line = source.count("\n", 0, match.start()) + 1
                yield f"`{path}:{line}` Check dead route `{url}`. No matching page, handler, redirect or public file."
        for match in INTERVAL.finditer(source):
            handle = match.group(1)
            if handle and re.search(rf"\bclearInterval\(\s*{handle}\s*\)", source):
                continue
            line = source.count("\n", 0, match.start()) + 1
            yield f"`{path}:{line}` Check interval cleanup. Repeated mounting could retain callbacks."
        for match in re.finditer(r"^const (\w+) = new Map\(\)", source, re.MULTILINE):
            name = match.group(1)
            if f"{name}.set(" in source and not re.search(rf"\b{name}\.(clear|delete)\(", source):
                line = source.count("\n", 0, match.start()) + 1
                yield (f"`{path}:{line}` Module cache `{name}` retains entries. "
                       "Check whether the key set and retained values stay bounded.")


def report(root=ROOT):
    sources = {}
    findings = []
    paths = list((root / "cate").rglob("*.py"))
    for folder in ("app", "components", "lib"):
        paths.extend(p for p in (root / "web" / folder).rglob("*") if p.suffix in {".js", ".jsx", ".ts", ".tsx"})
    config = root / "web/next.config.mjs"
    if config.is_file():
        paths.append(config)
    for path in sorted(paths):
        relative = path.relative_to(root)
        try:
            sources[relative] = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            findings.append(f"`{relative}` skipped ({type(error).__name__}).")

    lines = ["# CATE product audit", "", "## Feature Checklist", "",
             "Each check marks implementation evidence in this checkout.", ""]
    for label, filename, marker in FEATURES:
        source = sources.get(Path(filename), "")
        if marker in source:
            line = source[:source.index(marker)].count("\n") + 1
            lines.append(f"- [x] {label} — `{filename}:{line}`")
        else:
            lines.append(f"- [ ] {label} — expected evidence missing from `{filename}`")

    python = {p: s for p, s in sources.items() if p.suffix == ".py"}
    modules = {".".join((p.parent if p.stem == "__init__" else p.with_suffix("")).parts) for p in python}
    for path, source in python.items():
        findings.extend(python_findings(path, source, modules))
    findings.extend(web_findings(root, sources))
    lines.extend(["", "## Bug Summary", "",
                  f"Inspected {len(python)} Python and {len(sources) - len(python)} dashboard source files. "
                  "Checks cover unresolved Python names and module imports, literal internal routes, "
                  "interval cleanup and retained module caches. Findings need runtime verification.", ""])
    lines.extend(f"- {item}" for item in findings or ["No candidates found by these checks."])

    lines.extend(["", "### Conversation continuity", ""])
    cli = sources.get(Path("cate/cli.py"), "")
    window = re.search(r"def conversation\(chat_id: str, limit: int = (\d+)\)", cli)
    if window and 'store.find(store.load("chats")["chats"], chat_id)' in cli and '[-limit:]' in cli:
        lines.append(f"The worker prompt selects one project by chat ID and includes up to {window[1]} recent "
                     "messages (`cate/cli.py`, `conversation`). Instructions in another project or earlier "
                     "in a long conversation can drop out of this handoff. Try a saved, user-editable project "
                     "brief and check whether a second worker can recall a preference from it.")
    else:
        lines.append("Verify the worker's context handoff with a non-secret preference in two project chats.")
    supervisor = sources.get(Path("web/lib/supervisor.js"), "")
    history = re.search(r"return messages\.slice\(-(\d+)\)\.map", supervisor)
    if history and "messages: chat.messages" in sources.get(Path("web/app/actions.js"), ""):
        lines.append(f"The dashboard supervisor receives up to {history[1]} messages from the active chat "
                     "(`web/lib/supervisor.js`, `history`). Reopening a saved chat and carrying context "
                     "into a new project are separate behaviors to test.")
    return "\n".join([*lines, "", COMPARISON])


if __name__ == "__main__":
    print(report())
