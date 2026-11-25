import Link from 'next/link';
import TopBar from '@/components/TopBar';
import { requireSignIn } from '@/lib/auth';
import { PRESETS, PROVIDERS, loadAll } from '@/lib/data';

export const dynamic = 'force-dynamic';

const SUBSCRIPTIONS = [
  { name: 'Claude (Pro / Max)', how: 'Claude Code with a token from claude setup-token', status: 'Supported', note: 'Official: Anthropic documents this token for Pro/Max in GitHub Actions. Full tools: web, code, files.' },
  { name: 'ChatGPT (Plus / Pro)', how: 'Codex CLI with your ChatGPT login (auth.json)', status: 'Supported', note: 'Official CI guide from OpenAI. Full tools.' },
  { name: 'Grok (SuperGrok)', how: 'Through partner tools only (OpenCode, Warp)', status: 'Later', note: 'xAI allows its subscription in a few partner tools; CATE can run OpenCode as a runner next.' },
  { name: 'Gemini (Google AI Pro)', how: 'Gemini CLI login was stopped for subscriptions in 2026', status: 'Use the free API key', note: 'The free Gemini API key below works today.' },
  { name: 'Perplexity Pro', how: 'No subscription access for apps', status: 'Not possible', note: 'Perplexity’s API is separate and paid.' },
  { name: 'Ollama (local models)', how: 'Runs on your own computer', status: 'Later', note: 'Needs a computer that stays on; can join as a manual agent.' },
];

export default async function Models() {
  await requireSignIn();
  const { agents } = await loadAll();
  const used = (preset) => agents.filter((a) => a.preset === preset).map((a) => a.id);

  return (
    <>
      <TopBar current="/models" />
      <main>
        <div className="page-head">
          <h1>Models &amp; connections</h1>
          <p>Each free model needs a free key saved as a GitHub secret (GitHub Models, which needed none, was shut down by GitHub in July 2026). Free API models handle writing, planning and reviewing, so your Claude and ChatGPT limits are kept for the work that needs tools. API models cannot browse or run code.</p>
        </div>

        <section className="section">
          <div className="section-label">Free (or nearly free) API models</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Model</th><th>Cost</th><th>Default model</th><th>Key</th><th>In use by</th><th /></tr></thead>
              <tbody>
                {Object.entries(PRESETS).map(([key, p]) => (
                  <tr key={key}>
                    <td><b>{p.label}</b><div className="sub">{p.note}</div></td>
                    <td>{p.free}</td>
                    <td><code className="inline">{p.model}</code></td>
                    <td>{p.key ? <a className="link" href={p.key} target="_blank" rel="noreferrer">Get a free key</a> : 'None needed'}<div className="sub">secret <code className="inline">{p.secret}</code></div></td>
                    <td>{used(key).join(', ') || '–'}</td>
                    <td><Link prefetch={false} className="button small" href="/agents#add">Add as agent</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-label">Subscriptions you already pay for</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Plan</th><th>How CATE uses it</th><th>Status</th><th>Notes</th></tr></thead>
              <tbody>
                {SUBSCRIPTIONS.map((s) => (
                  <tr key={s.name}><td><b>{s.name}</b></td><td>{s.how}</td><td>{s.status}</td><td className="sub">{s.note}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>Connected agents: {agents.map((a) => `${a.id} (${PROVIDERS[a.provider] || a.provider})`).join(', ') || 'none yet'}.</p>
        </section>
      </main>
    </>
  );
}
