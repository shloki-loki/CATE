import { loadCatalog } from '@/lib/catalog';
import { nowIso, read, settings, weekKey } from '@/lib/store';

export const PROVIDERS = {
  anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', groq: 'Groq', xai: 'Grok', deepseek: 'DeepSeek',
  perplexity: 'Perplexity', local: 'Local (Ollama)', other: 'Other',
};

export const RUNNERS = {
  'claude-actions': 'Claude Pro / Max subscription',
  'codex-actions': 'ChatGPT Plus / Pro subscription',
  api: 'Free API key',
  manual: 'Manual (you paste the prompt)',
};

// Free (or nearly free) API models. Mirrors cate/api_agent.py PRESETS. `paid: true` marks a preset with
// no free tier, so the dashboard never labels it "(free)".
export const PRESETS = {
  groq: { label: 'Groq', provider: 'groq', free: '~1,000 requests/day', model: 'openai/gpt-oss-120b', secret: 'GROQ_API_KEY', key: 'https://console.groq.com/keys', note: 'Very fast. Best free choice for the instant supervisor.' },
  gemini: { label: 'Google Gemini', provider: 'google', free: '~20 requests/day (3.8 Flash)', model: 'gemini-3.8-flash', secret: 'GEMINI_API_KEY', key: 'https://aistudio.google.com/apikey', note: 'Capable, but a small free daily allowance.' },
  openrouter: { label: 'OpenRouter', provider: 'other', free: '25+ free models', model: 'openrouter/free', secret: 'OPENROUTER_API_KEY', key: 'https://openrouter.ai/keys', note: 'One key, many free open models; rate-limited.' },
  mistral: { label: 'Mistral', provider: 'other', free: 'Free experiment tier', model: 'mistral-small-latest', secret: 'MISTRAL_API_KEY', key: 'https://console.mistral.ai/api-keys', note: 'Free tier for experimenting.' },
  cerebras: { label: 'Cerebras', provider: 'other', free: 'Free daily tokens', model: 'llama-3.3-70b', secret: 'CEREBRAS_API_KEY', key: 'https://cloud.cerebras.ai', note: 'Very fast open models.' },
  deepseek: { label: 'DeepSeek', provider: 'deepseek', free: 'Paid, cents per task', paid: true, model: 'deepseek-chat', secret: 'DEEPSEEK_API_KEY', key: 'https://platform.deepseek.com/api_keys', note: 'Not free, but very cheap.' },
};

export function secretFor(agent) {
  if (agent.secret) return agent.secret;
  const tag = agent.id.toUpperCase().replaceAll('-', '_');
  return { 'claude-actions': `CLAUDE_TOKEN_${tag}`, 'codex-actions': `CODEX_AUTH_${tag}` }[agent.runner] || `API_KEY_${tag}`;
}

export async function loadAll() {
  const [agents, tasks, ledger, journal, chats, conf, catalog] = await Promise.all([
    read('agents'), read('tasks'), read('ledger'), read('journal'), read('chats'), settings(), loadCatalog(),
  ]);
  const today = nowIso(conf.timezone).slice(0, 10);
  return {
    agents: agents.agents || [], tasks: tasks.tasks || [], ledger: ledger || { weeks: {} },
    journal: journal.entries || [], chats: chats || { chats: [] }, conf, catalog, today,
    week: weekKey(new Date(today)),
  };
}

export const OPEN = ['queued', 'claimed', 'review', 'reviewing'];

export function chatStatus(chat, tasks) {
  const mine = tasks.filter((t) => t.chat === chat.id);
  if (mine.some((t) => ['claimed', 'reviewing'].includes(t.status))) return 'working';
  if (mine.some((t) => ['queued', 'review'].includes(t.status))) return 'waiting';
  if (mine.some((t) => ['failed', 'blocked'].includes(t.status))) return 'failed';
  if (mine.length && mine.every((t) => ['done', 'cancelled'].includes(t.status))) return 'done';
  return 'idle';
}

export function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

export function when(iso) {
  if (!iso) return '–';
  const minutes = Math.round(minutesSince(iso));
  if (minutes < 0) {
    const ahead = -minutes;
    return ahead < 60 ? `in ${ahead} min` : ahead < 48 * 60 ? `in ${Math.round(ahead / 60)} h` : `in ${Math.round(ahead / 1440)} days`;
  }
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
