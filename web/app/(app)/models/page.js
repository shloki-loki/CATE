import { TopBar } from '@/components/AppFrame';
import ModelGuide from '@/components/ModelGuide';
import ModelsPanel, { AddSection } from '@/components/ModelsPanel';
import TeamMap from '@/components/TeamMap';
import { KIND_LABELS, bestFor, chooseModel, enabledModels, modelLabel } from '@/lib/catalog';
import { PRESETS, loadAll, secretFor } from '@/lib/data';
import { statusOf } from '@/lib/status';
import { supervisorAvailable } from '@/lib/supervisor';
import { lowestPercent, usageRows } from '@/lib/usage';

export const dynamic = 'force-dynamic';

const KEY_URLS = { groq: 'https://console.groq.com/keys', google: 'https://aistudio.google.com/apikey' };

export default async function Models() {
  const all = await loadAll();
  const { agents, catalog, conf, tasks } = all;
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
  const supervisorLabel = supervisor ? (supervisor.provider === 'groq' ? 'Groq (free)' : 'Gemini (free)') : 'Supervisor';
  const allModels = Object.entries(catalog.providers || {}).flatMap(([, prov]) => (prov.models || []).map((m) => ({ ...m, providerLabel: prov.label })));
  const kinds = Object.entries(KIND_LABELS).filter(([k]) => k !== 'other');

  // Summary numbers for the status strip.
  const counts = { ok: 0, warn: 0, bad: 0 };
  for (const r of rows) counts[statusOf(r).key] += 1;
  const lowest = lowestPercent(usage);

  // Team map data.
  const busy = new Set(tasks.flatMap((t) => (t.status === 'claimed' ? [t.claimed_by] : t.status === 'reviewing' ? [t.reviewer] : [])).filter(Boolean));
  const best = Object.fromEntries(Object.keys(KIND_LABELS).map((k) => [k, bestFor(catalog, usable, k)]));
  const connections = rows.map((r) => {
    const st = statusOf(r);
    const u = usage.find((x) => x.id === r.id);
    const left = u?.windows.length ? Math.min(...u.windows.map((w) => w.left)) : null;
    return { id: r.id, label: r.label, status: st.key, word: st.word, plan: r.planLabel, left, busy: busy.has(r.id), models: r.models };
  });
  const usedModels = [...new Set(rows.flatMap((r) => r.models))].map((id) => ({
    id, label: modelLabel(catalog, id),
    jobs: Object.entries(best).filter(([k, b]) => k !== 'other' && b?.model === id).map(([k]) => KIND_LABELS[k].toLowerCase()),
  }));

  return (
    <div className="page">
      <TopBar title="Models & connections">
        <a href="#add" className="button small primary">+ Add model or API</a>
      </TopBar>
      <div className="page-inner">
        <div className="page-head">
          <h2>Models &amp; connections</h2>
          <p>Your AI subscriptions and API keys, the models each may use, and which model does which job. “Auto” follows the research table below and switches to a lighter model when an account is low on limit.</p>
        </div>

        <ol className="how-to" aria-label="How to add a model or API">
          <li><span className="step-no">1</span><div><b>Pick what to add</b><span>A Claude or ChatGPT subscription, or an API key (several are free).</span></div></li>
          <li><span className="step-no">2</span><div><b>Get a token or key</b><span>One terminal command for subscriptions, one link for API keys.</span></div></li>
          <li><span className="step-no">3</span><div><b>Save it in GitHub</b><span>Settings → Secrets, using the exact name CATE shows you.</span></div></li>
          <li><span className="step-no">4</span><div><b>Press Resume</b><span>It takes the next job that suits it.</span></div></li>
          <li className="how-to-cta"><a href="#add" className="button primary">Start adding</a></li>
        </ol>

        <div className="stat-strip" role="status">
          <span><i className="sdot ok" />{counts.ok} connected</span>
          {counts.warn ? <span><i className="sdot warn" />{counts.warn} paused</span> : null}
          {counts.bad ? <span><i className="sdot bad" />{counts.bad} not connected</span> : null}
          <span className="num">Lowest limit left: {lowest === null ? '–' : `${lowest}%`}</span>
          <span style={{ flex: 1 }} />
          <span>Supervisor: <b>{supervisor ? supervisorLabel : 'off'}</b> <i className={`sdot ${supervisor ? 'ok' : 'bad'}`} /></span>
        </div>

        {supervisor ? null : <div className="banner warn">The instant chat supervisor is off. Add a free <b>GROQ_API_KEY</b> (console.groq.com/keys) in Vercel → Settings → Environment Variables, then redeploy. A <b>GEMINI_API_KEY</b> there works as a backup.</div>}

        <nav className="page-tabs" aria-label="On this page">
          <a href="#connections">Connections</a><a href="#map">Team map</a><a href="#add">Add a model or API</a><a href="#guide">Which model for what</a>
        </nav>

        <ModelsPanel agents={rows} providers={catalog.providers || {}} usage={usage} repo={conf.repo} />

        <section className="section" id="map" aria-labelledby="map-title">
          <div className="section-head"><h2 id="map-title">Team map</h2><p>How work flows: the supervisor plans, each connection runs jobs, using the models ticked on its card. A moving line means a job is running there now.</p></div>
          <div className="card map-card">
            <TeamMap supervisor={{ on: Boolean(supervisor), label: supervisorLabel }} connections={connections} models={usedModels} />
          </div>
        </section>

        <AddSection presets={PRESETS} repo={conf.repo} />

        <section className="section" id="guide" aria-labelledby="guide-title">
          <div className="section-head"><h2 id="guide-title">Which model for what</h2><p>Scores 1–5 per job from public benchmarks and vendor guidance ({catalog.updated}). Pick a job to sort by it and see the best model for it.</p></div>
          <ModelGuide models={allModels} kinds={kinds} />
          <p className="faint small-text" style={{ marginTop: 8 }}>
            Best right now: {Object.keys(KIND_LABELS).map((k) => { const b = best[k]; return b ? `${KIND_LABELS[k]} → ${b.agent} / ${modelLabel(catalog, b.model)}` : null; }).filter(Boolean).join(' · ') || 'no connected account yet'}.
            {' '}Sources: {(catalog.sources || []).map((s, i) => <span key={s}>{i ? ', ' : ''}<a className="link" href={s} target="_blank" rel="noreferrer">{new URL(s).hostname.replace('www.', '')}</a></span>)}.
          </p>
        </section>
      </div>
    </div>
  );
}
