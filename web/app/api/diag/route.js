import { NextResponse } from 'next/server';
import { isSignedIn } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Private check of the API keys the website itself uses (signed-in owner only). Never returns key values.
const CHECKS = [
  { name: 'Groq', key: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1' },
  { name: 'Gemini', key: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { name: 'OpenRouter', key: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1' },
];

async function check({ name, key, base }) {
  const value = process.env[key];
  if (!value) return { name, configured: false };
  const headers = { Authorization: `Bearer ${value}` };
  const out = { name, configured: true };
  try {
    const r = await fetch(`${base}/models`, { headers, cache: 'no-store' });
    out.models_status = r.status;
    if (r.ok) {
      const data = await r.json();
      out.models = (data.data || []).map((m) => m.id).sort().slice(0, 200);
    } else out.models_error = (await r.text()).slice(0, 300);
  } catch (e) { out.models_error = String(e.message).slice(0, 200); }
  return out;
}

export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const results = await Promise.all(CHECKS.map(check));
  return NextResponse.json({ results, supervisor_models: { groq: process.env.SUPERVISOR_GROQ_MODEL || 'openai/gpt-oss-120b', gemini: process.env.SUPERVISOR_GEMINI_MODEL || 'gemini-3.8-flash' } },
    { headers: { 'Cache-Control': 'no-store' } });
}
