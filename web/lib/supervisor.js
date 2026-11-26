// The instant supervisor: a fast free model (Groq first, Gemini as backup) that answers in the chat within
// seconds, asks clarifying questions, and proposes a plan of steps for the subscription agents. It never does
// the heavy work itself. Keys come from the Vercel environment (GROQ_API_KEY / GEMINI_API_KEY).

import { KIND_LABELS, bestFor, chooseModel, enabledModels, modelInfo, modelLabel } from '@/lib/catalog';

const ENDPOINTS = [
  { provider: 'groq', key: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', model: () => process.env.SUPERVISOR_GROQ_MODEL || 'openai/gpt-oss-120b' },
  { provider: 'google', key: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: () => process.env.SUPERVISOR_GEMINI_MODEL || 'gemini-3.8-flash' },
];

export function supervisorAvailable() {
  return ENDPOINTS.find((e) => process.env[e.key]) || null;
}

function roster(catalog, agents) {
  return agents.map((a) => {
    const l = a.limits || {};
    const left = ['five_hour', 'seven_day'].filter((w) => l[w]).map((w) => `${w === 'five_hour' ? '5h' : 'week'} ${Math.round(100 - l[w].used_pct)}% left`).join(', ');
    const models = enabledModels(catalog, a).map((m) => `${m} (${modelLabel(catalog, m)})`).join('; ');
    const defaults = Object.keys(KIND_LABELS).map((k) => `${k}→${chooseModel(catalog, a, k)}`).join(', ');
    return `- ${a.id} [${a.provider}, ${a.runner === 'api' ? 'FREE API, no tools' : 'subscription, full tools'}${a.status === 'paused' ? ', PAUSED: do not use' : ''}${left ? `, ${left}` : ''}] models: ${models}. defaults: ${defaults}`;
  }).join('\n');
}

function system(catalog, agents, selection) {
  const best = Object.keys(KIND_LABELS).map((k) => {
    const b = bestFor(catalog, agents, k);
    return b ? `${k}: ${b.agent} / ${b.model}` : null;
  }).filter(Boolean).join('; ');
  const picked = selection?.length
    ? `The user picked these models for this project. Use ONLY these (agent / model / job): ${selection.map((s) => `${s.agent} / ${s.model}${s.kind ? ` / ${s.kind}` : ''}`).join('; ')}.`
    : `No models picked by the user: choose per step. Recommended right now (best model for the job on the account with most limit left): ${best}.`;
  return `You are the supervisor of CATE, a dashboard that splits a user's project between their AI accounts.
You answer instantly and briefly.

About CATE itself (the user often asks to change it; "the dashboard", "the sidebar", "the chat", "this app",
"CATE" all mean CATE): it lives in the GitHub repo the agents work in. web/ is the dashboard (Next.js 16 App
Router, React 19, plain CSS in web/app/globals.css, pages in web/app/(app)/, components in web/components/,
server actions in web/app/actions.js, data read/written as JSON on the repo's data branch via web/lib/store.js).
cate/ is the Python engine (task queue, routing, supervisor, token/limit tracking; standard library only, tests in
tests/). .github/workflows/agents.yml starts the agents. Agents can read all of this code themselves, so never ask
the user which framework or files CATE uses: plan the change directly as a code step (branch + tests + pull request). You do NOT do the work yourself: you frame the project, ask clarifying
questions, and propose a plan whose steps run on the agents below (each step takes minutes, not seconds).

Agents:
${roster(catalog, agents)}

Job kinds: ${Object.entries(KIND_LABELS).map(([k, v]) => `${k} (${v})`).join(', ')}.
${picked}

Rules:
- If the goal, inputs or success criteria are unclear, ask at most 3 short questions and give no plan yet.
- Once clear, propose the smallest plan that does the job well (usually 1-4 steps). Each step's brief must be
  self-contained: what to do, which inputs (attached files are under uploads/), what a good result looks like.
- Research, development and anything needing the web, files or code must go to subscription agents. FREE API
  agents only get light review, planning or data work, and only when quality will not suffer.
- Prefer the recommended model per job, and accounts with more limit left. Put "review":"cross" on steps whose
  output matters, with 2-4 concrete checks the reviewer scores against.
- Steps may depend on earlier ones with "after": [index of earlier step, 0-based].
- Never add separate "review" steps for work you already marked "review":"cross": CATE reviews it automatically.
- Requests to change CATE itself (this dashboard, its agents, its code) are "code" steps on a subscription
  agent; their brief must say: work on a branch, run the tests, open a pull request for the owner to merge.
- Do not plan a copy or replica of a specific existing game (its name, characters, map, art, music or look).
  Offer an original game in the same genre instead, and say so in your reply.
- Use the agent ids and model ids exactly as listed. Never invent facts about the user.

Reply with ONLY this JSON object:
{"reply": "<your message to the user, markdown, concise>",
 "plan": null or {"summary": "<one line>", "steps": [{"title": "...", "kind": "research|write|code|review|data|plan|other",
   "agent": "<agent id>", "model": "<model id>", "brief": "...", "review": "cross|none", "checks": ["..."], "after": []}]}}`;
}

function history(messages, tasks) {
  return messages.slice(-30).map((m) => {
    if (m.role === 'user') return { role: 'user', content: `${m.text}${m.files?.length ? `\n(attached: ${m.files.join(', ')})` : ''}` };
    const ran = (m.tasks || []).map((id) => tasks.find((t) => t.id === id)).filter(Boolean)
      .map((t) => `${t.id} ${t.title}: ${t.status}${t.result ? ` — result: ${(t.result.text || '').slice(0, 600)}` : ''}`).join('\n');
    return { role: 'assistant', content: `${m.text || ''}${ran ? `\n[steps]\n${ran}` : ''}` };
  });
}

async function ask(endpoint, messages, json) {
  const body = { model: endpoint.model(), temperature: 0.2, messages };
  if (json) body.response_format = { type: 'json_object' };
  const response = await fetch(`${endpoint.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env[endpoint.key]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${endpoint.provider} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function parse(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

// Groq's strict JSON mode sometimes rejects long plans ("Failed to generate JSON"). Try JSON mode, then the same
// request without it (parsing the JSON out of the text), then the next provider (Gemini) the same way.
export async function supervise({ catalog, agents, messages, tasks, selection }) {
  const endpoints = ENDPOINTS.filter((e) => process.env[e.key]);
  if (!endpoints.length) return null;
  const prompt = [{ role: 'system', content: system(catalog, agents, selection) }, ...history(messages, tasks)];
  const errors = [];
  for (const endpoint of endpoints) {
    for (const json of [true, false]) {
      try {
        const text = await ask(endpoint, prompt, json);
        const parsed = parse(text);
        if (parsed && (parsed.reply || parsed.plan)) {
          return { ...sanitize(parsed, catalog, agents, selection), provider: endpoint.provider, model: endpoint.model() };
        }
        if (!json && text.trim()) return { reply: text.trim().slice(0, 8000), plan: null, provider: endpoint.provider, model: endpoint.model() };
        errors.push(`${endpoint.provider}: unreadable answer`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
  throw new Error(errors.join(' | ').slice(0, 300));
}

// Keep the plan to agents and models that exist and are enabled; fill gaps with the recommended choice.
export function sanitize(parsed, catalog, agents, selection) {
  const reply = String(parsed.reply || '').slice(0, 8000);
  const raw = parsed.plan && Array.isArray(parsed.plan.steps) ? parsed.plan.steps.slice(0, 8) : null;
  if (!raw || !raw.length) return { reply, plan: null };
  const steps = raw.map((s) => {
    const kind = Object.keys(KIND_LABELS).includes(s.kind) ? s.kind : 'other';
    let agent = agents.find((a) => a.id === s.agent && a.status !== 'paused');
    if (selection?.length) {
      const pick = selection.find((p) => p.agent === s.agent && (!p.kind || p.kind === kind)) || selection.find((p) => p.kind === kind) || selection[0];
      agent = agents.find((a) => a.id === pick.agent) || agent;
      s.model = pick.agent === agent?.id ? pick.model : s.model;
    }
    if (!selection?.length) {
      // No models picked: the account follows CATE's rule (best score for the job, then most limit left).
      const b = bestFor(catalog, agents, kind, { allowFree: Boolean(agent && agent.runner === 'api' && ['plan', 'review', 'data'].includes(kind)) });
      agent = agents.find((a) => a.id === b?.agent) || agent;
      if (b && agent?.id === b.agent && !(s.model && agent.models?.includes?.(s.model))) s.model = b.model;
    }
    if (!agent) {
      const b = bestFor(catalog, agents, kind);
      agent = agents.find((a) => a.id === b?.agent);
    }
    const model = agent ? chooseModel(catalog, agent, kind, s.model) : '';
    return {
      title: String(s.title || 'Step').slice(0, 160), kind, agent: agent?.id || '', model,
      modelLabel: modelInfo(catalog, model)?.label || model,
      brief: String(s.brief || '').slice(0, 12000), review: s.review === 'none' ? 'none' : 'cross',
      checks: (Array.isArray(s.checks) ? s.checks : []).map((c) => String(c).slice(0, 300)).slice(0, 6),
      after: (Array.isArray(s.after) ? s.after : []).filter((i) => Number.isInteger(i) && i >= 0),
    };
  });
  // Drop review steps that only re-check a step already marked for automatic cross review.
  const kept = steps.filter((st, i) => !(st.kind === 'review' && steps.slice(0, i).some((p) => p.review === 'cross')));
  const remap = steps.map((st) => kept.indexOf(st));
  for (const st of kept) st.after = st.after.map((i) => remap[i]).filter((i) => i >= 0);
  return { reply, plan: { summary: String(parsed.plan.summary || '').slice(0, 300), steps: kept } };
}
