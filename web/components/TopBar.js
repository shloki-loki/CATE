import Link from 'next/link';
import { logout } from '@/app/actions';
import { isOpenSite } from '@/lib/auth';

const TABS = [
  { href: '/', label: 'Overview' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/agents', label: 'Agents' },
  { href: '/models', label: 'Models' },
  { href: '/log', label: 'Log' },
];

export default function TopBar({ current }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link prefetch={false} href="/" className="brand"><span className="mark">CATE</span> Consume All Tokens Effectively</Link>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((tab) => (
            <Link prefetch={false} key={tab.href} href={tab.href} className="tab" aria-current={current === tab.href ? 'page' : undefined}>{tab.label}</Link>
          ))}
        </nav>
        {isOpenSite() ? null : <form action={logout}><button className="signout" type="submit">Sign out</button></form>}
      </div>
    </header>
  );
}
