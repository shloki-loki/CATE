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

## 3. Agents (one message per account, once)

Open the dashboard's **Agents** page. Each agent has a **One-time setup** box with the exact message.

- **Claude accounts (claude-1, claude-2)**: sign in to claude.ai with that account, open Claude Code
  (claude.ai/code), start a session on `shloki-loki/CATE`, paste the setup message. It creates a
  dedicated agent session with the repo attached and an hourly scheduled task (08:07–23:07 IST) that
  wakes it. (A scheduled task that starts a *fresh* session gets no repository, so it must wake a
  session that already has one.) The CATE repo must be reachable from that Claude account's GitHub
  connection (claude.ai/connect-github).
- **ChatGPT Pro (gpt-1)**: in the Codex app, open your local checkout of CATE
  (`git clone https://github.com/shloki-loki/CATE`), create an automation that runs hourly with the
  prompt shown. This is the same kind of automation you already use for Outreach HQ.

From then on everything is hands-free: add tasks on the dashboard and the agents pick them up.

## 4. Adding more models later

Add an agent on the Agents page (Gemini, Grok, DeepSeek, Ollama...). Any tool that can run a shell
command on a schedule can be an agent: it only needs to run `python3 -m cate tick --agent <id>` and follow
what it prints.
