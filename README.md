# CATE: Consume All Tokens Effectively

One dashboard that gives work to all your AI accounts (two Claude Pro accounts, ChatGPT Pro, and later
Gemini, Grok, DeepSeek, local models...), and checks what comes back. **Every agent runs inside its own
official app on its own subscription**, so the tokens come from plans you already pay for. Nothing logs
in on your behalf and no private endpoints are used.

```
   You ── dashboard (Vercel) ──► tasks on the `data` branch ──► GitHub Actions starts ONLY the agents with work
                                                               ├─ Claude Code on Claude Pro (claude-1, claude-2)
                                                               ├─ Codex on ChatGPT Pro (gpt-1)
                                                               └─ free API models (GitHub Models, Gemini, Groq…)
```

## How it works

1. **You add a task** on the dashboard: a brief, who should do it first, checks it must pass.
2. **The right agents start, only when there is work** (GitHub Actions; no timers burning tokens). Each
   runs `python3 -m cate tick --agent <id>` and gets the one job that fits it best.
3. **The agent does the work** with its own tools (web search, code, browsing) and runs `cate submit`.
4. **A different model reviews it** (`cross` review) against your checks and a pass score. Failures go
   back with the reviewer's notes; three strikes and the task is marked failed for you to look at.
5. **The supervisor** (every check-in, and hourly on GitHub Actions) takes work back from silent agents,
   rests agents that hit their usage limit, and lets a task meant for one provider go to anyone after 90
   minutes. That is the automatic switch when a model runs out of tokens.
6. **Tokens and limits** are read from each run's own CLI output: exact tokens, plus the plan's 5-hour and
   weekly limits as "% left". Agents near a limit, or over the weekly budget you set, get no new work.

## Day-one test

`examples/resume_tailor.json`: ChatGPT finds a real job opening, Claude tailors the resume in
`workspace/inputs/resume.md` to it, a different model scores it like an ATS (pass at 80).

```
python3 -m cate task import examples/resume_tailor.json
```

## Commands

```
python3 -m cate.audit                        # offline product audit as a Markdown chat message
python3 -m cate status                       # tasks and agents
python3 -m cate tick --agent claude-1        # an agent's check-in
python3 -m cate task add --title ... --brief ... --kind write --prefer anthropic --review cross
python3 -m cate task list [--all] | show T0001 | cancel T0001
python3 -m cate agent add --id gpt-1 --provider openai --runner codex-automation --weekly-budget 3000000
python3 -m cate agent prompt claude-2        # the one-time scheduled-task prompt for an account
python3 -m cate supervise
python3 -m cate log
```

Changing CATE from inside CATE: agents open pull requests that CATE merges after review, tests and build pass (SETUP.md section 5).

Setup: [SETUP.md](SETUP.md). Agent rules: [AGENTS.md](AGENTS.md). Python standard library only; the
data store and dashboard are adapted from Outreach HQ.
