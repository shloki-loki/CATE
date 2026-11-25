import { nowIso, read, settings, weekKey } from '@/lib/store';

export const PROVIDERS = {
  anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', xai: 'Grok', deepseek: 'DeepSeek',
  perplexity: 'Perplexity', local: 'Local (Ollama)', other: 'Other',
};
export const RUNNERS = {
  'claude-actions': 'Claude Code on your subscription (runs only when there is work)',
  'codex-actions': 'Codex on your ChatGPT plan (runs only when there is work)',
  api: 'API model: free tier or key (no tools)',
  'claude-code-scheduled': 'Claude Code scheduled task (timer: wastes tokens when idle)',
  'codex-automation': 'Codex app automation (timer)',
  manual: 'Manual (you paste the prompt)',
};

// Free (or nearly free) models an API agent can use. Mirrors cate/api_agent.py PRESETS.
export const PRESETS = {
  gemini: { label: 'Google Gemini', free: 'Free tier (Flash)', model: 'gemini-3.8-flash', secret: 'GEMINI_API_KEY', key: 'https://aistudio.google.com/apikey', note: 'Free key from Google AI Studio; daily request cap.' },
  openrouter: { label: 'OpenRouter', free: '25+ free models', model: 'openrouter/free', secret: 'OPENROUTER_API_KEY', key: 'https://openrouter.ai/keys', note: 'One key, many free models (DeepSeek, Llama, Qwen…); rate-limited.' },
  groq: { label: 'Groq', free: 'Free tier', model: 'llama-3.3-70b-versatile', secret: 'GROQ_API_KEY', key: 'https://console.groq.com/keys', note: 'Very fast open models; free daily limits.' },
  mistral: { label: 'Mistral', free: 'Free experiment tier', model: 'mistral-small-latest', secret: 'MISTRAL_API_KEY', key: 'https://console.mistral.ai/api-keys', note: 'Free tier for experimenting.' },
  cerebras: { label: 'Cerebras', free: 'Free tier', model: 'llama-3.3-70b', secret: 'CEREBRAS_API_KEY', key: 'https://cloud.cerebras.ai', note: 'Free daily tokens; very fast.' },
  deepseek: { label: 'DeepSeek', free: 'Paid, cents per task', model: 'deepseek-chat', secret: 'DEEPSEEK_API_KEY', key: 'https://platform.deepseek.com/api_keys', note: 'Not free, but very cheap.' },
};

export function secretFor(agent) {
  if (agent.secret) return agent.secret;
  const tag = agent.id.toUpperCase().replaceAll('-', '_');
  return { 'claude-actions': `CLAUDE_TOKEN_${tag}`, 'codex-actions': `CODEX_AUTH_${tag}` }[agent.runner] || `API_KEY_${tag}`;
}

export function limitRows(agent) {
  const l = agent.limits || {};
  return [['five_hour', '5-hour window'], ['seven_day', 'Week']]
    .filter(([k]) => l[k] && l[k].used_pct !== undefined)
    .map(([k, label]) => ({ label, used: l[k].used_pct, left: Math.max(0, 100 - l[k].used_pct), resets: l[k].resets_at }));
}
export const KINDS = ['plan', 'research', 'write', 'code', 'review', 'data', 'other'];
export const COLUMNS = [
  ['queued', 'Queued'], ['claimed', 'Working'], ['review', 'Awaiting review'], ['reviewing', 'Reviewing'],
  ['done', 'Done'], ['failed', 'Failed / blocked'],
];

export async function loadAll() {
  const [agents, tasks, ledger, journal, conf] = await Promise.all([
    read('agents'), read('tasks'), read('ledger'), read('journal'), settings(),
  ]);
  const week = weekKey(new Date(nowIso(conf.timezone).slice(0, 10)));
  return {
    agents: agents.agents || [], tasks: tasks.tasks || [], ledger: ledger || { weeks: {} },
    journal: journal.entries || [], conf, week,
  };
}

export function usage(ledger, week, agentId) {
  const row = ledger.weeks?.[week]?.[agentId] || {};
  return { used: (row.in || 0) + (row.out || 0), cached: row.cached || 0, tasks: row.tasks || 0, days: row.days || {} };
}

export function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

export function agentState(agent, ledger, week) {
  const { used } = usage(ledger, week, agent.id);
  if (agent.status === 'paused') return { tone: agent.note ? 'bad' : 'warn', label: agent.note || 'Paused' };
  if (agent.status === 'limited' && minutesSince(agent.limited_until) < 0) return { tone: 'warn', label: `Resting (usage limit) until ${when(agent.limited_until)}` };
  if (agent.weekly_budget_tokens && used >= agent.weekly_budget_tokens) return { tone: 'bad', label: 'Weekly budget used up' };
  for (const row of limitRows(agent)) {
    if (row.used >= (row.label === 'Week' ? 97 : 90) && minutesSince(row.resets) < 0) return { tone: 'warn', label: `${row.label} limit ${row.used}% used · resets ${when(row.resets)}` };
  }
  const onDemand = ['claude-actions', 'codex-actions', 'api'].includes(agent.runner);
  if (!agent.last_seen) return { tone: '', label: onDemand ? 'Ready · starts when there is work (not run yet)' : 'Never checked in' };
  return { tone: 'ok', label: `Ready · last ran ${when(agent.last_seen)}` };
}

export function when(iso) {
  if (!iso) return '–';
  const minutes = Math.round(minutesSince(iso));
  if (minutes < 0) {
    const ahead = -minutes;
    return ahead < 60 ? `in ${ahead} min` : `in ${Math.round(ahead / 60)} h`;
  }
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
