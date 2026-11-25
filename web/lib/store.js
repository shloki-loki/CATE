// The site's view of the data store: the JSON files on the repo's `data` branch (adapted from Outreach HQ).
// Production reads and writes them through the GitHub API (token in Vercel env).
// Local preview (DATA_DIR set) reads and writes the files on disk instead.
// Every write is read-modify-write guarded by the file's sha, retried on conflict, so the site,
// the GitHub workflows and the agents never overwrite each other.

import { promises as fs } from 'fs';
import path from 'path';

const API = 'https://api.github.com';
const DEFAULTS = { agents: { agents: [] }, tasks: { tasks: [] }, ledger: { weeks: {} }, journal: { entries: [] }, chats: { chats: [] } };

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

// Reads are cached in memory with GitHub's ETag: an unchanged file costs one conditional request that
// GitHub answers with 304 (no body, not counted against the rate limit), and repeat reads within a couple
// of seconds (several components rendering one page) cost nothing at all.
const cache = new Map(); // name -> { etag, value, sha, at }
const FRESH_MS = 2000;

async function readRemote(name, { fresh = false } = {}) {
  const { name: repoName, branch } = repo();
  const hit = cache.get(name);
  if (!fresh && hit && Date.now() - hit.at < FRESH_MS) return { value: structuredClone(hit.value), sha: hit.sha };
  const response = await gh(`/repos/${repoName}/contents/${name}.json?ref=${branch}`, {
    headers: hit?.etag && !fresh ? { 'If-None-Match': hit.etag } : {},
  });
  if (response.status === 304 && hit) {
    hit.at = Date.now();
    return { value: structuredClone(hit.value), sha: hit.sha };
  }
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
  const value = JSON.parse(text);
  cache.set(name, { etag: response.headers.get('etag'), value, sha: meta.sha, at: Date.now() });
  return { value: structuredClone(value), sha: meta.sha };
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
    const { value, sha } = await readRemote(name, { fresh: true });
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
    if (response.ok) {
      const saved = await response.json();
      cache.set(name, { etag: null, value: structuredClone(value), sha: saved.content?.sha, at: Date.now() });
      return result;
    }
    lastError = `${response.status} ${await response.text()}`;
    if (![409, 422].includes(response.status)) break; // only a sha conflict is worth retrying
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`Could not save ${name}.json: ${lastError}`);
}

// A text file on main (settings, the agent prompt template), read from disk in a local preview.
const mainCache = new Map();
export async function mainFile(relative) {
  const hit = mainCache.get(relative);
  if (hit && Date.now() - hit.at < 60000) return hit.text;
  const text = await mainFileUncached(relative);
  mainCache.set(relative, { text, at: Date.now() });
  return text;
}

async function mainFileUncached(relative) {
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

// Start the Agents workflow now (needs the token to have Actions: read and write). Agents only run if
// there is work for them, so pressing this with an empty queue costs nothing but a few seconds of CI.
export async function wakeAgents(reason) {
  if (localDir()) return { started: false, note: 'local preview: agents are not started' };
  const { name: repoName } = repo();
  const response = await gh(`/repos/${repoName}/actions/workflows/agents.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { reason: String(reason).slice(0, 100) } }),
  });
  if (response.ok) return { started: true };
  return { started: false, note: response.status === 403 || response.status === 404
    ? 'the GitHub token needs Actions: read and write to start agents (they will still start within 2 hours)'
    : `could not start agents: ${response.status}` };
}

// Save an uploaded file to the data branch (uploads/...), where agents can open it.
export async function uploadFile(relative, buffer, message) {
  const dir = localDir();
  if (dir) {
    const file = path.join(dir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    return;
  }
  const { name: repoName, branch } = repo();
  const existing = await gh(`/repos/${repoName}/contents/${relative}?ref=${branch}`);
  const sha = existing.ok ? (await existing.json()).sha : undefined;
  const response = await gh(`/repos/${repoName}/contents/${relative}`, {
    method: 'PUT',
    body: JSON.stringify({ message, branch, sha, content: Buffer.from(buffer).toString('base64'),
      committer: { name: 'cate site', email: 'cate@users.noreply.github.com' } }),
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
}
