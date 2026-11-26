'use client';

// The brightness (light/dark) control, shown at the top right of every page.
// Two states, as Chrome's and Lea Verou's dark-mode guidance recommend: the icon shows what you switch to.
// First visit follows the operating system. Choosing the theme that matches the OS removes the saved choice,
// so CATE goes back to following the system. Other open tabs follow along through the `storage` event.

import { useEffect, useState } from 'react';
import { Moon, Sun } from '@/components/Icons';

const KEY = 'cate-theme';
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
const apply = (t) => { document.documentElement.dataset.theme = t; };

export default function ThemeButton() {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || 'dark');
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const sync = () => {
      let saved = null;
      try { saved = localStorage.getItem(KEY); } catch {}
      const t = saved === 'light' || saved === 'dark' ? saved : (systemDark() ? 'dark' : 'light');
      apply(t);
      setTheme(t);
    };
    mq?.addEventListener?.('change', sync);
    window.addEventListener('storage', sync);
    return () => { mq?.removeEventListener?.('change', sync); window.removeEventListener('storage', sync); };
  }, []);

  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      if ((next === 'dark') === systemDark()) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    apply(next);
    setTheme(next);
  };

  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button className="icon-btn theme-btn" onClick={flip} aria-label={label} title={label} data-testid="theme-toggle">
      {theme === 'dark' ? <Sun /> : <Moon />}
    </button>
  );
}
