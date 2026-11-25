import TopBar from '@/components/TopBar';
import { AgentButtons, AgentForm, CopyBox } from '@/components/Forms';
import { requireSignIn } from '@/lib/auth';
import { PRESETS, PROVIDERS, RUNNERS, agentState, fmt, limitRows, loadAll, secretFor, usage, when } from '@/lib/data';

export const dynamic = 'force-dynamic';

// One-time connection steps per kind of agent. After this the agent starts by itself whenever there is work.
function Setup({ agent, repo }) {
  const secret = secretFor(agent);
  const secretsUrl = `https://github.com/${repo}/settings/secrets/actions/new`;
  const addSecret = (
    <li>Open <a className="link" href={secretsUrl} target="_blank" rel="noreferrer">GitHub → CATE → Settings → Secrets → New repository secret</a>, name it <code className="inline">{secret}</code>, paste the value, save. Never paste it into a chat.</li>
  );
  if (agent.runner === 'claude-actions') {
    return (
      <ol className="sub">
        <li>On your Mac, open Terminal and install Claude Code once: <code className="inline">npm install -g @anthropic-ai/claude-code</code></li>
        <li>Run <code className="inline">claude setup-token</code>. A browser opens: sign in with <b>{agent.account || 'this Claude account'}</b>. It prints a long token starting <code className="inline">sk-ant-oat</code>.</li>
        {addSecret}
        <li>Press <b>Resume</b> above if this agent shows “Not connected”. Done: it now runs on that account&apos;s subscription, only when there is work.</li>
        <li className="faint">For your second Claude account, run <code className="inline">claude setup-token</code> again and sign in with the other account (log out in the browser first).</li>
      </ol>
    );
  }
  if (agent.runner === 'codex-actions') {
    return (
      <ol className="sub">
        <li>On your Mac, in Terminal: <code className="inline">mkdir -p ~/.codex &amp;&amp; echo &apos;cli_auth_credentials_store = &quot;file&quot;&apos; &gt;&gt; ~/.codex/config.toml</code></li>
        <li>Run <code className="inline">codex login</code> and sign in with <b>{agent.account || 'your ChatGPT account'}</b> (install with <code className="inline">npm install -g @openai/codex</code> if needed).</li>
        <li>Copy the file’s contents: <code className="inline">cat ~/.codex/auth.json | pbcopy</code></li>
        {addSecret}
        <li>Press <b>Resume</b> if it shows “Not connected”. CATE keeps the refreshed login between runs, as OpenAI’s CI guide describes. Treat that file like a password.</li>
      </ol>
    );
  }
  if (agent.runner === 'api') {
    const preset = PRESETS[agent.preset];
    return (
      <ol className="sub">
        <li>Get a {preset ? `free ${preset.label}` : ''} API key{preset?.key ? <> at <a className="link" href={preset.key} target="_blank" rel="noreferrer">{preset.key.replace('https://', '')}</a></> : ''}.</li>
        {addSecret}
      </ol>
    );
  }
  return <p className="sub">Timer-based agent: it checks in on a schedule even when there is no work, which costs tokens. Switch it to an on-demand runner to save them.</p>;
}

export default async function Agents() {
  await requireSignIn();
  const { agents, ledger, week, conf } = await loadAll();

  return (
    <>
      <TopBar current="/agents" />
      <main>
        <div className="page-head">
          <h1>Agents</h1>
          <p>Each agent is one AI account or one free model. Claude and ChatGPT agents run on the plan you already pay for, through their official command-line tools, and only start when there is work for them. Connect each one once with the steps under it.</p>
        </div>

        <section className="section">
          {agents.length ? (
            <div className="stack">
              {agents.map((a) => {
                const u = usage(ledger, week, a.id);
                const state = agentState(a, ledger, week);
                return (
                  <div key={a.id} className="agent">
                    <h3>{a.label || a.id} <span className="prov">{PROVIDERS[a.provider] || a.provider}</span></h3>
                    <div className="sub">id <code className="inline">{a.id}</code> · {RUNNERS[a.runner] || a.runner}{a.model ? ` · ${a.model}` : ''}{a.account ? ` · ${a.account}` : ''} · good at: {(a.skills || ['any']).join(', ')}</div>
                    <div className="sub" style={{ marginTop: 4 }}><span className={`dot ${state.tone}`} />{state.label}</div>
                    {limitRows(a).map((r) => (
                      <div key={r.label} className="sub">{r.label}: <b>{r.left.toFixed(0)}% left</b> ({r.used}% used){r.resets ? `, resets ${when(r.resets)}` : ''}</div>
                    ))}
                    {!limitRows(a).length && ['claude-actions', 'codex-actions'].includes(a.runner) ? <div className="sub">Subscription limits appear after its first run.</div> : null}
                    <div className="sub">{fmt(u.used)} tokens this week{u.cached ? ` + ${fmt(u.cached)} cached` : ''}{a.weekly_budget_tokens ? ` of ${fmt(a.weekly_budget_tokens)} budget` : ' (no budget cap)'} · {u.tasks} jobs</div>
                    <AgentButtons id={a.id} status={a.status} budget={a.weekly_budget_tokens} />
                    <details className="box" open={a.status === 'paused' && Boolean(a.note)}>
                      <summary>Connect (one time)</summary>
                      <Setup agent={a} repo={conf.repo} />
                    </details>
                  </div>
                );
              })}
            </div>
          ) : <p className="empty">No agents yet. Add your first one below.</p>}
        </section>

        <section className="section" id="add">
          <div className="section-label">Add an agent</div>
          <AgentForm providers={PROVIDERS} runners={RUNNERS} presets={PRESETS} />
        </section>
      </main>
    </>
  );
}
