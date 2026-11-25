import TopBar from '@/components/TopBar';
import { AgentButtons, AgentForm, CopyBox } from '@/components/Forms';
import { requireSignIn } from '@/lib/auth';
import { PROVIDERS, RUNNERS, agentState, fmt, loadAll, usage } from '@/lib/data';
import { mainFile } from '@/lib/store';

export const dynamic = 'force-dynamic';

// The one-time setup message for each kind of runner. After this, the agent runs by itself.
function setup(agent, tick, repo) {
  const name = `CATE agent ${agent.id}`;
  if (agent.runner === 'claude-code-scheduled') {
    return {
      where: `Sign in to claude.ai with ${agent.account || 'this Claude account'}, open Claude Code (claude.ai/code), start a session on the ${repo} repository, and send this message once:`,
      text: `Create a recurring scheduled task named "${name}" that runs every hour from 08:00 to 23:00 Asia/Kolkata, and starts a fresh session on the ${repo} repository each time. Use exactly this as its prompt:\n\n---\n${tick}---\n\nThen run that prompt once now to check it works, and tell me the result.`,
    };
  }
  if (agent.runner === 'codex-automation') {
    return {
      where: `In the ChatGPT/Codex app signed in to ${agent.account || 'this ChatGPT account'}, open your local checkout of ${repo} (clone it first if needed), and create an automation (Automations → New) that runs hourly with this prompt:`,
      text: tick,
    };
  }
  if (agent.runner === 'chatgpt-scheduled') {
    return {
      where: 'In ChatGPT (with Developer mode and a GitHub connector able to run commands), create a scheduled task that runs hourly with this prompt:',
      text: tick,
    };
  }
  return { where: 'Paste this into the model whenever you want it to take a job:', text: tick };
}

export default async function Agents() {
  await requireSignIn();
  const { agents, ledger, week, conf } = await loadAll();
  const template = await mainFile('config/prompts/agent_tick.md').catch(() => 'Run: python3 -m cate tick --agent {{agent}}');

  return (
    <>
      <TopBar current="/agents" />
      <main>
        <div className="page-head">
          <h1>Agents</h1>
          <p>Each agent is one AI account on one schedule. It runs on that account&apos;s own subscription, so its tokens come from the plan you already pay for. Add an agent, then send its setup message once in that account; from then on it checks in by itself.</p>
        </div>

        <section className="section">
          {agents.length ? (
            <div className="stack">
              {agents.map((a) => {
                const u = usage(ledger, week, a.id);
                const state = agentState(a, ledger, week);
                const tick = template.replaceAll('{{agent}}', a.id).replaceAll('{{repo}}', conf.repo);
                const how = setup(a, tick, conf.repo);
                return (
                  <div key={a.id} className="agent">
                    <h3>{a.label || a.id} <span className="prov">{PROVIDERS[a.provider] || a.provider}</span></h3>
                    <div className="sub">id <code className="inline">{a.id}</code> · {RUNNERS[a.runner] || a.runner}{a.model ? ` · ${a.model}` : ''}{a.account ? ` · ${a.account}` : ''} · good at: {(a.skills || ['any']).join(', ')}</div>
                    <div className="sub" style={{ marginTop: 4 }}><span className={`dot ${state.tone}`} />{state.label}</div>
                    <div className="sub">{fmt(u.used)} tokens this week{a.weekly_budget_tokens ? ` of ${fmt(a.weekly_budget_tokens)}` : ' (no cap)'} · {u.tasks} jobs</div>
                    <AgentButtons id={a.id} status={a.status} budget={a.weekly_budget_tokens} />
                    <details className="box">
                      <summary>One-time setup</summary>
                      <p className="sub">{how.where}</p>
                      <CopyBox text={how.text} label="Copy setup message" />
                    </details>
                  </div>
                );
              })}
            </div>
          ) : <p className="empty">No agents yet. Add your first one below.</p>}
        </section>

        <section className="section">
          <div className="section-label">Add an agent</div>
          <AgentForm providers={PROVIDERS} runners={RUNNERS} />
        </section>
      </main>
    </>
  );
}
