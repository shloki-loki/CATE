'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { logout } from '@/app/actions';
import { ChatIcon, Cube, List, Menu, Out, Plus } from '@/components/Icons';
import ThemeButton from '@/components/ThemeButton';

const FrameContext = createContext({ openMenu: () => {}, signOut: false });

const NAV = [
  { href: '/', label: 'Chat', Icon: ChatIcon },
  { href: '/models', label: 'Models', Icon: Cube },
  { href: '/logs', label: 'Logs', Icon: List },
];

function group(chats) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const out = { Today: [], 'This week': [], Earlier: [] };
  for (const c of chats) {
    const t = new Date(c.updated_at || c.created_at || 0).getTime();
    if (t >= startToday) out.Today.push(c);
    else if (t >= startToday - 6 * 86400000) out['This week'].push(c);
    else out.Earlier.push(c);
  }
  return Object.entries(out).filter(([, list]) => list.length);
}

export default function AppFrame({ chats, signOut, children }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [path]);

  // Archived projects are hidden from the sidebar (the "show archived" switch was removed on request).
  const visible = chats.filter((c) => !c.archived)
    .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));

  return (
    <div className={`app ${open ? 'open' : ''}`}>
      <aside className="sidebar" aria-label="Navigation">
        <div className="side-top">
          <div className="brand"><span className="mark">CATE</span><small>Consume All Tokens Effectively</small></div>
          <Link prefetch={false} href="/" className="new-chat"><Plus /> New project</Link>
          {NAV.map(({ href, label, Icon }) => (
            <Link prefetch={false} key={href} href={href} className="nav-item"
              aria-current={(href === '/' ? path === '/' || path.startsWith('/c/') : path.startsWith(href)) ? 'page' : undefined}>
              <Icon /> {label}
            </Link>
          ))}
        </div>
        <nav className="side-list" aria-label="Projects">
          {group(visible).map(([label, list]) => (
            <div key={label}>
              <div className="side-group">{label}</div>
              {list.map((c) => (
                <Link prefetch={false} key={c.id} href={`/c/${c.id}`} className="chat-link" aria-current={path === `/c/${c.id}` ? 'page' : undefined} title={c.title}>
                  <span className={`dot ${c.status}`} title={c.status} /><span className="t">{c.title}</span>
                </Link>
              ))}
            </div>
          ))}
          {!visible.length ? <p className="faint side-empty">Your projects will appear here.</p> : null}
        </nav>
      </aside>
      <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
      <div className="main">
        <FrameContext.Provider value={{ openMenu: () => setOpen(true), signOut }}>{children}</FrameContext.Provider>
      </div>
    </div>
  );
}

export function MenuButton() {
  const { openMenu } = useContext(FrameContext);
  return <button className="icon-btn menu-btn" onClick={openMenu} aria-label="Open menu"><Menu /></button>;
}

// One header for every page: menu button (mobile) and title on the left; page actions, then the
// brightness (theme) button and sign-out at the top right.
export function TopBar({ title, children }) {
  const { signOut } = useContext(FrameContext);
  return (
    <header className="topbar">
      <MenuButton />
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-actions">
        {children}
        {children ? <span className="topbar-divider" aria-hidden="true" /> : null}
        <ThemeButton />
        {signOut ? <form action={logout}><button className="icon-btn" title="Sign out" aria-label="Sign out" type="submit"><Out /></button></form> : null}
      </div>
    </header>
  );
}
