// Run with: cd web && npm test
// The "Add a model or API" form suggests a short name and display name; paid APIs must not be called free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionPlaceholders, isFreePreset } from '../lib/addDefaults.mjs';

const groq = { label: 'Groq', free: '~1,000 requests/day' };
const deepseek = { label: 'DeepSeek', free: 'Paid, cents per task', paid: true };

test('a free API gets a "(free)" display name and a free- short name', () => {
  assert.deepEqual(connectionPlaceholders({ runner: 'api', presetKey: 'groq', preset: groq }), { id: 'free-groq', label: 'Groq (free)' });
});

test('a paid API (DeepSeek) is never labelled free', () => {
  const p = connectionPlaceholders({ runner: 'api', presetKey: 'deepseek', preset: deepseek });
  assert.deepEqual(p, { id: 'api-deepseek', label: 'DeepSeek' });
  assert.doesNotMatch(`${p.id} ${p.label}`, /free/i);
  assert.equal(isFreePreset(deepseek), false);
});

test('subscriptions use the type defaults', () => {
  const type = { id: 'claude-3', label: 'Claude Pro · account 3' };
  assert.deepEqual(connectionPlaceholders({ runner: 'claude-actions', presetKey: 'groq', preset: groq, type }), type);
});

test('every preset the dashboard ships is labelled consistently with its free/paid note', async () => {
  // Read data.js as text (it is a Next module); each preset row must mark paid: true exactly when its note says Paid.
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../lib/data.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const PRESETS'), src.indexOf('};', src.indexOf('export const PRESETS')));
  const rows = block.split('\n').filter((l) => /^\s+\w+: \{ label:/.test(l));
  assert.ok(rows.length >= 6, 'expected the API presets');
  for (const row of rows) {
    const paidNote = /free: 'Paid/.test(row);
    assert.equal(/paid: true/.test(row), paidNote, row);
  }
});
