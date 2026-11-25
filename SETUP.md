# Setting up CATE (about 15 minutes, once)

## 1. The data branch (done for you by Claude on first push)

`bash scripts/setup_data.sh` turns `./data` into a checkout of the `data` branch. Every agent runs it
automatically on its first visit.

## 2. The dashboard on Vercel (free)

1. vercel.com → **Add New → Project** → import `shloki-loki/CATE`.
2. **Root Directory**: `web`. Framework: Next.js (detected).
3. **Environment Variables**:
   - `SITE_PASSWORD`: a long password you will type to open the dashboard.
   - `GITHUB_REPO`: `shloki-loki/CATE`
   - `DATA_BRANCH`: `data`
   - `GITHUB_TOKEN`: a fine-grained token. GitHub → Settings → Developer settings → Fine-grained tokens →
     Generate: Repository access **Only select repositories → CATE**; Permissions → **Contents: Read and
     write**. Paste it only into Vercel, never into a chat.
4. Deploy. Open the URL, sign in.

The Hobby plan is free for personal use; move to a paid plan before selling CATE to others.

## 3. Agents (connect each once; they then run only when there is work)

Agents are GitHub Actions jobs (`.github/workflows/agents.yml`). Adding a task on the dashboard starts the
workflow; it picks the best agent for each piece of work and starts only those. **No task, no run, no
tokens.** After each run the workflow starts itself again only if the work moved on (e.g. a review is due),
and a cheap check with no AI runs every 2 hours to take back stuck work.

The dashboard's GitHub token needs **Actions: Read and write** (as well as Contents) to start agents.

Each agent's login lives in a GitHub secret (repo → Settings → Secrets and variables → Actions). The
dashboard's Agents page shows the exact steps and secret name for each one:

- **Claude accounts** (`claude-1`, `claude-2`): on your Mac, `npm install -g @anthropic-ai/claude-code`,
  then `claude setup-token` and sign in with that account. Save the printed token as
  `CLAUDE_TOKEN_CLAUDE_1` (or `_2`). Anthropic documents this token for Pro/Max plans in GitHub Actions.
- **ChatGPT Pro** (`gpt-1`): on your Mac, add `cli_auth_credentials_store = "file"` to
  `~/.codex/config.toml`, run `codex login`, and save the contents of `~/.codex/auth.json` as
  `CODEX_AUTH_GPT_1`. This follows OpenAI's guide for Codex with ChatGPT login in CI. The refreshed
  login is kept in the Actions cache between runs. Treat it like a password.
- **Free API models**: Gemini (`free-gemini`), OpenRouter, Groq, Mistral and Cerebras each need a free key
  saved under the secret name shown on the Models page. (GitHub Models was retired by GitHub in July 2026.)

An agent whose secret is missing is paused with a "Not connected" note instead of being retried.

After each Claude or Codex run, CATE reads the CLI's own output for the exact tokens used and the plan's
5-hour and weekly limits, and shows "% left" on the dashboard. Routing avoids an agent near its limit.

## 4. Adding more models later

Add an agent on the Agents page (Gemini, Grok, DeepSeek, Ollama...). Any tool that can run a shell
command on a schedule can be an agent: it only needs to run `python3 -m cate tick --agent <id>` and follow
what it prints.

## 5. Changing CATE from inside CATE (pull requests and auto-merge)

Ask for a change in the chat. A subscription agent makes it on a branch, runs the tests and opens a pull
request; another subscription agent reviews the real diff (`gh pr diff`) and runs the tests. When the review
passes, the `merge` job in `.github/workflows/agents.yml` (script `scripts/automerge.sh`) merges it only if:

- the branch is an agent branch (`cate/...`) targeting `main`, with no changes under `.github/`;
- it merges cleanly, and the tests (plus the site build when `web/` changed) pass on the merged result.

Merge commits are authored as the owner (`[merge] author` in `config/settings.toml`) so Vercel deploys them.
Anything that fails a check is left open with the reason posted in the project's chat. Turn auto-merge off
with `auto = false` under `[merge]`. GitHub setting needed once: Settings → Actions → General → "Allow
GitHub Actions to create and approve pull requests".
