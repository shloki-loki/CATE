import { MenuButton } from '@/components/AppFrame';
import ModelsPanel from '@/components/ModelsPanel';
import { KIND_LABELS, bestFor, chooseModel, enabledModels } from '@/lib/catalog';
import { PRESETS, loadAll, secretFor } from '@/lib/data';
import { supervisorAvailable } from '@/lib/supervisor';
import { usageRows } from '@/lib/usage';

export const dynamic = 'force-dynamic';

const KEY_URLS = { groq: 'https://console.groq.com/keys', google: 'https://aistudio.google.com/apikey' };

function Score({ value }) {
  return <span className="score" title={`${value}/5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= value ? 'on' : ''} />)}</span>;
}

export default async function Models() {
  const all = await loadAll();
  const { agents, catalog, conf } = all;
  const usage = usageRows(all);
  const usable = agents.filter((a) => a.runner !== 'manual');
  const rows = usable.map((a) => ({
    id: a.id, label: a.label || a.id, provider: a.provider, runner: a.runner, status: a.status, note: a.note || '',
    planLabel: a.runner === 'api' ? 'Free API' : catalog.providers?.[a.provider]?.plan || a.provider,
    models: enabledModels(catalog, a), roles: a.roles || {}, budget: a.weekly_budget_tokens || 0,
    defaults: Object.fromEntries(Object.keys(KIND_LABELS).map((k) => [k, chooseModel(catalog, a, k)])),
    secret: secretFor(a), keyUrl: KEY_URLS[a.provider] || PRESETS[a.preset]?.key || '',
  }));
  const supervisor = supervisorAvailable();
  const allModels = Object.entries(catalog.providers || {}).flatMap(([p, prov]) => (prov.models || []).map((m) => ({ ...m, providerLabel: prov.label })));

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head" style={{ display: 'flex', gap: 10, alignItems: 'start' }}>
          <MenuButton />
          <div>
            <h1>Models &amp; connections</h1>
            <p>Your subscriptions and free APIs, the models each may use, and which model handles which job. “Auto” follows the research below and switches to a lighter model when an account is low on limit.</p>
          </div>
        </div>

        {supervisor
          ? <div className="banner">Instant supervisor: <b>{supervisor.provider === 'groq' ? 'Groq (free)' : 'Gemini (free)'}</b>. It answers in the chat within seconds and plans the work; it never does the heavy work itself.</div>
          : <div className="banner warn">The instant chat supervisor is off. Add a free <b>GROQ_API_KEY</b> (console.groq.com/keys) in Vercel → Settings → Environment Variables, then redeploy. A <b>GEMINI_API_KEY</b> there works as a backup.</div>}

        <ModelsPanel agents={rows} providers={catalog.providers || {}} usage={usage} presets={PRESETS} repo={conf.repo} />

        <div className="section">
          <div className="section-label">Which model for what (research, {catalog.updated})</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Model</th>{Object.values(KIND_LABELS).filter((k) => k !== 'Other').map((k) => <th key={k}>{k}</th>)}<th>Uses limits</th></tr></thead>
              <tbody>
                {allModels.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.label}</b> <span className="faint">· {m.providerLabel}</span><div className="faint" style={{ fontSize: 12 }}>{m.note}</div></td>
                    {Object.keys(KIND_LABELS).filter((k) => k !== 'other').map((k) => <td key={k}><Score value={m.scores?.[k] || 0} /></td>)}
                    <td className="faint">{m.weight ? `×${m.weight}` : 'free'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Best right now: {Object.keys(KIND_LABELS).map((k) => { const b = bestFor(catalog, usable, k); return b ? `${KIND_LABELS[k]} → ${b.agent} / ${allModels.find((m) => m.id === b.model)?.label || b.model}` : null; }).filter(Boolean).join(' · ')}.
            {' '}Sources: {(catalog.sources || []).map((s, i) => <span key={s}>{i ? ', ' : ''}<a className="link" href={s} target="_blank" rel="noreferrer">{new URL(s).hostname.replace('www.', '')}</a></span>)}.
          </p>
        </div>

        <div className="section">
          <div className="section-label">Free APIs you can add</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>API</th><th>Free allowance</th><th>Good for</th><th>Key</th></tr></thead>
              <tbody>
                {Object.entries(PRESETS).map(([k, p]) => (
                  <tr key={k}><td><b>{p.label}</b></td><td>{p.free}</td><td className="muted">{p.note}</td><td><a className="link" href={p.key} target="_blank" rel="noreferrer">Get a key</a><div className="faint" style={{ fontSize: 12 }}>secret <code className="inline">{p.secret}</code></div></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
