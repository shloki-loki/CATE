// The site's view of the data store: the JSON files on the repo's `data` branch (adapted from Outreach HQ).
// Production reads and writes them through the GitHub API (token in Vercel env).
// Local preview (DATA_DIR set) reads and writes the files on disk instead.
// Every write is read-modify-write guarded by the file's sha, retried on conflict, so the site,
// the GitHub workflows and the agents never overwrite each other.

import { promises as fs } from 'fs';
import path from 'path';

const API = 'https://api.github.com';
const DEFAULTS = { agents: { agents: [] }, tasks: { tasks: [] }, ledger: { weeks: {} }, journal: { entries: [] } };

function localDir() {
  return process.env.DATA_DIR ? path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.DATA_DIR) : null;
}

function repo() {
  const { GITHUB_TOKEN, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error('GITHUB_TOKEN and GITHUB_REPO are not set on the host (see SETUP.md).');
  return { token: GITHUB_TOKEN, name: GITHUB_REPO, branch: process.env.DATA_BRANCH || 'data' };
}

async function gh(url, options = {}) {
  const { token } = repo();
  const response = await fetch(`${API}${url}`, {
    ...options,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: 'application/vnd.github+json',
      ...(options.headers || {}),
    },
  });
  return response;
}

async function readRemote(name) {
  const { name: repoName, branch } = repo();
  const response = await gh(`/repos/${repoName}/contents/${name}.json?ref=${branch}`);
  if (response.status === 404) return { value: structuredClone(DEFAULTS[name] ?? {}), sha: null };
  if (!response.ok) throw new Error(`GitHub read of ${name}.json failed: ${response.status} ${await response.text()}`);
  const meta = await response.json();
  let text;
  if (meta.content && meta.encoding === 'base64') {
    text = Buffer.from(meta.content, 'base64').toString('utf8');
  } else {
    // Files over 1 MB come back without content; fetch the blob itself.
    const blob = await gh(`/repos/${repoName}/git/blobs/${meta.sha}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!blob.ok) throw new Error(`GitHub blob read of ${name}.json failed: ${blob.status}`);
    text = await blob.text();
  }
  return { value: JSON.parse(text), sha: meta.sha };
}

export async function read(name) {
  const dir = localDir();
  if (dir) {
    try {
      return JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(DEFAULTS[name] ?? {});
      throw error;
    }
  }
  return (await readRemote(name)).value;
}

export class Abort extends Error {}

// `change(value)` edits the parsed file in place. Throw `new Abort(reason)` to stop without writing.
export async function update(name, change, message) {
  const dir = localDir();
  if (dir) {
    const value = await read(name);
    const result = await change(value);
    const file = path.join(dir, `${name}.json`);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 1) + '\n', 'utf8');
    await fs.rename(`${file}.tmp`, file);
    return result;
  }
  const { name: repoName, branch } = repo();
  let lastError = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { value, sha } = await readRemote(name);
    const result = await change(value);
    const response = await gh(`/repos/${repoName}/contents/${name}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        branch,
        sha: sha || undefined,
        content: Buffer.from(JSON.stringify(value, null, 1) + '\n', 'utf8').toString('base64'),
        committer: { name: 'cate site', email: 'cate@users.noreply.github.com' },
      }),
    });
    if (response.ok) return result;
    lastError = `${response.status} ${await response.text()}`;
    if (![409, 422].includes(response.status)) break; // only a sha conflict is worth retrying
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`Could not save ${name}.json: ${lastError}`);
}

// A text file on main (settings, the agent prompt template), read from disk in a local preview.
export async function mainFile(relative) {
  if (localDir()) {
    return fs.readFile(path.resolve(/* turbopackIgnore: true */ process.cwd(), '..', relative), 'utf8');
  }
  const { name: repoName } = repo();
  const response = await gh(`/repos/${repoName}/contents/${relative}?ref=main`, { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (!response.ok) throw new Error(`GitHub read of ${relative} failed: ${response.status}`);
  return response.text();
}

export async function settings() {
  const text = await mainFile('config/settings.toml').catch(() => '');
  const num = (key, fallback) => Number((text.match(new RegExp(`^${key}\\s*=\\s*(\\d+)`, 'm')) || [])[1] || fallback);
  return {
    repo: (text.match(/^repo\s*=\s*"([^"]+)"/m) || [])[1] || process.env.GITHUB_REPO || 'OWNER/CATE',
    timezone: (text.match(/^timezone\s*=\s*"([^"]+)"/m) || [])[1] || 'Asia/Kolkata',
    fallbackMinutes: num('fallback_minutes', 90),
    passScore: num('default_pass_score', 80),
  };
}

export function nowIso(timeZone = 'Asia/Kolkata') {
  // Local timestamp in the same shape the Python side writes, e.g. 2026-11-25T21:15:00+05:30.
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const offset = (parts.timeZoneName || 'GMT+00:00').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

// ISO week key, matching Python's isocalendar(): 2026-W48.
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
