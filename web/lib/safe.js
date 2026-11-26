'use client';

// Calls a server action without ever crashing the page. A failed request ("Failed to fetch") usually means
// the connection dropped or a new version of CATE was deployed while this tab was open (every merge
// deploys). The caller gets { ok: false, error } to show next to the button; after a deploy the page
// reloads itself once so it talks to the new version.

const RELOAD_KEY = 'cate:reloaded-at';

export function isStaleOrOffline(error) {
  const text = String(error?.message || error || '');
  return /Failed to fetch|NetworkError|Load failed|Failed to find Server Action|unexpected response|fetch failed/i.test(text);
}

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60000) return false; // at most once a minute
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export async function safe(action) {
  try {
    const result = await action();
    return result ?? { ok: true };
  } catch (error) {
    console.error(error);
    if (/Failed to find Server Action/i.test(String(error?.message))) {
      if (reloadOnce()) return { ok: false, error: 'CATE was just updated. Reloading…' };
    }
    if (isStaleOrOffline(error)) {
      return { ok: false, error: navigator.onLine === false
        ? 'You are offline. Nothing was lost: reconnect and try again.'
        : 'Could not reach CATE (the connection dropped or the site was just updated). Nothing was lost: try again.' };
    }
    return { ok: false, error: error?.message || 'Something went wrong. Try again.' };
  }
}
