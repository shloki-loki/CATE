// The instant supervisor: a fast free model (Groq first, Gemini as backup) that answers in the chat within
// seconds, asks clarifying questions, and proposes a plan of steps for the subscription agents. It never does
// the heavy work itself. Keys come from the Vercel environment (GROQ_API_KEY / GEMINI_API_KEY).

import { KIND_LABELS, bestFor, chooseModel, enabledModels, modelInfo, modelLabel } from '@/lib/catalog';

const ENDPOINTS = [
  // gpt-oss-120b with reasoning switched on is the strongest free model on Groq; qwen3.8-27b is the backup there.
  { provider: 'groq', key: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', model: () => process.env.SUPERVISOR_GROQ_MODEL || 'openai/gpt-oss-120b', reasoning: 'medium' },
  { provider: 'groq', key: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', model: () => 'qwen/qwen3.8-27b' },
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

function projectStatus(messages, tasks) {
  const ids = messages.flatMap((m) => m.tasks || []);
  const mine = ids.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
  if (!mine.length) return '';
  const label = { queued: 'waiting to start', claimed: 'being worked on', review: 'waiting for review', reviewing: 'being reviewed', done: 'done', failed: 'failed', cancelled: 'cancelled', blocked: 'blocked' };
  const merge = (t) => {
    const m = t.merge || {};
    if (!m.status) return '';
    return m.status === 'merged' ? ` [PR #${m.pr} MERGED into main]` : m.status === 'conflict' ? ` [PR #${m.pr} conflicts with main: sent back to fix]`
      : m.status === 'blocked' ? ` [PR #${m.pr} NOT merged: ${m.detail}]` : ` [PR #${m.pr} ${m.status}]`;
  };
  return mine.map((t) => `- ${t.id} ${t.title}: ${label[t.status] || t.status}${t.claimed_by || t.reviewer ? ` (${t.claimed_by || t.reviewer})` : ''}${t.after?.length && t.status === 'queued' ? ` (after ${t.after.join(', ')})` : ''}${merge(t)}`).join('\n');
}

function system(catalog, agents, selection, status = '') {
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

${status ? `This project ALREADY HAS a plan running. Current status of its steps:
${status}
If the user asks about progress, what happened, or where it is stuck: answer ONLY from this status, in plain,
simple words (what is done, what is running, what waits for what) and give NO plan. A step's code is in the
product only if it says MERGED; never claim something is merged or working otherwise.
"Continue", "go on", "carry on", "keep going" mean: keep running THIS plan. Reply with a short status and NO plan
(CATE restarts the agents itself). Never re-propose steps that already exist, even reworded. Only propose new
steps for genuinely new work the existing steps don't cover, or if the user asks to change or redo the plan.
` : ''}
Job kinds: ${Object.entries(KIND_LABELS).map(([k, v]) => `${k} (${v})`).join(', ')}.
${picked}

Rules (be a decisive, senior project lead, not a form):
- DECIDE, don't interrogate. Fill gaps with sensible defaults and state them in one line ("I'll assume a
  browser game in Three.js"). Ask a question only if the work truly cannot start without the answer: at most
  2 short questions, and never again about something the user already answered.
- If the user says "I don't know", "just do it", "you decide" or similar: decide yourself and plan now.
- NEVER ask for repository names, access tokens, frameworks, file paths or "which code": the agents already
  have the repo and can read everything. Never ask which models to use: that is your job (see Agents).
- The plan: the smallest set of steps that does the job well (usually 2-6). Each brief is self-contained and
  concrete: goal, inputs (attachments are under uploads/; earlier steps' outputs are outputs/T....md), what to
  produce, and how to know it is done. Software goes in a folder of the repo (e.g. game/, site/) via branch +
  tests + pull request; CATE merges it automatically after review.
- Research, development and anything needing the web, files or code go to subscription agents. FREE API
  agents get no steps unless the user picked them.
- Spread work over accounts with the most limit left; use the recommended model per job. Put
  "review":"cross" on steps whose output matters, with 2-4 checks a reviewer can verify.
- Steps may depend on earlier ones with "after": [index of earlier step, 0-based]. Let independent steps run
  in parallel. Never add separate "review" steps: CATE reviews "cross" steps automatically.
- Requests to change CATE itself (this dashboard, its agents, its code) are "code" steps on a subscription
  agent; brief: work on a branch, run the tests, open a pull request.
- Do not plan a copy or replica of a specific existing game (its name, characters, map, art, music or look).
  Offer an original game in the same genre instead, and say so in your reply.
- Use the agent ids and model ids exactly as listed. Never invent facts about the user.
- Your reply: short, plain words, no filler. When you give a plan, the reply says what will happen in 1-3
  sentences; the plan card shows the details.

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
  if (endpoint.reasoning) body.reasoning_effort = endpoint.reasoning; // think before answering (Groq gpt-oss)
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
  const prompt = [{ role: 'system', content: system(catalog, agents, selection, projectStatus(messages, tasks)) }, ...history(messages, tasks)];
  const errors = [];
  for (const endpoint of endpoints) {
    for (const json of [true, false]) {
      try {
        const text = await ask(endpoint, prompt, json);
        const parsed = parse(text);
        if (parsed && (parsed.reply || parsed.plan)) {
          const existing = messages.flatMap((m) => m.tasks || []).map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
          const result = sanitize(parsed, catalog, agents, selection, existing);
          if (parsed.plan?.steps?.length && !result.plan) {
            result.reply = `${result.reply}\n\n_(Every step it proposed already exists in this project, so nothing new was added.)_`;
          }
          return { ...result, provider: endpoint.provider, model: endpoint.model() };
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
const words = (text) => new Set(String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2));
function similar(a, b) {
  const x = words(a); const y = words(b);
  if (!x.size || !y.size) return false;
  const common = [...x].filter((w) => y.has(w)).length;
  return common / Math.min(x.size, y.size) >= 0.7;
}

export function sanitize(parsed, catalog, agents, selection, existing = []) {
  const reply = String(parsed.reply || '').slice(0, 8000);
  const raw = parsed.plan && Array.isArray(parsed.plan.steps) ? parsed.plan.steps.slice(0, 8) : null;
  if (!raw || !raw.length) return { reply, plan: null };
  const steps = raw.map((s) => {
    const kind = Object.keys(KIND_LABELS).includes(s.kind) ? s.kind : 'other';
    let agent = agents.find((a) => a.id === s.agent && a.status !== 'paused');
    if (selection?.length) {
      // The picked models are the ALLOWED set: choose the best of them for this job, never just the first pick.
      const allowedAgents = agents.filter((a) => selection.some((p) => p.agent === a.id) && a.status !== 'paused')
        .map((a) => ({ ...a, models: selection.filter((p) => p.agent === a.id && (!p.kind || p.kind === kind)).map((p) => p.model) }))
        .filter((a) => a.models.length);
      const pool = allowedAgents.length ? allowedAgents : agents.filter((a) => selection.some((p) => p.agent === a.id))
        .map((a) => ({ ...a, models: selection.filter((p) => p.agent === a.id).map((p) => p.model) }));
      const named = pool.find((a) => a.id === s.agent);
      const b = named ? { agent: named.id } : bestFor(catalog, pool, kind, { allowFree: true });
      const chosen = pool.find((a) => a.id === b?.agent) || pool[0];
      if (chosen) {
        agent = agents.find((a) => a.id === chosen.id);
        s.model = chooseModel(catalog, chosen, kind, chosen.models.includes(s.model) ? s.model : undefined);
      }
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
  // Drop review steps that only re-check a step already marked for automatic cross review, and steps that
  // repeat work this project already has (done or under way): the cause of duplicate builds.
  const live = existing.filter((t) => t.status !== 'cancelled');
  const kept = steps.filter((st, i) => !(st.kind === 'review' && steps.slice(0, i).some((p) => p.review === 'cross'))
    && !live.some((t) => similar(t.title, st.title)));
  if (!kept.length) return { reply, plan: null };
  const remap = steps.map((st) => kept.indexOf(st));
  for (const st of kept) st.after = st.after.map((i) => remap[i]).filter((i) => i >= 0);
  return { reply, plan: { summary: String(parsed.plan.summary || '').slice(0, 300), steps: kept } };
}
