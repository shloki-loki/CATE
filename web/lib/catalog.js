// The model catalog (config/models.json on main) and the same model-choice rules as cate/core.py, so the
// dashboard can show and suggest exactly what the agents will use.

import { mainFile } from '@/lib/store';

export const KIND_LABELS = {
  plan: 'Planning', research: 'Research', write: 'Writing', code: 'Development', review: 'Review', data: 'Data', other: 'Other',
};

export async function loadCatalog() {
  try {
    return JSON.parse(await mainFile('config/models.json'));
  } catch {
    return { providers: {}, kinds: KIND_LABELS, sources: [] };
  }
}

export function providerModels(catalog, provider) {
  return catalog.providers?.[provider]?.models || [];
}

export function modelInfo(catalog, id) {
  for (const p of Object.values(catalog.providers || {})) {
    const m = (p.models || []).find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}

export function modelLabel(catalog, id) {
  return modelInfo(catalog, id)?.label || id || 'default';
}

export function enabledModels(catalog, agent) {
  if (agent.models?.length) return agent.models;
  const known = providerModels(catalog, agent.provider).filter((m) => !m.paid_credits).map((m) => m.id);
  return known.length ? known : (agent.model ? [agent.model] : []);
}

// % used of an account-wide window, or 0 once its reset time has passed (the reading is stale).
export function windowUsed(agent, key) {
  const w = (agent.limits || {})[key];
  if (!w || w.used_pct === undefined) return 0;
  if (w.resets_at && new Date(w.resets_at).getTime() <= Date.now()) return 0;
  return Number(w.used_pct) || 0;
}

export function lowestLeft(agent) {
  return Math.min(...['five_hour', 'seven_day'].map((w) => 100 - windowUsed(agent, w)), 100);
}

export function chooseModel(catalog, agent, kind, wanted) {
  const allowed = enabledModels(catalog, agent);
  if (wanted && allowed.includes(wanted)) return wanted;
  if (agent.roles?.[kind] && allowed.includes(agent.roles[kind])) return agent.roles[kind];
  const scored = allowed.map((m) => {
    const info = modelInfo(catalog, m) || {};
    return { id: m, score: info.scores?.[kind] ?? 3, weight: info.weight ?? 1 };
  });
  if (!scored.length) return agent.model || '';
  const best = Math.max(...scored.map((s) => s.score));
  if (lowestLeft(agent) < 30) {
    return scored.filter((s) => s.score >= best - 1).sort((a, b) => a.weight - b.weight || b.score - a.score)[0].id;
  }
  return scored.sort((a, b) => b.score - a.score || a.weight - b.weight)[0].id;
}

// The best (agent, model) for a kind of job right now: highest score, then most limit left.
export function bestFor(catalog, agents, kind, { allowFree = false } = {}) {
  let best = null;
  for (const a of agents) {
    if (a.status === 'paused') continue;
    const isFree = a.runner === 'api';
    if (isFree && !allowFree) continue;
    const model = chooseModel(catalog, a, kind);
    const info = modelInfo(catalog, model) || {};
    const key = [info.scores?.[kind] ?? 3, lowestLeft(a)];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) best = { agent: a.id, model, key };
  }
  return best ? { agent: best.agent, model: best.model } : null;
}
